const express = require('express');
const dotenv = require('dotenv');
const { createWordPressClient } = require('./src/wordpress');
const manifest = require('./mcp-manifest.json');

dotenv.config();

const app = express();
app.use(express.json({ limit: '15mb' }));

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
    const crypto = require('crypto');
    const gen = () => crypto.randomBytes(16).toString('hex');
    const client_id = `claude-${gen()}`;
    const client_secret = gen();
    const resp = {
      client_id,
      client_secret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
      grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: req.body.response_types || ['code'],
      redirect_uris: req.body.redirect_uris || [],
      client_name: req.body.client_name || 'claude',
      application_type: req.body.application_type || 'web',
    };
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
    const crypto = require('crypto');
    const gen = () => crypto.randomBytes(16).toString('hex');
    const client_id = `claude-${gen()}`;
    const client_secret = gen();
    const resp = {
      client_id,
      client_secret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
      grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: req.body.response_types || ['code'],
      redirect_uris: req.body.redirect_uris || [],
      client_name: req.body.client_name || 'claude',
      application_type: req.body.application_type || 'web',
    };
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
  const info = {
    path: req.path,
    query: req.query,
    message: 'Authorization callback received. If this was part of an OAuth flow, Claude should continue.'
  };
  res.setHeader('Content-Type', 'text/html');
  res.send(`<html><body><h2>WordPress MCP Server</h2><pre>${JSON.stringify(info,null,2)}</pre></body></html>`);
});

app.get('/oauth/authorize', (req, res) => {
  const info = { path: req.path, query: req.query };
  res.setHeader('Content-Type', 'text/html');
  res.send(`<html><body><h2>OAuth Authorize (compat)</h2><pre>${JSON.stringify(info,null,2)}</pre></body></html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WordPress MCP Server listening on http://0.0.0.0:${PORT}`);
});
