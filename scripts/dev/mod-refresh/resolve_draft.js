/**
 * Resolve the 224 real 2026 entry-draft picks to NHL player records.
 *
 * Names/slots/teams come from api-web.nhle.com/v1/draft/picks/2026/all and are
 * NEVER overwritten. Birthdates come from the NHL player search + landing, and
 * every identity is then CONFIRMED against that player's own draftDetails
 * (year 2026 + the same overall pick). Anything that fails confirmation is left
 * unresolved rather than guessed.
 */
const { getJson } = require('./fetch');
const fs = require('fs');
const { strip, soft } = require('./dbmatch');

const SEARCH = (q) => `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=30&q=${encodeURIComponent(q)}`;
const LAND = (id) => `https://api-web.nhle.com/v1/player/${id}/landing`;

(async () => {
  const raw = require('./draft2026.json');
  const out = [];
  let confirmed = 0;
  const unresolved = [];

  for (const pk of raw.picks) {
    const first = (pk.firstName && pk.firstName.default) || '';
    const last = (pk.lastName && pk.lastName.default) || '';
    const row = {
      round: pk.round, overall: pk.overallPick, team: pk.teamAbbrev,
      first: first.replace(/\s*\(.*?\)\s*/g, ' ').trim(), last,
      pos: pk.positionCode, country: pk.countryCode,
      amLeague: pk.amateurLeague, amClub: pk.amateurClubName,
      nhlId: null, bd: null, hcm: null, wkg: null, city: null,
    };
    if (!row.last || /forfeit/i.test(`${row.first} ${row.last}`)) { out.push(row); continue; }

    const L = strip(last);
    const queries = [`${row.first} ${last}`, last, last.split(' ')[0]];
    for (const q of queries) {
      const res = await getJson(SEARCH(q));
      if (!Array.isArray(res)) continue;
      // Prefer active players; the shared-name veterans are all inactive.
      const cands = [...res.filter((x) => x.active === true || x.active === 'true'), ...res];
      const named = cands.filter((x) => {
        const xl = (x.name || '').split(' ').slice(1).join(' ');
        return strip(xl) === L || soft(xl) === soft(L) || strip(x.name || '').includes(L);
      });
      // Multi-word and apostrophe surnames (Ta'amu, Wilde Larsen) defeat the
      // name filter, so fall back to every active hit: the draftDetails check
      // below is definitive on its own - a record that says "2026, pick #N"
      // cannot belong to anyone but the player taken at #N.
      const ranked = named.length ? named : cands.filter((x) => x.active === true || x.active === 'true').slice(0, 30);
      let hit = null;
      for (const c of ranked) {
        const land = await getJson(LAND(c.playerId));
        const d = land && land.draftDetails;
        // The player's OWN record must say 2026 at this exact slot.
        if (d && d.year === 2026 && d.overallPick === row.overall) {
          hit = { c, land };
          break;
        }
      }
      if (!hit) continue;
      row.nhlId = hit.c.playerId;
      row.bd = hit.land.birthDate;
      row.hcm = hit.land.heightInCentimeters;
      row.wkg = hit.land.weightInKilograms;
      row.city = hit.land.birthCity && hit.land.birthCity.default;
      row.country = hit.land.birthCountry || row.country;
      confirmed++;
      break;
    }
    if (!row.bd && row.last && !/forfeit/i.test(row.last)) unresolved.push(`#${row.overall} ${row.team} ${row.first} ${row.last} (${row.amLeague} ${row.amClub})`);
    out.push(row);
    process.stdout.write(row.bd ? '.' : '?');
  }
  console.log();
  fs.writeFileSync('draft2026_full.json', JSON.stringify(out, null, 1));
  fs.writeFileSync('draft_unresolved.json', JSON.stringify(unresolved, null, 1));
  console.log(`picks ${out.length} | identity CONFIRMED against the player's own draft record: ${confirmed} | unresolved: ${unresolved.length}`);
  unresolved.forEach((u) => console.log('  ', u));
})();
