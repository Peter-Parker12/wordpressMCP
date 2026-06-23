const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'gemini-session.json');
const IMAGEFX_URL = 'https://labs.google/fx/tools/image-fx';

function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

/**
 * Generate an image using Google ImageFX (Imagen 3) via Playwright browser automation.
 * Requires a saved session file at data/gemini-session.json.
 *
 * @param {object} options
 * @param {string} options.prompt - Text prompt
 * @param {string} [options.aspectRatio] - '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
 * @returns {Promise<{ base64: string, mimeType: string }[]>}
 */
async function generateImagePro({ prompt, aspectRatio = '16:9' }) {
  if (!sessionExists()) {
    throw new Error('No Gemini session found. Run: node scripts/save-session.js on the server first.');
  }

  const storageState = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    // Navigate to ImageFX
    await page.goto(IMAGEFX_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Check if redirected to login (session expired)
    if (page.url().includes('accounts.google.com')) {
      await browser.close();
      throw new Error('Gemini session expired. Re-run: node scripts/save-session.js');
    }

    // Set aspect ratio if supported
    const aspectMap = { '16:9': 'Landscape', '9:16': 'Portrait', '1:1': 'Square', '4:3': 'Landscape', '3:4': 'Portrait' };
    const aspectLabel = aspectMap[aspectRatio] || 'Landscape';

    try {
      // Try to find aspect ratio selector
      const aspectBtn = page.locator('[aria-label*="aspect"], [data-aspect], button:has-text("' + aspectLabel + '")').first();
      if (await aspectBtn.isVisible({ timeout: 3000 })) {
        await aspectBtn.click();
      }
    } catch (_) { /* aspect ratio selector not found, continue */ }

    // Find the prompt textarea and type
    const textarea = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
    await textarea.waitFor({ state: 'visible', timeout: 15000 });
    await textarea.click();
    await textarea.fill('');
    await textarea.type(prompt, { delay: 20 });

    // Click Generate button
    const generateBtn = page.locator('button:has-text("Generate"), button[aria-label*="generate"], button[aria-label*="Generate"]').first();
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 });
    await generateBtn.click();

    // Wait for image to appear (up to 60s)
    await page.waitForSelector('img[src*="data:image"], img[src*="blob:"], img[src*="aisandbox"], img[src*="generativelanguage"], .generated-image img', {
      timeout: 60000,
    });

    // Small wait for full render
    await page.waitForTimeout(1500);

    // Get all generated images
    const images = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
        const src = img.src || '';
        return (
          src.startsWith('data:image') ||
          src.includes('generativelanguage') ||
          src.includes('aisandbox') ||
          (img.naturalWidth > 200 && img.naturalHeight > 200 && !src.includes('logo') && !src.includes('icon'))
        );
      });
      return imgs.slice(0, 4).map(img => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight }));
    });

    if (images.length === 0) {
      // Fallback: screenshot the generated area
      const screenshotBuffer = await page.screenshot({ fullPage: false });
      await browser.close();
      return [{ base64: screenshotBuffer.toString('base64'), mimeType: 'image/png' }];
    }

    // Convert image src to base64
    const results = await Promise.all(images.slice(0, 1).map(async (imgInfo) => {
      if (imgInfo.src.startsWith('data:image')) {
        const [header, data] = imgInfo.src.split(',');
        const mimeType = header.match(/data:(image\/\w+)/)?.[1] || 'image/jpeg';
        return { base64: data, mimeType };
      }
      // Fetch external URL via page
      const buffer = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const arr = Array.from(new Uint8Array(await res.arrayBuffer()));
        return arr;
      }, imgInfo.src);
      return { base64: Buffer.from(buffer).toString('base64'), mimeType: 'image/jpeg' };
    }));

    await browser.close();
    return results;

  } catch (err) {
    await browser.close();
    throw err;
  }
}

module.exports = { generateImagePro, sessionExists };
