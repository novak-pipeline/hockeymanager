// Polite caching fetcher for NHL public API.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

function keyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + '.json';
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url, { retries = 3 } = {}) {
  const f = path.join(CACHE, keyFor(url));
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* refetch */ }
  }
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'hockey-sim-dev/1.0' } , redirect: 'follow' });
      if (res.status === 404) { fs.writeFileSync(f, 'null'); return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const j = await res.json();
      fs.writeFileSync(f, JSON.stringify(j));
      await sleep(90);
      return j;
    } catch (e) { lastErr = e; await sleep(600 * (i + 1)); }
  }
  throw lastErr;
}
module.exports = { getJson, sleep, CACHE };
