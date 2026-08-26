/**
 * Bring the NON-PLAYER surface of mods/nhl-ehm/database.json up to reality as of
 * 26 August 2026 (i.e. ready for the 2026-27 season).
 *
 * Player data (rosters, contracts, prospects) is deliberately NOT touched — that
 * surface is owned separately. This script only edits:
 *   - team staff (the 2026 head-coaching carousel)
 *   - team affiliates
 *   - team retiredNumbers
 *   - history.competitionHistory (2026 rows)
 *   - history.clubRecords (records broken in 2025-26; club-name normalisation)
 *   - meta.season
 *
 * It is IDEMPOTENT: running it twice produces the same file, so it can be re-run
 * after someone else rewrites the player side.
 *
 * Every change and its source is recorded in docs/MOD-DB-2026-NONPLAYER.md.
 *
 * Usage:  node scripts/dev/mod-db-2026-nonplayer.mjs [path-to-database.json]
 */
import fs from 'node:fs'
import path from 'node:path'

const target = process.argv[2] ?? path.join(process.cwd(), 'mods', 'nhl-ehm', 'database.json')

/* ─────────────────────────── the 2026 coaching carousel ───────────────────────────
 * Sources (all three agree, and Wikipedia carries the firing dates):
 *   nhl.com "List of NHL coaches" (updated 23 June 2026) — the 32-team list
 *   en.wikipedia.org/wiki/2026-27_NHL_season — firing/hiring dates
 *   deseret.com 21 Aug 2026 / bleacherreport.com 28 Jul 2026 — corroboration
 *
 * RATING RULE (see the doc; no number here is invented free-hand):
 *   Ratings live on the export's own 5-point lattice, band [75, 95] for an NHL
 *   head coach. A new man starts from the rating of the coach he replaces, then:
 *     −5 if he has never been an NHL head coach before,
 *     −5 if the man he replaces won a Stanley Cup as an NHL head coach and he has not,
 *     +5 if he won a Stanley Cup as an NHL head coach and the man he replaces has not,
 *   clamped into [75, 95]. A coach already in this database who merely changes
 *   club (or is promoted from the AHL band) keeps his own attributes; only his
 *   rating moves, and only to enter the NHL band.
 *   judgment = 80, the median judgment of the export's own 32 NHL head coaches.
 *   specialty follows the man's playing position (forward → Forwards, D → Defense).
 *   attributes are omitted for men not already in the file: the loader's documented
 *   fallback (deriveSyntheticProfile) builds their tactical profile from the rating,
 *   which is honest, where invented per-attribute numbers would not be.
 */
const COACH_CHANGES = [
  {
    abbr: 'TOR',
    out: 'Craig Berube',
    in: { name: 'Jim Hiller', role: 'headCoach', rating: 80, judgment: 80, specialty: 'Forwards' },
    // Berube 85, Cup 2019 (STL); Hiller has NHL HC experience (LAK 2023-26), no Cup → 85 − 5.
  },
  {
    abbr: 'LAK',
    out: 'D.J. Smith',
    in: { name: 'Peter Laviolette', role: 'headCoach', rating: 80, judgment: 80, specialty: 'Defense' },
    // D.J. Smith 75 (interim), no Cup; Laviolette won the Cup in 2006 (CAR) → 75 + 5.
  },
  {
    abbr: 'EDM',
    out: 'Kris Knoblauch',
    in: { name: 'Mike Babcock', role: 'headCoach', rating: 90, judgment: 80, specialty: 'Defense' },
    // Knoblauch 85, no Cup; Babcock won the Cup in 2008 (DET) → 85 + 5.
  },
  {
    abbr: 'VGK',
    out: 'John Tortorella',
    in: { name: 'Ryan Craig', role: 'headCoach', rating: 75, judgment: 80, specialty: 'Forwards' },
    // Tortorella 85 (interim), Cup 2004 (TBL); Craig is a first-time NHL HC → 85 − 5 − 5.
  },
  {
    abbr: 'VAN',
    out: 'Adam Foote',
    // Malhotra is already in the file as Vancouver's AHL (Abbotsford) head coach at 64.
    // He keeps his own attributes/face; only the rating moves, from the export's AHL
    // head-coach band into the NHL band: 75 (Foote) − 5 (first-time NHL HC), clamped to 75.
    promote: { name: 'Manny Malhotra', rating: 75, judgment: 80 },
  },
]

/* ─────────────────────────── affiliates ───────────────────────────
 * Source: nhl.com/hurricanes "Canes Announce Affiliation Agreement With Chicago
 * Wolves" (multi-year, runs through 2026-27) + en.wikipedia.org 2025-26 AHL season,
 * which lists Chicago Wolves (Carolina). Every other NHL/AHL pairing in the file
 * already matches that list, so Carolina — which had no affiliate at all — is the
 * only change. Roster is left empty on purpose: the loader tops every affiliate up
 * to valid minimums, and the player surface is not ours to write.
 */
const AFFILIATE_ADDS = [
  {
    abbr: 'CAR',
    affiliate: {
      city: 'Chicago',
      nickname: 'Wolves',
      // The AHL's own three-letter code. It duplicates the Blackhawks' abbreviation
      // exactly as the Marlies already duplicate the Maple Leafs' in this file.
      abbreviation: 'CHI',
      // 29 of the file's 31 affiliates carry their parent club's colours; follow that
      // convention rather than inventing hex values for the Wolves.
      primary: '#CC0000',
      secondary: '#000000',
      players: [],
    },
  },
]

/* ─────────────────────────── retired numbers ───────────────────────────
 * Six clubs carried another league's data entirely (Florida held the Nottingham
 * Panthers' banners, New Jersey Cardiff's, Philadelphia Kloten/ZSC's, and the
 * Rangers/Blues/Golden Knights lists were simply wrong). Replaced with the real
 * lists, cross-checked against en.wikipedia.org "List of National Hockey League
 * retired numbers" plus, per club, nhl.com / ESPN / SI reporting on each ceremony.
 * No. 99 is retired league-wide and the file already carries it for 29 of 32 clubs,
 * so it is carried here too.
 */
const G = { number: 99, player: 'Wayne Gretzky' }
const RETIRED_NUMBERS = {
  FLA: [
    { number: 1, player: 'Roberto Luongo' },
    { number: 37, player: 'Wayne Huizenga' },
    { number: 93, player: 'Bill Torrey' },
    G,
  ],
  NJD: [
    { number: 3, player: 'Ken Daneyko' },
    { number: 4, player: 'Scott Stevens' },
    { number: 26, player: 'Patrik Eliáš' },
    { number: 27, player: 'Scott Niedermayer' },
    { number: 30, player: 'Martin Brodeur' },
    G,
  ],
  NYR: [
    { number: 1, player: 'Eddie Giacomin' },
    { number: 2, player: 'Brian Leetch' },
    { number: 3, player: 'Harry Howell' },
    { number: 7, player: 'Rod Gilbert' },
    { number: 9, player: 'Andy Bathgate' },
    { number: 9, player: 'Adam Graves' },
    { number: 11, player: 'Vic Hadfield' },
    { number: 11, player: 'Mark Messier' },
    { number: 19, player: 'Jean Ratelle' },
    { number: 30, player: 'Henrik Lundqvist' },
    { number: 35, player: 'Mike Richter' },
    G,
  ],
  PHI: [
    { number: 1, player: 'Bernie Parent' },
    { number: 2, player: 'Mark Howe' },
    { number: 4, player: 'Barry Ashbee' },
    { number: 7, player: 'Bill Barber' },
    { number: 16, player: 'Bobby Clarke' },
    { number: 88, player: 'Eric Lindros' },
    G,
  ],
  STL: [
    { number: 2, player: 'Al MacInnis' },
    { number: 3, player: 'Bob Gassoff' },
    { number: 5, player: 'Bob Plager' },
    { number: 8, player: 'Barclay Plager' },
    { number: 11, player: 'Brian Sutter' },
    { number: 16, player: 'Brett Hull' },
    { number: 24, player: 'Bernie Federko' },
    { number: 44, player: 'Chris Pronger' },
    G,
  ],
  VGK: [{ number: 58, player: 'Las Vegas shooting victims' }, G],
}

/* ─────────────────────────── 2026 competition history ───────────────────────────
 * The export's own convention is year = the calendar year the trophy was won, so
 * the 2025-26 season is year 2026. Club/nation strings reuse the exact spellings
 * already present in this file's history so name-matching keeps working.
 * Sources are listed per row in docs/MOD-DB-2026-NONPLAYER.md.
 */
const H = (competition, champion, runnerUp = '', third = '', regularChampion = '') => ({
  competition, year: 2026, champion, runnerUp, third, regularChampion,
})
const HISTORY_2026 = [
  H('National Hockey League', 'Carolina Hurricanes', 'Vegas Golden Knights', '', 'Colorado Avalanche'),
  H('National Hockey League Eastern Conference', 'Carolina Hurricanes'),
  H('National Hockey League Western Conference', 'Vegas Golden Knights'),
  H('American Hockey League', 'Toronto Marlies', 'Chicago Wolves', '', 'Providence Bruins'),
  H('American Hockey League Eastern Conference', 'Toronto Marlies'),
  H('American Hockey League Western Conference', 'Chicago Wolves'),
  H('ECHL', 'Florida Everblades', 'Kansas City Mavericks', '', 'Kansas City Mavericks'),
  H('ECHL Eastern Conference', 'Florida Everblades'),
  H('ECHL Western Conference', 'Kansas City Mavericks'),
  H('Ontario Hockey League', 'Kitchener Rangers', 'Barrie Colts', '', 'Brantford Bulldogs'),
  H('Western Hockey League', 'Everett Silvertips', 'Prince Albert Raiders', '', 'Everett Silvertips'),
  H('Québec Maritimes Junior Hockey League', 'Chicoutimi Saguenéens', 'Moncton Wildcats', '', 'Moncton Wildcats'),
  H('Canadian Hockey League Memorial Cup', 'Kitchener Rangers', 'Everett Silvertips', 'Chicoutimi Saguenéens'),
  H('United States Hockey League', 'Sioux Falls Stampede', 'Muskegon Lumberjacks', '', 'Youngstown Phantoms'),
  H('National Collegiate Athletic Association', 'University of Denver Pioneers', 'University of Wisconsin-Madison Badgers'),
  H('Kontinental Hockey League', 'Lokomotiv Yaroslavl', 'Ak Bars Kazan', '', 'Metallurg Magnitogorsk'),
  H('Russian Molodyozhnaya Hokkeinaya Liga', 'Loko Yaroslavl', 'MHK Spartak Moskva'),
  H('Swedish Hockey League', 'Skellefteå AIK', 'Rögle BK', '', 'Skellefteå AIK'),
  H('Swedish HockeyAllsvenskan', 'IF Björklöven', 'BIK Karlskoga', '', 'IF Björklöven'),
  H('Finnish Liiga', 'Tampereen Tappara', 'Kouvolan KooKoo', 'Lappeenrannan SaiPa', 'Tampereen Tappara'),
  H('Swiss National League', 'HC Fribourg-Gottéron', 'HC Davos', '', 'HC Davos'),
  H('Czech Tipsport Extraliga', 'HC Dynamo Pardubice', 'HC Ocelári Trinec', '', 'HC Dynamo Pardubice'),
  H('Deutsche Eishockey Liga', 'Eisbären Berlin', 'Adler Mannheim', '', 'Kölner Haie'),
  H('World Championships', 'Finland', 'Switzerland', 'Norway'),
  H('World Junior Championships U-20', 'Sweden', 'Czechia', 'Canada'),
  H('Olympic Hockey Tournament', 'United States', 'Canada', 'Finland'),
]

/* ─────────────────────────── club records broken in 2025-26 ───────────────────────────
 * Found by comparing every stored single-season franchise record against the club's
 * actual 2025-26 leaders from the NHL public API
 * (api-web.nhle.com/v1/club-stats/{abbr}/20252026/2) — the project's established
 * structured source. Only rows where the 2025-26 value BEATS the stored value.
 */
const CLUB_RECORDS_2026 = [
  { club: 'Utah Mammoth', type: 'Most goals in a season', value: 40, player: 'Dylan Guenther' },
  { club: 'Utah Mammoth', type: 'Most assists in a season', value: 62, player: 'Clayton Keller' },
  { club: 'Utah Mammoth', type: 'Most wins in a season', value: 38, player: 'Karel Vejmelka' },
  { club: 'Utah Mammoth', type: 'Most shutouts in a season', value: 2, player: 'Karel Vejmelka' },
  { club: 'Winnipeg Jets', type: 'Most points in a season', value: 103, player: 'Mark Scheifele' },
  { club: 'San Jose Sharks', type: 'Most points in a season', value: 115, player: 'Macklin Celebrini' },
  { club: 'Vegas Golden Knights', type: 'Most PIM in a season', value: 89, player: 'Jeremy Lauzon' },
]

/* ─────────────────────────────────── apply ─────────────────────────────────── */

const log = []
const note = (s) => { log.push(s); console.log(s) }

const db = JSON.parse(fs.readFileSync(target, 'utf8'))
const teams = []
for (const c of db.conferences) for (const d of c.divisions) for (const t of d.teams) teams.push(t)
const byAbbr = new Map(teams.map((t) => [t.abbreviation, t]))

/* 1. head coaches */
for (const ch of COACH_CHANGES) {
  const t = byAbbr.get(ch.abbr)
  if (!t) { note(`!! ${ch.abbr}: team not found, skipped`); continue }
  t.staff ??= []
  if (ch.promote) {
    const m = t.staff.find((s) => s.name === ch.promote.name && s.role === 'headCoach')
    if (!m) { note(`!! ${ch.abbr}: ${ch.promote.name} not found, skipped`); continue }
    const removed = t.staff.length
    t.staff = t.staff.filter((s) => !(s.name === ch.out && s.role === 'headCoach'))
    m.rating = ch.promote.rating
    m.judgment = ch.promote.judgment
    note(`${ch.abbr} head coach: ${ch.out} out (${removed - t.staff.length} entry) → ${m.name} promoted to ${m.rating}`)
  } else {
    const before = t.staff.length
    t.staff = t.staff.filter(
      (s) => !(s.role === 'headCoach' && (s.name === ch.out || s.name === ch.in.name))
    )
    t.staff.push({ ...ch.in })
    note(`${ch.abbr} head coach: ${ch.out} out → ${ch.in.name} in at ${ch.in.rating} (${before} → ${t.staff.length} staff)`)
  }
}

/* 2. affiliates */
for (const a of AFFILIATE_ADDS) {
  const t = byAbbr.get(a.abbr)
  if (!t) { note(`!! ${a.abbr}: team not found, skipped`); continue }
  if (t.affiliate && t.affiliate.nickname === a.affiliate.nickname && t.affiliate.city === a.affiliate.city) {
    note(`${a.abbr} affiliate: already ${t.affiliate.city} ${t.affiliate.nickname}`)
    continue
  }
  if (t.affiliate) { note(`!! ${a.abbr} already has affiliate ${t.affiliate.city} ${t.affiliate.nickname}, left alone`); continue }
  t.affiliate = { ...a.affiliate }
  note(`${a.abbr} affiliate: added ${a.affiliate.city} ${a.affiliate.nickname}`)
}

/* 3. retired numbers — replace the wrong lists, then de-duplicate every club */
for (const [abbr, list] of Object.entries(RETIRED_NUMBERS)) {
  const t = byAbbr.get(abbr)
  if (!t) { note(`!! ${abbr}: team not found, skipped`); continue }
  const before = (t.retiredNumbers ?? []).length
  t.retiredNumbers = list.map((r) => ({ ...r }))
  note(`${abbr} retiredNumbers: replaced ${before} entries with ${list.length} verified`)
}
for (const t of teams) {
  if (!Array.isArray(t.retiredNumbers)) continue
  const seen = new Set()
  const deduped = t.retiredNumbers.filter((r) => {
    const k = `${r.number}|${r.player}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (deduped.length !== t.retiredNumbers.length) {
    note(`${t.abbreviation} retiredNumbers: dropped ${t.retiredNumbers.length - deduped.length} duplicate row(s)`)
    t.retiredNumbers = deduped
  }
}

/* 4. competition history — 2026 */
{
  const ch = db.history.competitionHistory
  const key = (r) => `${r.competition}|${r.year}`
  const have = new Set(ch.map(key))
  let added = 0
  let updated = 0
  for (const row of HISTORY_2026) {
    if (have.has(key(row))) {
      const i = ch.findIndex((r) => key(r) === key(row))
      if (JSON.stringify(ch[i]) !== JSON.stringify(row)) { ch[i] = { ...row }; updated++ }
    } else {
      ch.push({ ...row })
      added++
    }
  }
  note(`competitionHistory: ${added} rows added, ${updated} rows updated (2026 season)`)
}

/* 5. club records — normalise Montreal, then apply 2025-26 breaks */
{
  const recs = db.history.clubRecords
  let renamed = 0
  for (const r of recs) {
    // "Montréal Canadiens" never matches the club's own name ("Montreal Canadiens",
    // built from city + nickname), so Montreal's franchise records and its 24 Cups
    // were silently dropped from the seeded record book. Normalise to the club's spelling.
    if (r.club === 'Montréal Canadiens') { r.club = 'Montreal Canadiens'; renamed++ }
  }
  let histRenamed = 0
  for (const r of db.history.competitionHistory) {
    for (const f of ['champion', 'runnerUp', 'third', 'regularChampion']) {
      if (r[f] === 'Montréal Canadiens') { r[f] = 'Montreal Canadiens'; histRenamed++ }
    }
  }
  note(`clubRecords: normalised ${renamed} "Montréal Canadiens" rows (+${histRenamed} history fields) to "Montreal Canadiens"`)

  let broke = 0
  for (const b of CLUB_RECORDS_2026) {
    const row = recs.find((r) => r.club === b.club && r.type === b.type)
    if (!row) { note(`!! no ${b.type} row for ${b.club}, skipped`); continue }
    if (row.year === 2026 && row.value === b.value && row.player === b.player) continue
    if (row.value >= b.value && row.year !== 2026) {
      note(`!! ${b.club} ${b.type}: stored ${row.value} >= ${b.value}, left alone`)
      continue
    }
    note(`${b.club} ${b.type}: ${row.value} ${row.player} (${row.year}) → ${b.value} ${b.player} (2026)`)
    row.value = b.value
    row.player = b.player
    row.year = 2026
    broke++
  }
  note(`clubRecords: ${broke} single-season records updated for 2025-26`)
}

/* 6. meta */
if (db.meta.season !== '2026-27') {
  note(`meta.season: "${db.meta.season}" → "2026-27"`)
  db.meta.season = '2026-27'
}

fs.writeFileSync(target, JSON.stringify(db))
note(`\nwrote ${target} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`)
