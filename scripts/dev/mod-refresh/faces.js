/**
 * Fill facepack gaps for the 2026-27 DB.
 *
 * Source: the NHL's own public headshot CDN (assets.nhle.com/mugs/nhl/...).
 * The CDN serves a generic silhouette for players with no photo on file, so every
 * download is hashed and discarded if it matches one of those placeholders.
 * Files are written as mods/nhl-ehm/faces/<faceId>.png, matching the pack's
 * existing naming convention exactly (see facekey.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load, walk } = require('./dbio');
const { strip, lev } = require('./dbmatch');

const FACES = 'K:/Hockey Game/mods/nhl-ehm/faces';
const DB = process.env.DB || 'K:/Hockey Game/mods/nhl-ehm/database.2026-27.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');

async function getBuf(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'hockey-sim-dev/1.0' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch { await sleep(500 * (i + 1)); }
  }
  return null;
}

(async () => {
  /* 1. Placeholder fingerprints. */
  const placeholders = new Set();
  for (const n of ['default-skater', 'default-goalie', 'skater', 'goalie']) {
    const b = await getBuf(`https://assets.nhle.com/mugs/nhl/${n}.png`);
    if (b) { placeholders.add(sha(b)); console.log(`placeholder ${n}.png sha ${sha(b).slice(0, 10)} (${b.length}b)`); }
  }

  /* 2. Every NHL person we have an id for, keyed by birthdate. */
  const known = new Map();   // 'YYYY-MM-DD' -> [{ id, name }]
  const add = (bd, id, name) => {
    if (!bd || !id) return;
    if (!known.has(bd)) known.set(bd, []);
    if (!known.get(bd).some((x) => String(x.id) === String(id))) known.get(bd).push({ id, name });
  };
  for (const t of JSON.parse(fs.readFileSync('truth_players.json', 'utf8'))) add(t.bd, t.nhlId, `${t.first} ${t.last}`);
  for (const p of JSON.parse(fs.readFileSync('draft2026_full.json', 'utf8'))) add(p.bd, p.nhlId, `${p.first} ${p.last}`);
  for (const l of Object.values(JSON.parse(fs.readFileSync('landings.json', 'utf8')))) add(l.bd, l.id, `${l.first} ${l.last}`);
  for (const list of Object.values(JSON.parse(fs.readFileSync('rosters2627.json', 'utf8'))))
    for (const p of list) add(p.birthDate, p.id, `${p.firstName.default} ${p.lastName.default}`);
  console.log(`known NHL ids: ${[...known.values()].reduce((a, x) => a + x.length, 0)} across ${known.size} birthdates`);

  /* 3. Face-less players in the new DB, priority first. */
  const have = new Set(fs.readdirSync(FACES).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
  const targets = [];
  for (const { p, loc } of walk(load(DB))) {
    if (!p.faceId || have.has(p.faceId)) continue;
    const m = /_(\d{1,2})_(\d{1,2})_(\d{4})$/.exec(p.faceId);
    if (!m) continue;
    const bd = `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
    const cands = known.get(bd) || [];
    const key = strip(p.name);
    const hit = cands.find((c) => strip(c.name) === key) || cands.find((c) => lev(strip(c.name), key) <= 2)
      || (cands.length === 1 ? cands[0] : null);
    if (!hit) continue;
    const pri = p.draftYear === 2026 ? 0 : loc.kind === 'nhl' ? 1 : loc.kind === 'ahl' ? 2 : 3;
    targets.push({ face: p.faceId, id: hit.id, name: p.name, pri, kind: loc.kind });
  }
  targets.sort((a, b) => a.pri - b.pri);
  console.log(`face-less players with a resolvable NHL id: ${targets.length}`,
    targets.reduce((a, t) => { a[t.pri] = (a[t.pri] || 0) + 1; return a; }, {}));

  /* 4. Download. */
  let saved = 0, placeholder = 0, missing = 0;
  const savedList = [], placeholderList = [];
  for (const t of targets) {
    const buf = await getBuf(`https://assets.nhle.com/mugs/nhl/latest/${t.id}.png`);
    await sleep(60);
    if (!buf) { missing++; continue; }
    if (placeholders.has(sha(buf)) || buf.length < 13000) { placeholder++; placeholderList.push(t.name); continue; }
    fs.writeFileSync(path.join(FACES, `${t.face}.png`), buf);
    saved++; savedList.push(`${t.name} -> ${t.face}.png`);
    if (saved % 25 === 0) process.stdout.write(`${saved} `);
  }
  console.log();
  console.log(`saved ${saved} new faces | ${placeholder} had only the CDN placeholder | ${missing} had no image`);
  fs.writeFileSync('faces_report.json', JSON.stringify({ saved: savedList, placeholder: placeholderList }, null, 1));
})();
