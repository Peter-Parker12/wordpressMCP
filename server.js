const express = require('express');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { createWordPressClient } = require('./src/wordpress');
const manifest = require('./mcp-manifest.json');

dotenv.config();

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 4000;
const WP_URL = process.env.WP_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
  console.error('Missing WordPress configuration in .env. Please set WP_URL, WP_USERNAME, and WP_APP_PASSWORD.');
  process.exit(1);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', site: WP_URL });
});

app.get('/', (req, res) => {
  res.json(manifest);
});

app.get('/.well-known/mcp', (req, res) => {
  res.json(manifest);
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

  return {
    client_id,
    client_secret,
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
    const client_id = `claude-${crypto.randomBytes(16).toString('hex')}`;
    const client_secret = crypto.randomBytes(16).toString('hex');
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
    const client_id = `claude-${crypto.randomBytes(16).toString('hex')}`;
    const client_secret = crypto.randomBytes(16).toString('hex');
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

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: auth.scope || 'openid',
    });
  }

  if (grant_type === 'refresh_token') {
    const newAccessToken = generateCode();
    accessTokens.set(newAccessToken, {
      client_id: client_id || 'claude',
      scope: req.body.scope || 'openid',
      createdAt: Date.now(),
    });
    return res.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh_token || generateCode(),
      scope: req.body.scope || 'openid',
    });
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
