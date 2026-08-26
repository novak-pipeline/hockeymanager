const fs = require('fs');
const B = 'G0BxRlHk_YrLZ86o2dZ_z';
const slugs = require('./cw_teamslugs.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const out = {};
  for (const s of slugs) {
    const f = `cw_team_${s}.json`;
    let j;
    if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, 'utf8'));
    else {
      const res = await fetch(`https://capwages.com/_next/data/${B}/teams/${s}.json`, { headers: { 'User-Agent': 'Mozilla/5.0 (hockey-sim-dev)' } });
      if (!res.ok) { console.log('FAIL', s, res.status); continue; }
      j = await res.json();
      fs.writeFileSync(f, JSON.stringify(j));
      await sleep(900);
    }
    out[s] = j.pageProps;
    const d = j.pageProps.data;
    const n = ['roster', 'non-roster'].map(k => ['forwards','defense','goalies'].reduce((a,g)=>a+((d[k]&&d[k][g])||[]).length,0));
    process.stdout.write(`${j.pageProps.teamMetadata.tricode}:${n[0]}/${n[1]} `);
  }
  console.log();
  fs.writeFileSync('cw_all.json', JSON.stringify(out));
  console.log('teams pulled', Object.keys(out).length);
})();
