const express = require('express');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createWordPressClient } = require('./src/wordpress');
const tokens = require('./src/tokens');
const { generateImage } = require('./src/imageGen');
const { extractImagePrompts, insertImagesIntoContent } = require('./src/promptExtractor');

dotenv.config();

const PORT = process.env.PORT || 9809;
const WP_URL = process.env.WP_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const CLAUDE_CLIENT_ID = process.env.CLAUDE_CLIENT_ID;
const CLAUDE_CLIENT_SECRET = process.env.CLAUDE_CLIENT_SECRET;

if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
  console.error('ERROR: Missing required env vars. Set WP_URL, WP_USERNAME, and WP_APP_PASSWORD in .env');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not set — generate_image tools will not work');
}
if (!CLAUDE_CLIENT_ID || !CLAUDE_CLIENT_SECRET) {
  console.error('ERROR: CLAUDE_CLIENT_ID and CLAUDE_CLIENT_SECRET not set. Enter the same values in Claude connector settings.');
  process.exit(1);
}

const wp = createWordPressClient({ url: WP_URL, username: WP_USERNAME, password: WP_APP_PASSWORD });
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS — required for Claude's browser UI widget
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBaseUrl(req) {
  let scheme = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (!scheme && req.headers['cf-visitor']) {
    try { scheme = JSON.parse(req.headers['cf-visitor']).scheme; } catch {}
  }
  if (!scheme) scheme = req.protocol;
  return `${scheme}://${req.get('host')}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── OAuth Discovery ──────────────────────────────────────────────────────────

// Tells Claude where the authorization server lives
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const base = getBaseUrl(req);
  res.json({ resource: base, authorization_servers: [base] });
});

// Authorization server metadata (RFC 8414)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['mcp'],
    code_challenge_methods_supported: ['S256'],
  });
});

// ─── Dynamic Client Registration (RFC 7591) ───────────────────────────────────

// Returns the pre-configured client credentials so Claude uses the values you set in .env
app.post('/register', (req, res) => {
  const redirectUris = Array.isArray(req.body.redirect_uris) ? req.body.redirect_uris : [];
  const base = getBaseUrl(req);
  console.log(`  Client registration — returning pre-configured client_id: ${CLAUDE_CLIENT_ID}`);
  res.status(201).json({
    client_id: CLAUDE_CLIENT_ID,
    client_secret: CLAUDE_CLIENT_SECRET,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    registration_client_uri: `${base}/register/${CLAUDE_CLIENT_ID}`,
  });
});

// ─── Authorization Endpoint ───────────────────────────────────────────────────

// Auto-approves — we control this server and trust Claude
app.get('/oauth/authorize', (req, res) => {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state, scope } = req.query;

  if (response_type !== 'code') return res.status(400).send('Only response_type=code is supported');
  if (!redirect_uri) return res.status(400).send('Missing redirect_uri');

  const code = randomToken(32);
  tokens.saveAuthCode(code, { client_id, redirect_uri, code_challenge, code_challenge_method, scope });
  console.log(`  Auth code issued for client: ${client_id}`);

  const sep = redirect_uri.includes('?') ? '&' : '?';
  const dest = `${redirect_uri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
  res.redirect(302, dest);
});

// ─── Token Endpoint ───────────────────────────────────────────────────────────

app.post('/oauth/token', (req, res) => {
  const { grant_type, code, code_verifier, redirect_uri, refresh_token, client_id, client_secret } = req.body;

  // Validate pre-configured client credentials
  if (client_id && client_id !== CLAUDE_CLIENT_ID) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
  }
  if (client_secret && client_secret !== CLAUDE_CLIENT_SECRET) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Invalid client_secret' });
  }

  if (grant_type === 'authorization_code') {
    const authCode = tokens.getAuthCode(code);
    if (!authCode) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    // PKCE verification (RFC 7636)
    if (authCode.code_challenge) {
      if (!code_verifier) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier required' });
      }
      const digest = crypto.createHash('sha256').update(code_verifier).digest();
      if (base64url(digest) !== authCode.code_challenge) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
    }

    if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }

    tokens.deleteAuthCode(code);

    const accessToken = randomToken(32);
    const newRefreshToken = randomToken(32);
    tokens.saveToken(accessToken, { clientId: authCode.client_id, scope: authCode.scope || 'mcp', refreshToken: newRefreshToken });
    console.log(`  Access token issued for client: ${authCode.client_id}`);

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: newRefreshToken,
      scope: authCode.scope || 'mcp',
    });
  }

  if (grant_type === 'refresh_token') {
    const stored = tokens.getTokenByRefresh(refresh_token);
    if (stored) tokens.deleteToken(stored.accessToken);

    const newAccessToken = randomToken(32);
    const newRefreshToken = randomToken(32);
    const clientId = stored?.clientId || 'claude';
    const scope = stored?.scope || 'mcp';
    tokens.saveToken(newAccessToken, { clientId, scope, refreshToken: newRefreshToken });
    console.log(`  Token refreshed for client: ${clientId}`);

    return res.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: newRefreshToken,
      scope,
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// ─── MCP Tools ────────────────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'get_posts',
    description: 'Get a list of WordPress posts. Returns ID, title, status, date, and excerpt.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'integer', description: 'Posts to return (default 10, max 100)', default: 10 },
        page: { type: 'integer', description: 'Page number for pagination', default: 1 },
        status: { type: 'string', enum: ['publish', 'draft', 'pending', 'private', 'any'], description: 'Filter by status', default: 'any' },
        search: { type: 'string', description: 'Search keyword' },
      },
    },
  },
  {
    name: 'get_post',
    description: 'Get the full content of a single WordPress post by its ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', description: 'The post ID' },
      },
    },
  },
  {
    name: 'create_post',
    description: 'Create a new WordPress post.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
      },
    },
  },
  {
    name: 'upload_image',
    description: 'Upload an image to WordPress media library. Provide image_url OR image_base64.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Public URL of the image to fetch and upload' },
        image_base64: { type: 'string', description: 'Base64-encoded image data' },
        filename: { type: 'string', description: 'Filename (e.g. photo.jpg)' },
        mime_type: { type: 'string', description: 'MIME type (e.g. image/jpeg, image/png)' },
      },
    },
  },
  {
    name: 'create_post_with_image',
    description: 'Upload a featured image and create a WordPress post with it in one step.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        image_url: { type: 'string', description: 'Public URL of the featured image' },
        image_base64: { type: 'string', description: 'Base64-encoded featured image data' },
        filename: { type: 'string', description: 'Image filename' },
        mime_type: { type: 'string', description: 'Image MIME type' },
      },
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image using Pollinations.ai (Flux model, free, no login needed) from a text prompt and upload it to the WordPress media library.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio (default: 16:9)', default: '1:1' },
        filename: { type: 'string', description: 'Filename to use when saving to WordPress (default: generated-image.png)' },
      },
    },
  },
  {
    name: 'generate_image_for_post',
    description: 'Generate an image with Google Imagen 3, upload it to WordPress media, and create a new post with it as the featured image — all in one step.',
    inputSchema: {
      type: 'object',
      required: ['prompt', 'title', 'content'],
      properties: {
        prompt: { type: 'string', description: 'Text prompt describing the featured image to generate' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio (default: 16:9)', default: '1:1' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
      },
    },
  },
  {
    name: 'create_post_with_ai_images',
    description: 'Automatically analyze post content, generate 3 matching section images using AI (one per H2 section), embed them into the content, and publish the post. The first image becomes the featured image.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body HTML with H2 section headings. Images will be generated and inserted after each H2.' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio for all generated images (default: 16:9)', default: '1:1' },
      },
    },
  },
];

// ─── Tool Runner ──────────────────────────────────────────────────────────────

async function runTool(name, args) {
  switch (name) {
    case 'get_posts': {
      const posts = await wp.getPosts({
        per_page: args.per_page || 10,
        page: args.page || 1,
        status: args.status || 'any',
        search: args.search,
      });
      return posts.map(p => ({
        id: p.id,
        title: p.title?.rendered,
        status: p.status,
        date: p.date,
        link: p.link,
        excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim(),
      }));
    }

    case 'get_post': {
      const p = await wp.getPost(args.id);
      return {
        id: p.id,
        title: p.title?.rendered,
        content: p.content?.rendered,
        status: p.status,
        date: p.date,
        link: p.link,
        categories: p.categories,
        tags: p.tags,
        featured_media: p.featured_media,
      };
    }

    case 'create_post': {
      const p = await wp.createPost(args);
      return { id: p.id, link: p.link, status: p.status };
    }

    case 'upload_image': {
      const media = await wp.uploadMedia({
        imageUrl: args.image_url,
        imageBase64: args.image_base64,
        fileName: args.filename,
        mimeType: args.mime_type,
      });
      return { id: media.id, url: media.source_url, filename: media.slug };
    }

    case 'create_post_with_image': {
      const media = await wp.uploadMedia({
        imageUrl: args.image_url,
        imageBase64: args.image_base64,
        fileName: args.filename,
        mimeType: args.mime_type,
      });
      const p = await wp.createPost({
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: media.id,
      });
      return { post_id: p.id, post_link: p.link, status: p.status, media_id: media.id, media_url: media.source_url };
    }

    case 'generate_image': {
      const [generated] = await generateImage({
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio || '16:9',
      });
      const filename = args.filename || 'generated-image.png';
      const media = await wp.uploadMedia({
        imageBase64: generated.base64,
        fileName: filename,
        mimeType: generated.mimeType,
      });
      return { media_id: media.id, media_url: media.source_url, filename: media.slug };
    }

    case 'generate_image_for_post': {
      const [generated] = await generateImage({
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio || '16:9',
      });
      const media = await wp.uploadMedia({
        imageBase64: generated.base64,
        fileName: 'generated-image.png',
        mimeType: generated.mimeType,
      });
      const p = await wp.createPost({
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: media.id,
      });
      return { post_id: p.id, post_link: p.link, status: p.status, media_id: media.id, media_url: media.source_url };
    }

    case 'create_post_with_ai_images': {
      // 1. Extract 3 section-matched prompts from content
      const prompts = extractImagePrompts(args.content, args.title);
      console.log(`  Extracted ${prompts.length} image prompts from content`);

      // 2. Generate & upload all 3 images sequentially (Pollinations rate limit)
      const aspectRatio = args.aspect_ratio || '16:9';
      const uploadedImages = [];
      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        console.log(`  Generating image ${i + 1}/${prompts.length}: ${prompt.slice(0, 80)}...`);
        const [img] = await generateImage({ prompt, aspectRatio });
        const media = await wp.uploadMedia({
          imageBase64: img.base64,
          fileName: `section-image-${i + 1}.jpg`,
          mimeType: img.mimeType,
        });
        uploadedImages.push({ url: media.source_url, mediaId: media.id });
      }

      // 3. Embed images into content after each H2 section
      const enrichedContent = insertImagesIntoContent(args.content, uploadedImages);

      // 4. Create post with first image as featured media
      const p = await wp.createPost({
        title: args.title,
        content: enrichedContent,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: uploadedImages[0].mediaId,
      });

      return {
        post_id: p.id,
        post_link: p.link,
        status: p.status,
        images_generated: uploadedImages.length,
        images: uploadedImages,
        prompts_used: prompts,
      };
    }

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

// ─── MCP Endpoint ─────────────────────────────────────────────────────────────

app.post('/', async (req, res) => {
  // Verify OAuth-issued Bearer token
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    const base = getBaseUrl(req);
    res.set('WWW-Authenticate', `Bearer realm="WordPress MCP", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'unauthorized' });
  }
  const tokenStr = authHeader.slice(7);
  if (!tokens.getToken(tokenStr)) {
    const base = getBaseUrl(req);
    res.set('WWW-Authenticate', `Bearer realm="WordPress MCP", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'invalid_token' });
  }

  const { method, id, params } = req.body;

  // JSON-RPC notifications have no id — must not send a response body
  if (id === undefined || id === null) {
    console.log(`  Notification: ${method}`);
    return res.status(204).end();
  }

  console.log(`  RPC: ${method} (id=${id})`);

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'WordPress MCP', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
  }

  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    console.log(`  Tool: ${toolName}`, toolArgs);
    try {
      const result = await runTool(toolName, toolArgs);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      console.error(`  Tool error [${toolName}]:`, err.message);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      });
    }
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', wordpress: WP_URL });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WordPress MCP listening on port ${PORT}`);
  console.log(`WordPress: ${WP_URL}`);
});
