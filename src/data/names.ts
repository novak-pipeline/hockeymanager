/**
 * Fictional name pools. Per docs/DATA-SOURCES.md the shipped DB must be
 * fictional/editable — we cannot ship real NHL names. These pools feed league
 * generation; community mods replace them with real rosters separately.
 */

export const FIRST_NAMES: readonly string[] = [
  'Alex', 'Brett', 'Cody', 'Derek', 'Evan', 'Finn', 'Gunnar', 'Hayden', 'Isaac', 'Jakob',
  'Kasper', 'Liam', 'Mason', 'Niklas', 'Owen', 'Patrik', 'Quinn', 'Rasmus', 'Sven', 'Tobias',
  'Viktor', 'Wyatt', 'Xander', 'Yannick', 'Zane', 'Anton', 'Bo', 'Carl', 'Dmitri', 'Elias',
  'Felix', 'Gustav', 'Henrik', 'Ivan', 'Jonas', 'Kai', 'Leo', 'Marek', 'Nathan', 'Oskar',
  'Pavel', 'Reid', 'Samu', 'Teemu', 'Ulf', 'Valtteri', 'Wade', 'Aleksi', 'Bjorn', 'Casey'
]

export const LAST_NAMES: readonly string[] = [
  'Anderson', 'Berg', 'Carlsson', 'Dahl', 'Eriksson', 'Forsberg', 'Granlund', 'Holm', 'Ingram', 'Johansson',
  'Koivu', 'Lindqvist', 'Mattson', 'Nyberg', 'Olsen', 'Petrov', 'Quist', 'Rinne', 'Sundstrom', 'Tikkanen',
  'Ueda', 'Virtanen', 'Wallin', 'Yablonski', 'Zubov', 'Bergeron', 'Crosby', 'Doyle', 'Ellis', 'Fontaine',
  'Gallagher', 'Hughes', 'Iverson', 'Jokinen', 'Kane', 'Larsson', 'Murphy', 'Novak', 'Orlov', 'Persson',
  'Reilly', 'Stastny', 'Tavares', 'Ulmer', 'Voronov', 'Whitaker', 'Xiong', 'Yermolov', 'Zetterberg', 'Aalto'
]

export interface CityName {
  city: string
  nickname: string
  abbreviation: string
  /** Jersey colors, 0xRRGGBB. Static per franchise — never drawn from the Rng. */
  primary: number
  secondary: number
}

/** 16 fictional franchises. Add more here to support larger leagues. */
export const FRANCHISES: readonly CityName[] = [
  { city: 'Riverside', nickname: 'Rapids', abbreviation: 'RIV', primary: 0x1565c0, secondary: 0xffffff },
  { city: 'Granite Bay', nickname: 'Miners', abbreviation: 'GRB', primary: 0x5d4037, secondary: 0xffb300 },
  { city: 'Cedar Falls', nickname: 'Lumberjacks', abbreviation: 'CED', primary: 0x2e7d32, secondary: 0xefebe9 },
  { city: 'Port Haven', nickname: 'Mariners', abbreviation: 'PHV', primary: 0x0d47a1, secondary: 0x80deea },
  { city: 'Summit', nickname: 'Avalanche', abbreviation: 'SUM', primary: 0x6a1b9a, secondary: 0xb0bec5 },
  { city: 'Iron Lake', nickname: 'Forge', abbreviation: 'IRL', primary: 0x37474f, secondary: 0xff7043 },
  { city: 'Aurora', nickname: 'Northern Lights', abbreviation: 'AUR', primary: 0x00838f, secondary: 0xaeea00 },
  { city: 'Maple Ridge', nickname: 'Timberwolves', abbreviation: 'MPR', primary: 0x4e342e, secondary: 0x9e9e9e },
  { city: 'Bayfront', nickname: 'Sharks', abbreviation: 'BAY', primary: 0x00695c, secondary: 0xffd54f },
  { city: 'Frost Harbor', nickname: 'Icebreakers', abbreviation: 'FRH', primary: 0x0277bd, secondary: 0xe1f5fe },
  { city: 'Capitol City', nickname: 'Sentinels', abbreviation: 'CAP', primary: 0xb71c1c, secondary: 0xeceff1 },
  { city: 'Thunder Mesa', nickname: 'Storm', abbreviation: 'THM', primary: 0xf9a825, secondary: 0x263238 },
  { city: 'Silverpeak', nickname: 'Wolves', abbreviation: 'SLV', primary: 0x757575, secondary: 0xcfd8dc },
  { city: 'Harbor Point', nickname: 'Anchors', abbreviation: 'HBP', primary: 0x283593, secondary: 0xffc107 },
  { city: 'Birchwood', nickname: 'Bisons', abbreviation: 'BIR', primary: 0x795548, secondary: 0xfff8e1 },
  { city: 'Crystal Bay', nickname: 'Stingrays', abbreviation: 'CRB', primary: 0x00acc1, secondary: 0x1a237e }
]

export const CONFERENCE_NAMES: readonly string[] = ['Eastern', 'Western']
export const DIVISION_NAMES: readonly string[] = ['Atlantic', 'Metro', 'Central', 'Pacific']
