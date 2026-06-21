const express = require('express');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { createWordPressClient } = require('./src/wordpress');
const manifest = require('./mcp-manifest.json');

dotenv.config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  console.log(`=== REQUEST ${req.method} ${req.originalUrl} ===`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  if (req.method !== 'GET') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

const PORT = process.env.PORT || 4000;
const WP_URL = process.env.WP_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const CLAUDE_OAUTH_CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID;
const CLAUDE_OAUTH_CLIENT_SECRET = process.env.CLAUDE_OAUTH_CLIENT_SECRET;
const CLAUDE_OAUTH_REDIRECT_URI = process.env.CLAUDE_OAUTH_REDIRECT_URI;

if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
  console.error('Missing WordPress configuration in .env. Please set WP_URL, WP_USERNAME, and WP_APP_PASSWORD.');
  process.exit(1);
}

if (!CLAUDE_OAUTH_CLIENT_ID || !CLAUDE_OAUTH_CLIENT_SECRET) {
  console.warn('Warning: CLAUDE_OAUTH_CLIENT_ID and CLAUDE_OAUTH_CLIENT_SECRET are not configured. Dynamic registration will still work, but Claude may require manual connector configuration.');
}

const wp = createWordPressClient({
  url: WP_URL,
  username: WP_USERNAME,
  password: WP_APP_PASSWORD,
});

const authCodes = new Map();
const accessTokens = new Map();

function generateCode() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeBase64Url(input) {
  return input.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getClientCredentials(req) {
  let clientId = req.body.client_id;
  let clientSecret = req.body.client_secret;

  if (req.headers.authorization && req.headers.authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(req.headers.authorization.slice(6), 'base64').toString('utf8');
    const [id, secret] = decoded.split(':');
    if (id) clientId = id;
    if (secret) clientSecret = secret;
  }

  return { clientId, clientSecret };
}

const sseClients = new Set();

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      sendEvent(client, { type: 'ping' });
    } catch (err) {
      sseClients.delete(client);
    }
  }
}, 15000);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', site: WP_URL });
});

app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });

    sendEvent(res, { type: 'ready' });
    return;
  }

  res.json(manifest);
});

app.get('/.well-known/mcp', (req, res) => {
  res.json(manifest);
});

const MCP_TOOLS = [
  {
    name: 'create_post',
    description: 'Create a new WordPress post.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Array of category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Array of tag IDs' },
        featured_media: { type: 'integer', description: 'Media ID for featured image' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'update_post',
    description: 'Update an existing WordPress post.',
    inputSchema: {
      type: 'object',
      properties: {
        postId: { type: 'integer', description: 'ID of the post to update' },
        title: { type: 'string', description: 'New post title' },
        content: { type: 'string', description: 'New post content (HTML)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Array of category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Array of tag IDs' },
        featured_media: { type: 'integer', description: 'Media ID for featured image' },
      },
      required: ['postId'],
    },
  },
  {
    name: 'get_posts',
    description: 'List WordPress posts with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number' },
        per_page: { type: 'integer', description: 'Posts per page (max 100)' },
        status: { type: 'string', description: 'Filter by post status' },
        search: { type: 'string', description: 'Search term' },
      },
    },
  },
  {
    name: 'get_post',
    description: 'Fetch a single WordPress post by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        postId: { type: 'integer', description: 'Post ID' },
      },
      required: ['postId'],
    },
  },
  {
    name: 'upload_media',
    description: 'Upload an image to the WordPress media library.',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: 'URL of the image to upload' },
        imageBase64: { type: 'string', description: 'Base64-encoded image data' },
        fileName: { type: 'string', description: 'File name for the uploaded image' },
        mimeType: { type: 'string', description: 'MIME type (e.g. image/jpeg)' },
      },
    },
  },
  {
    name: 'set_featured_image',
    description: 'Set the featured image of a WordPress post.',
    inputSchema: {
      type: 'object',
      properties: {
        postId: { type: 'integer', description: 'Post ID' },
        mediaId: { type: 'integer', description: 'Media ID to use as featured image' },
      },
      required: ['postId', 'mediaId'],
    },
  },
  {
    name: 'create_post_with_image',
    description: 'Create a WordPress post and upload an image to use as its featured image.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        imageUrl: { type: 'string', description: 'URL of the image to upload' },
        imageBase64: { type: 'string', description: 'Base64-encoded image data' },
        fileName: { type: 'string', description: 'File name for the image' },
        mimeType: { type: 'string', description: 'MIME type (e.g. image/jpeg)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Array of category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Array of tag IDs' },
      },
      required: ['title', 'content'],
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'create_post':
      return wp.createPost(args);
    case 'update_post': {
      const { postId, ...updates } = args;
      return wp.updatePost(postId, updates);
    }
    case 'get_posts':
      return wp.getPosts(args);
    case 'get_post':
      return wp.getPost(args.postId);
    case 'upload_media':
      return wp.uploadMedia(args);
    case 'set_featured_image':
      return wp.setFeaturedImage(args.postId, args.mediaId);
    case 'create_post_with_image': {
      const { imageUrl, imageBase64, fileName, mimeType, title, content, status, excerpt, categories, tags } = args;
      const media = await wp.uploadMedia({ imageUrl, imageBase64, fileName, mimeType });
      return wp.createPost({ title, content, status, excerpt, categories, tags, featured_media: media.id });
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

app.post('/', async (req, res) => {
  console.log('=== MCP runtime POST / received ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('Missing or invalid Authorization header');
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Missing Authorization header' },
    });
  }

  const token = authHeader.slice(7);
  const tokenInfo = accessTokens.get(token);
  if (!tokenInfo) {
    console.error('Invalid or expired access token:', token.slice(0, 8) + '...');
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid or expired access token' },
    });
  }

  console.log('Token validated for client:', tokenInfo.client_id);

  const { method, id, params } = req.body;

  // Notifications have no id — acknowledge without a body
  if (id === undefined && method) {
    console.log('Notification received (no response):', method);
    return res.status(204).end();
  }

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'WordPress MCP Server', version: '0.1.0' },
      },
    });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    console.log('Tool call:', toolName, JSON.stringify(toolArgs));
    try {
      const data = await callTool(toolName, toolArgs);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        },
      });
    } catch (err) {
      console.error('Tool call error:', err.message);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

app.get('/check-wp-auth', async (req, res) => {
  try {
    const user = await wp.getCurrentUser();
    res.json({ ok: true, user });
  } catch (error) {
    res.status(401).json({ ok: false, error: error.message, details: error.response?.data || null });
  }
});

app.get('/posts', async (req, res) => {
  try {
    const posts = await wp.getPosts(req.query);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.get('/posts/:postId', async (req, res) => {
  try {
    const post = await wp.getPost(req.params.postId);
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.get('/manifest', (req, res) => {
  res.json(manifest);
});

// Compatibility endpoints for connector registration probes
function getBaseUrlFromRequest(req) {
  const forwardedProto = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
  let scheme = forwardedProto ? forwardedProto.split(',')[0].trim() : null;

  if (!scheme && req.headers['cf-visitor']) {
    try {
      const visitor = JSON.parse(req.headers['cf-visitor']);
      scheme = visitor.scheme;
    } catch (err) {
      scheme = null;
    }
  }

  if (!scheme) {
    scheme = req.protocol;
  }

  return `${scheme}://${req.get('host')}`;
}

function buildRegistrationResponse(req, client_id, client_secret) {
  const baseUrl = getBaseUrlFromRequest(req);
  const redirectUris = Array.isArray(req.body.redirect_uris) ? [...req.body.redirect_uris] : [];
  if (!redirectUris.length) {
    redirectUris.push(`${baseUrl}/authorized`);
  }

  const resolvedClientId = CLAUDE_OAUTH_CLIENT_ID || client_id;
  const resolvedClientSecret = CLAUDE_OAUTH_CLIENT_SECRET || client_secret;

  return {
    client_id: resolvedClientId,
    client_secret: resolvedClientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
    grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
    response_types: req.body.response_types || ['code'],
    redirect_uris: redirectUris,
    client_name: req.body.client_name || 'claude',
    application_type: req.body.application_type || 'web',
    scope: req.body.scope || 'openid',
    token_endpoint: `${baseUrl}/oauth/token`,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    registration_client_uri: `${baseUrl}${req.path}`,
    registration_access_token: crypto.randomBytes(24).toString('hex'),
    issuer: baseUrl,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    introspection_endpoint: `${baseUrl}/oauth/introspect`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
  };
}

app.post('/.well-known/mcp/register', (req, res) => {
  console.log('=== MCP register probe received at /.well-known/mcp/register ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  try {
    const fs = require('fs');
    fs.appendFileSync('debug-register.log', `TIME: ${new Date().toISOString()}\nPATH: /.well-known/mcp/register\nHEADERS: ${JSON.stringify(req.headers)}\nBODY: ${JSON.stringify(req.body)}\n----\n`);
  } catch (e) {
    console.error('Failed to write debug log', e.message);
  }
  try {
    const client_id = CLAUDE_OAUTH_CLIENT_ID || `claude-${crypto.randomBytes(16).toString('hex')}`;
    const client_secret = CLAUDE_OAUTH_CLIENT_SECRET || crypto.randomBytes(16).toString('hex');
    const resp = buildRegistrationResponse(req, client_id, client_secret);
    try {
      const fs = require('fs');
      fs.appendFileSync('debug-register.log', `RESPONSE: ${JSON.stringify(resp)}\n`);
    } catch (e) {}
    res.status(201).json(resp);
    return;
  } catch (e) {
    console.error('Registration response error', e.message);
    res.status(500).json({ ok: false, error: 'registration response failed' });
    return;
  }
});

app.post('/register', (req, res) => {
  console.log('=== MCP register probe received at /register ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  try {
    const fs = require('fs');
    fs.appendFileSync('debug-register.log', `TIME: ${new Date().toISOString()}\nPATH: /register\nHEADERS: ${JSON.stringify(req.headers)}\nBODY: ${JSON.stringify(req.body)}\n----\n`);
  } catch (e) {
    console.error('Failed to write debug log', e.message);
  }
  try {
    const client_id = CLAUDE_OAUTH_CLIENT_ID || `claude-${crypto.randomBytes(16).toString('hex')}`;
    const client_secret = CLAUDE_OAUTH_CLIENT_SECRET || crypto.randomBytes(16).toString('hex');
    const resp = buildRegistrationResponse(req, client_id, client_secret);
    try {
      const fs = require('fs');
      fs.appendFileSync('debug-register.log', `RESPONSE: ${JSON.stringify(resp)}\n`);
    } catch (e) {}
    res.status(201).json(resp);
    return;
  } catch (e) {
    console.error('Registration response error', e.message);
    res.status(500).json({ ok: false, error: 'registration response failed' });
    return;
  }
});

const handleTokenRequest = (req, res) => {
  console.log('=== OAuth token request received ===');
  console.log('Path:', req.path);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = req.body;

  if (grant_type === 'authorization_code') {
    const { clientId, clientSecret } = getClientCredentials(req);

    if (CLAUDE_OAUTH_CLIENT_ID && clientId !== CLAUDE_OAUTH_CLIENT_ID) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Invalid client_id' });
    }

    if (CLAUDE_OAUTH_CLIENT_SECRET && clientSecret !== CLAUDE_OAUTH_CLIENT_SECRET) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Invalid client_secret' });
    }

    const auth = authCodes.get(code);
    if (!auth) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    if (redirect_uri && redirect_uri !== auth.redirect_uri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri does not match' });
    }

    if (auth.code_challenge) {
      if (!code_verifier) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier is required' });
      }
      const hashed = crypto.createHash('sha256').update(code_verifier).digest();
      const actualChallenge = normalizeBase64Url(hashed);
      if (actualChallenge !== auth.code_challenge) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
    }

    authCodes.delete(code);
    const accessToken = generateCode();
    const newRefreshToken = generateCode();
    accessTokens.set(accessToken, {
      client_id: auth.client_id,
      scope: auth.scope || 'openid',
      createdAt: Date.now(),
    });

    const tokenResponse = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: auth.scope || 'openid',
    };
    console.log('=== OAuth token response ===');
    console.log(JSON.stringify(tokenResponse, null, 2));
    return res.json(tokenResponse);
  }

  if (grant_type === 'refresh_token') {
    const newAccessToken = generateCode();
    accessTokens.set(newAccessToken, {
      client_id: client_id || 'claude',
      scope: req.body.scope || 'openid',
      createdAt: Date.now(),
    });
    const tokenResponse = {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh_token || generateCode(),
      scope: req.body.scope || 'openid',
    };
    console.log('=== OAuth refresh token response ===');
    console.log(JSON.stringify(tokenResponse, null, 2));
    return res.json(tokenResponse);
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
};

app.post(['/oauth/token', '/token'], handleTokenRequest);

app.post(['/oauth/introspect', '/introspect'], (req, res) => {
  console.log('=== OAuth introspection request received ===');
  console.log('Path:', req.path);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const token = req.body.token;
  const info = accessTokens.get(token);
  res.json({
    active: Boolean(info),
    scope: info?.scope || 'openid',
    client_id: info?.client_id || req.body.client_id || 'claude',
  });
});

app.post(['/oauth/revoke', '/revoke'], (req, res) => {
  console.log('=== OAuth revoke request received ===');
  console.log('Path:', req.path);
  console.log('Body:', JSON.stringify(req.body, null, 2));

  res.status(200).json({
    revoked: true,
  });
});

function buildOAuthMetadata(req) {
  const baseUrl = getBaseUrlFromRequest(req);
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    introspection_endpoint: `${baseUrl}/oauth/introspect`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    scopes_supported: ['openid'],
    code_challenge_methods_supported: ['S256'],
  };
}

app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server'], (req, res) => {
  console.log('=== OAuth metadata probe received ===');
  console.log('Path:', req.path);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  res.json(buildOAuthMetadata(req));
});

app.get('/.well-known/jwks.json', (req, res) => {
  res.json({ keys: [] });
});

app.post('/create-post', async (req, res) => {
  try {
    const post = await wp.createPost(req.body);
    res.status(201).json(post);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.post('/update-post', async (req, res) => {
  try {
    const { postId, ...updates } = req.body;
    if (!postId) {
      return res.status(400).json({ error: 'postId is required' });
    }
    const updated = await wp.updatePost(postId, updates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.post('/upload-image', async (req, res) => {
  try {
    const media = await wp.uploadMedia(req.body);
    res.status(201).json(media);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.post('/set-featured-image', async (req, res) => {
  try {
    const { postId, mediaId } = req.body;
    if (!postId || !mediaId) {
      return res.status(400).json({ error: 'postId and mediaId are required' });
    }
    const updated = await wp.setFeaturedImage(postId, mediaId);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

app.post('/create-post-with-image', async (req, res) => {
  try {
    const { imageUrl, imageBase64, fileName, mimeType, title, content, status = 'draft', excerpt, categories, tags } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const media = await wp.uploadMedia({ imageUrl, imageBase64, fileName, mimeType });
    const post = await wp.createPost({
      title,
      content,
      status,
      excerpt,
      categories,
      tags,
      featured_media: media.id,
    });

    res.status(201).json({ post, media });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

// OAuth compatibility routes to avoid 404s during connector flows
app.get('/authorized', (req, res) => {
  console.log('=== OAuth authorized callback received ===');
  console.log('Path:', req.path);
  console.log('Query:', req.query);

  const info = {
    path: req.path,
    query: req.query,
    message: 'Authorization callback received. If this was part of an OAuth flow, Claude should continue.'
  };
  res.setHeader('Content-Type', 'text/html');
  res.send(`<html><body><h2>WordPress MCP Server</h2><pre>${JSON.stringify(info,null,2)}</pre></body></html>`);
});

app.get(['/authorize', '/oauth/authorize'], (req, res) => {
  console.log('=== OAuth authorize request received ===');
  console.log('Path:', req.path);
  console.log('Query:', req.query);

  const {
    response_type,
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    state,
    scope,
  } = req.query;

  if (response_type !== 'code' || !client_id || !redirect_uri) {
    return res.status(400).send('Missing required OAuth authorize parameters');
  }

  if (CLAUDE_OAUTH_CLIENT_ID && client_id !== CLAUDE_OAUTH_CLIENT_ID) {
    return res.status(400).send('Invalid client_id');
  }

  if (CLAUDE_OAUTH_REDIRECT_URI && redirect_uri !== CLAUDE_OAUTH_REDIRECT_URI) {
    return res.status(400).send('Invalid redirect_uri');
  }

  const authCode = generateCode();
  authCodes.set(authCode, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope,
    createdAt: Date.now(),
  });

  const separator = redirect_uri.includes('?') ? '&' : '?';
  const destination = `${redirect_uri}${separator}code=${encodeURIComponent(authCode)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;

  console.log('Redirecting to:', destination);
  res.redirect(302, destination);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WordPress MCP Server listening on http://0.0.0.0:${PORT}`);
});
