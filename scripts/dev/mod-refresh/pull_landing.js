const { getJson } = require('./fetch'); const fs = require('fs');
const truth = JSON.parse(fs.readFileSync('truth_players.json','utf8'));
const ids = [...new Set(truth.filter(t => t.nhlId).map(t => t.nhlId))];
(async () => {
  const out = {};
  let n = 0;
  for (const id of ids) {
    const p = await getJson(`https://api-web.nhle.com/v1/player/${id}/landing`);
    if (p) out[id] = {
      id, first: p.firstName.default, last: p.lastName.default, bd: p.birthDate,
      pos: p.position, shoots: p.shootsCatches, hcm: p.heightInCentimeters, wkg: p.weightInKilograms,
      country: p.birthCountry, city: p.birthCity?.default, prov: p.birthStateProvince?.default,
      sweater: p.sweaterNumber ?? null, active: p.isActive, team: p.currentTeamAbbrev || null,
      draft: p.drafted ? null : null,
      draftDetails: p.draftDetails || null,
      seasons: (p.seasonTotals||[]).filter(s => s.gameTypeId === 2).map(s => ({
        y: s.season, lg: s.leagueAbbrev, team: s.teamName?.default || '',
        gp: s.gamesPlayed ?? 0, g: s.goals ?? 0, a: s.assists ?? 0, p: s.points ?? 0,
        pm: s.plusMinus ?? 0, pim: s.pim ?? 0,
        w: s.wins ?? null, l: s.losses ?? null, sv: s.savePctg ?? null, gaa: s.goalsAgainstAvg ?? null, toi: s.avgToi || null,
      })),
      career: p.careerTotals?.regularSeason || null,
    };
    if (++n % 100 === 0) process.stdout.write(`${n} `);
  }
  fs.writeFileSync('landings.json', JSON.stringify(out));
  console.log('\nlandings pulled', Object.keys(out).length, 'of', ids.length);
})();
