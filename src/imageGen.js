const axios = require('axios');

/**
 * Generate an image using Pollinations.ai (free, no API key required).
 *
 * @param {object} options
 * @param {string} options.prompt        - Text prompt describing the image
 * @param {string} [options.aspectRatio] - '1:1' | '16:9' | '9:16' | '4:3' | '3:4' (default '16:9')
 * @returns {Promise<{ base64: string, mimeType: string }[]>}
 */
async function generateImage({ prompt, aspectRatio = '1:1' }) {
  const dimensions = {
    '1:1':  { width: 1024, height: 1024 },
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720,  height: 1280 },
    '4:3':  { width: 1024, height: 768 },
    '3:4':  { width: 768,  height: 1024 },
  };
  const { width, height } = dimensions[aspectRatio] || dimensions['16:9'];

  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=flux`;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  const base64 = Buffer.from(response.data).toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';

  return [{ base64, mimeType }];
}

module.exports = { generateImage };
