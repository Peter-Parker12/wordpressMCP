const axios = require('axios');
const FormData = require('form-data');

function createWordPressClient({ url, username, password }) {
  const client = axios.create({
    baseURL: `${url.replace(/\/$/, '')}/wp-json/wp/v2`,
    auth: { username, password },
    headers: {
      'Accept': 'application/json',
    },
    timeout: 20000,
  });

  async function createPost(payload) {
    const body = {
      title: payload.title,
      content: payload.content,
      status: payload.status || 'draft',
      excerpt: payload.excerpt,
      categories: payload.categories,
      tags: payload.tags,
      featured_media: payload.featured_media,
    };
    const response = await client.post('/posts', body);
    return response.data;
  }

  async function updatePost(postId, updates) {
    const payload = { ...updates };
    const response = await client.post(`/posts/${postId}`, payload);
    return response.data;
  }

  async function getPosts(query = {}) {
    const response = await client.get('/posts', { params: query });
    return response.data;
  }

  async function getPost(postId) {
    const response = await client.get(`/posts/${postId}`);
    return response.data;
  }

  async function uploadMedia({ imageUrl, imageBase64, fileName, mimeType }) {
    let buffer;
    let finalFileName = fileName;
    let finalMimeType = mimeType || 'application/octet-stream';

    if (imageUrl) {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      buffer = Buffer.from(imageResponse.data);
      finalMimeType = imageResponse.headers['content-type'] || finalMimeType;
      if (!finalFileName) {
        finalFileName = imageUrl.split('/').pop().split('?')[0] || 'upload.bin';
      }
    } else if (imageBase64) {
      buffer = Buffer.from(imageBase64, 'base64');
      finalFileName = finalFileName || 'upload.bin';
    } else {
      throw new Error('Either imageUrl or imageBase64 must be provided for uploadMedia');
    }

    const form = new FormData();
    form.append('file', buffer, {
      filename: finalFileName,
      contentType: finalMimeType,
    });

    const headers = {
      ...form.getHeaders(),
      'Content-Disposition': `attachment; filename="${finalFileName}"`,
    };

    const response = await client.post('/media', form, { headers });
    return response.data;
  }

  async function setFeaturedImage(postId, mediaId) {
    const response = await client.post(`/posts/${postId}`, { featured_media: mediaId });
    return response.data;
  }

  async function getCurrentUser() {
    const response = await client.get('/users/me');
    return response.data;
  }

  return {
    createPost,
    updatePost,
    getPosts,
    getPost,
    uploadMedia,
    setFeaturedImage,
    getCurrentUser,
  };
}

module.exports = { createWordPressClient };
