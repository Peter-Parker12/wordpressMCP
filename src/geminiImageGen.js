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
 * Requires data/gemini-session.json — run: node scripts/import-cookies.js cookies.json
 *
 * @param {object} options
 * @param {string} options.prompt        - Text prompt
 * @param {string} [options.aspectRatio] - '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
 * @returns {Promise<{ base64: string, mimeType: string }[]>}
 */
async function generateImagePro({ prompt, aspectRatio = '16:9' }) {
  if (!sessionExists()) {
    throw new Error(
      'No Gemini session found. Export cookies from Chrome (Cookie-Editor extension) then run: node scripts/import-cookies.js cookies.json'
    );
  }

  const storageState = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await page.goto(IMAGEFX_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Session expired check
    if (page.url().includes('accounts.google.com')) {
      await browser.close();
      throw new Error('Gemini session expired. Re-export cookies and run import-cookies.js again.');
    }

    // Set aspect ratio
    const aspectMap = {
      '16:9': 'Landscape',
      '9:16': 'Portrait',
      '1:1':  'Square',
      '4:3':  'Landscape',
      '3:4':  'Portrait',
    };
    const aspectLabel = aspectMap[aspectRatio] || 'Landscape';

    try {
      const aspectBtn = page.locator(`button:has-text("${aspectLabel}")`).first();
      if (await aspectBtn.isVisible({ timeout: 3000 })) {
        await aspectBtn.click();
      }
    } catch (_) { /* aspect ratio selector unavailable */ }

    // Type prompt
    const textarea = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
    await textarea.waitFor({ state: 'visible', timeout: 15000 });
    await textarea.click();
    await textarea.fill('');
    await textarea.type(prompt, { delay: 15 });

    // Click Generate
    const generateBtn = page.locator('button:has-text("Generate"), button[aria-label*="Generate"]').first();
    await generateBtn.waitFor({ state: 'visible', timeout: 10000 });
    await generateBtn.click();

    // Wait for generated image to appear (up to 60s)
    await page.waitForSelector(
      'img[src*="data:image"], img[src*="aisandbox"], img[src*="generativelanguage"]',
      { timeout: 60000 }
    );
    await page.waitForTimeout(1500);

    // Extract image
    const images = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .filter(img => {
          const src = img.src || '';
          return (
            src.startsWith('data:image') ||
            src.includes('aisandbox') ||
            src.includes('generativelanguage') ||
            (img.naturalWidth > 300 && img.naturalHeight > 300 &&
             !src.includes('logo') && !src.includes('icon') && !src.includes('avatar'))
          );
        })
        .slice(0, 1)
        .map(img => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight }));
    });

    let result;

    if (images.length === 0) {
      // Fallback: screenshot the page
      const buf = await page.screenshot();
      result = { base64: buf.toString('base64'), mimeType: 'image/png' };
    } else if (images[0].src.startsWith('data:image')) {
      const [header, data] = images[0].src.split(',');
      const mimeType = header.match(/data:(image\/\w+)/)?.[1] || 'image/jpeg';
      result = { base64: data, mimeType };
    } else {
      // Fetch via page context (handles auth-protected URLs)
      const buffer = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return Array.from(new Uint8Array(await res.arrayBuffer()));
      }, images[0].src);
      result = { base64: Buffer.from(buffer).toString('base64'), mimeType: 'image/jpeg' };
    }

    await browser.close();
    return [result];

  } catch (err) {
    await browser.close();
    throw err;
  }
}

module.exports = { generateImagePro, sessionExists };
