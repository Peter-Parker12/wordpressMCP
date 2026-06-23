/**
 * import-cookies.js
 *
 * Converts a cookies JSON file exported from the "Cookie-Editor" browser extension
 * into Playwright's storageState format, saved to data/gemini-session.json.
 *
 * Usage:
 *   1. Install "Cookie-Editor" in Chrome/Edge: https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm
 *   2. Navigate to https://labs.google/fx/tools/image-fx while logged in to Google
 *   3. Click the Cookie-Editor extension icon → Export → "Export as JSON" → copy to a file (e.g. cookies.json)
 *   4. Run: node scripts/import-cookies.js cookies.json
 *   5. Upload the output: scp data/gemini-session.json user@vps:~/Erasight.edu/wordpressMCP/data/
 */

const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];

if (!inputFile) {
  console.error('Usage: node scripts/import-cookies.js <cookies.json>');
  console.error('');
  console.error('How to get cookies.json:');
  console.error('  1. Install Cookie-Editor extension in Chrome/Edge');
  console.error('  2. Go to https://labs.google/fx/tools/image-fx (logged in with Google Pro)');
  console.error('  3. Click extension icon → Export → Export as JSON');
  console.error('  4. Save the copied JSON to a file named cookies.json');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error('File not found:', inputFile);
  process.exit(1);
}

let rawCookies;
try {
  rawCookies = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
} catch (e) {
  console.error('Failed to parse JSON:', e.message);
  process.exit(1);
}

// Cookie-Editor exports an array of cookie objects
// Playwright storageState expects: { cookies: [...], origins: [] }
// Map sameSite values to Playwright-compatible values
const sameSiteMap = {
  'Strict': 'Strict',
  'Lax': 'Lax',
  'None': 'None',
  'no_restriction': 'None',
  'lax': 'Lax',
  'strict': 'Strict',
  'unspecified': 'Lax',
};

const playwrightCookies = rawCookies.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain.startsWith('.') ? c.domain : '.' + c.domain,
  path: c.path || '/',
  expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
  httpOnly: c.httpOnly || false,
  secure: c.secure || false,
  sameSite: sameSiteMap[c.sameSite] || 'Lax',
}));

const storageState = {
  cookies: playwrightCookies,
  origins: [],
};

const outputDir = path.join(__dirname, '..', 'data');
const outputFile = path.join(outputDir, 'gemini-session.json');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(storageState, null, 2));

console.log(`✓ Converted ${playwrightCookies.length} cookies`);
console.log(`✓ Saved to: ${outputFile}`);
console.log('');
console.log('Next step — upload to VPS:');
console.log(`  scp data/gemini-session.json user@your-vps:~/Erasight.edu/wordpressMCP/data/`);
