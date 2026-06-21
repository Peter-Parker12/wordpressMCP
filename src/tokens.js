const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const FILE = path.join(DATA_DIR, 'tokens.json');

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) return { clients: {}, authCodes: {}, tokens: {} };
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { clients: {}, authCodes: {}, tokens: {} };
  }
}

function persist(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to persist tokens:', err.message);
  }
}

let state = load();

module.exports = {
  saveClient(id, data) {
    state.clients[id] = data;
    persist(state);
  },
  getClient(id) {
    return state.clients[id] || null;
  },

  saveAuthCode(code, data) {
    state.authCodes[code] = { ...data, createdAt: Date.now() };
    persist(state);
  },
  getAuthCode(code) {
    const entry = state.authCodes[code];
    if (!entry) return null;
    if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
      delete state.authCodes[code];
      persist(state);
      return null;
    }
    return entry;
  },
  deleteAuthCode(code) {
    delete state.authCodes[code];
    persist(state);
  },

  saveToken(accessToken, data) {
    state.tokens[accessToken] = { ...data, createdAt: Date.now() };
    persist(state);
  },
  getToken(accessToken) {
    return state.tokens[accessToken] || null;
  },
  getTokenByRefresh(refreshToken) {
    for (const [accessToken, data] of Object.entries(state.tokens)) {
      if (data.refreshToken === refreshToken) return { accessToken, ...data };
    }
    return null;
  },
  deleteToken(accessToken) {
    delete state.tokens[accessToken];
    persist(state);
  },
};
