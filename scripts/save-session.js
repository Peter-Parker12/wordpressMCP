/**
 * save-session.js
 *
 * Run this script ONCE on your local machine (or VPS with a GUI) to capture
 * your Google/Gemini login session and save it for use by the MCP server.
 *
 * Usage:
 *   node scripts/save-session.js
 *
 * A Chromium browser window will open. Log in to your Google account,
 * navigate to https://labs.google/fx/tools/image-fx, then press Enter in
 * this terminal to save the session.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'data', 'gemini-session.json');

(async () => {
  console.log('Opening browser... Log in to your Google account.');
  console.log('Navigate to: https://labs.google/fx/tools/image-fx');
  console.log('Once you are logged in and see the ImageFX interface,');
  console.log('press ENTER here to save the session.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://accounts.google.com');

  // Wait for user to press Enter
  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  // Save storage state (cookies + localStorage)
  const storageState = await context.storageState();
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(storageState, null, 2));

  console.log('Session saved to:', SESSION_FILE);
  console.log('You can now restart the MCP server Docker container.');

  await browser.close();
  process.exit(0);
})();
