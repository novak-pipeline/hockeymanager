const { getJson } = require('./fetch'); const fs = require('fs');
const B = 'https://api.nhle.com/stats/rest/en';
async function paged(path, exp, sort) {
  const out = []; let start = 0;
  for (;;) {
    const url = `${B}/${path}?isAggregate=false&isGame=false&start=${start}&limit=100&sort=${encodeURIComponent(sort)}&cayenneExp=${encodeURIComponent(exp)}`;
    const j = await getJson(url);
    if (!j || !j.data || j.data.length === 0) break;
    out.push(...j.data);
    if (out.length >= (j.total || 0)) break;
    start += 100;
    if (start > 3000) break;
  }
  return out;
}
(async () => {
  const sort = JSON.stringify([{ property: 'playerId', direction: 'ASC' }]);
  for (const season of ['20252026']) {
    const sk = await paged('skater/summary', `seasonId=${season} and gameTypeId=2`, sort);
    fs.writeFileSync(`skaters_${season}.json`, JSON.stringify(sk));
    console.log('skaters', season, sk.length);
    const sk2 = await paged('skater/realtime', `seasonId=${season} and gameTypeId=2`, sort);
    fs.writeFileSync(`skaters_rt_${season}.json`, JSON.stringify(sk2));
    console.log('skaters realtime', season, sk2.length);
    const sk3 = await paged('skater/timeonice', `seasonId=${season} and gameTypeId=2`, sort);
    fs.writeFileSync(`skaters_toi_${season}.json`, JSON.stringify(sk3));
    console.log('skaters toi', season, sk3.length);
    const g = await paged('goalie/summary', `seasonId=${season} and gameTypeId=2`, sort);
    fs.writeFileSync(`goalies_${season}.json`, JSON.stringify(g));
    console.log('goalies', season, g.length);
  }
  const d26 = await getJson('https://api-web.nhle.com/v1/draft/picks/2026/all');
  fs.writeFileSync('draft2026.json', JSON.stringify(d26));
  console.log('draft2026 picks', d26.picks ? d26.picks.length : 'n/a', Object.keys(d26));
})();
