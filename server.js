const express = require('express');
const dotenv = require('dotenv');
const { createWordPressClient } = require('./src/wordpress');

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

app.listen(PORT, () => {
  console.log(`WordPress MCP Server listening on http://localhost:${PORT}`);
});
