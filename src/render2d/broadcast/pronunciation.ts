/**
 * PRONUNCIATION — how the booth says a player's name.
 *
 * The TTS engine reads English orthography, so "Nečas" comes out as "Neck-us"
 * and "Söderblom" as "Sodder-blom". This module turns a roster name into the
 * text we actually hand the engine, in three layers (first hit wins):
 *
 *   1. An explicit respelling for the player — `Player.pronunciation` from the
 *      mod DB, or an entry in a community pronunciations file
 *      ({@link PronunciationFile}). Respelling is plain letters, hyphenated by
 *      syllable, stressed syllable in CAPS: "NEH-chahs", "SUH-der-blom".
 *   2. Word-level defaults for common hockey surnames we know the booth gets
 *      wrong ({@link DEFAULT_WORD_OVERRIDES}).
 *   3. Nationality-aware letter rules for the usual traps: Czech/Slovak háčeks
 *      (č š ž ř ě), Scandinavian ö/ø/å/ä, Finnish doubled vowels and "j",
 *      Russian transliteration "-iy/-yi" endings, German "w"/"ei"/"ie" — see
 *      {@link applyLetterRules}. Unknown nationality → only diacritics are
 *      normalised (the safe subset).
 *
 * The respelling feeds the NAME CLIP cache key (pronunciationHash) so fixing a
 * pronunciation re-renders exactly that player's clips.
 *
 * Pure and import-free (the Node build script loads it with type stripping).
 */

export interface NameInput {
  id: string
  name: string
  nationality?: string
  /** Explicit respelling of the FULL name ("KEE-rill kah-PREE-zof"), or of the
   *  surname only when it contains no space. */
  pronunciation?: string
  externalId?: string
}

/**
 * Community pronunciations file (e.g. mods/<mod>/pronunciations.json):
 *
 * {
 *   "version": 1,
 *   "byExternalId": { "nhl-8478864": "KEE-rill kah-PREE-zof" },
 *   "byName":       { "Nečas": "NEH-chahs", "Martin Nečas": "MAR-tin NEH-chahs" }
 * }
 *
 * `byName` keys may be a full name or a single surname word.
 */
export interface PronunciationFile {
  version: 1
  byExternalId?: Record<string, string>
  byName?: Record<string, string>
}

/** Surnames the booth mangles often enough to ship a default respelling. */
export const DEFAULT_WORD_OVERRIDES: Readonly<Record<string, string>> = {
  'Nečas': 'NEH-chahs',
  'Necas': 'NEH-chahs',
  'Söderblom': 'SUH-der-bloom',
  'Soderblom': 'SUH-der-bloom',
  'Pastrňák': 'PAHS-ter-nyahk',
  'Pastrnak': 'PAHS-ter-nyahk',
  'Kaprizov': 'kah-PREE-zoff',
  'Dahlin': 'dah-LEEN',
  'Ekman-Larsson': 'EK-mun LAR-son',
  'Zibanejad': 'ZIB-uh-nuh-jad',
  'Draisaitl': 'DRY-sy-tul',
  'Vasilevskiy': 'vas-ih-LEF-skee',
  'Hischier': 'HISH-ee-er',
  'Kotkaniemi': 'KOT-kuh-nee-EM-ee',
  'Barkov': 'BAR-koff',
  'Rantanen': 'RAN-tuh-nen',
  'Svechnikov': 'SVECH-nih-koff',
  'Ullmark': 'OOL-mark',
  'Lehkonen': 'LEH-koh-nen',
  'Aho': 'AH-ho',
  'Hronek': 'HRAW-nek',
  'Tkachuk': 'kuh-CHUCK',
  'Hertl': 'HER-tul',
  'Voráček': 'VOR-uh-chek',
  'Šimek': 'SHIH-mek',
}

type Family = 'czsk' | 'nordic' | 'finnish' | 'russian' | 'german' | 'other'

function familyOf(nationality: string | undefined): Family {
  const n = (nationality ?? '').toLowerCase()
  if (/czech|slovak/.test(n)) return 'czsk'
  if (/finland|finnish/.test(n)) return 'finnish'
  if (/sweden|swedish|norway|norwegian|denmark|danish/.test(n)) return 'nordic'
  if (/russia|russian|belarus|ukrain|kazakh|latvia/.test(n)) return 'russian'
  if (/germany|german|austria|switzerland|swiss/.test(n)) return 'german'
  return 'other'
}

/** Diacritics every family shares, mapped to their nearest English spelling. */
const SAFE_DIACRITICS: Array<[RegExp, string]> = [
  [/[áàâ]/g, 'a'], [/[ÁÀÂ]/g, 'A'],
  [/[éèêë]/g, 'e'], [/[ÉÈÊË]/g, 'E'],
  [/[íìîï]/g, 'ee'], [/[ÍÌÎÏ]/g, 'Ee'],
  [/[óòô]/g, 'o'], [/[ÓÒÔ]/g, 'O'],
  [/[úùûů]/g, 'oo'], [/[ÚÙÛŮ]/g, 'Oo'],
  [/ý/g, 'ee'], [/Ý/g, 'Ee'],
  [/ñ/g, 'ny'], [/ç/g, 's'],
]

const CZSK: Array<[RegExp, string]> = [
  [/č/g, 'ch'], [/Č/g, 'Ch'],
  [/š/g, 'sh'], [/Š/g, 'Sh'],
  [/ž/g, 'zh'], [/Ž/g, 'Zh'],
  [/ř/g, 'rzh'], [/Ř/g, 'Rzh'],
  [/ě/g, 'yeh'], [/ň/g, 'ny'], [/ť/g, 't'], [/ď/g, 'd'],
  // A Czech "j" is an English "y" (Jágr → YAH-grr).
  [/\bJ(?=[aeiouáéíóú])/g, 'Y'], [/(?<=[a-z])j(?=[aeiou])/g, 'y'],
  // "c" (not "ch") is "ts".
  [/c(?!h)/g, 'ts'], [/\bC(?!h)/g, 'Ts'],
]

const NORDIC: Array<[RegExp, string]> = [
  [/[öø]/g, 'uh'], [/[ÖØ]/g, 'Uh'],
  [/å/g, 'oh'], [/Å/g, 'Oh'],
  [/ä/g, 'eh'], [/Ä/g, 'Eh'],
  [/æ/g, 'eh'], [/Æ/g, 'Eh'],
  [/\bJ(?=[aeiouåäö])/g, 'Y'],
  // Swedish "sj"/"skj" is a soft "sh".
  [/sk?j/g, 'sh'],
]

const FINNISH: Array<[RegExp, string]> = [
  [/ä/g, 'a'], [/Ä/g, 'A'],
  [/ö/g, 'ur'], [/Ö/g, 'Ur'],
  [/\bJ(?=[aeiouäö])/g, 'Y'], [/(?<=[a-z])j(?=[aeiouäö])/g, 'y'],
  [/aa/g, 'ah'], [/ii/g, 'ee'], [/uu/g, 'oo'],
]

const RUSSIAN: Array<[RegExp, string]> = [
  // Transliteration endings: -skiy/-sky/-skii → "skee", -iy → "ee".
  [/sk(?:iy|ii|y|i)\b/g, 'skee'], [/iy\b/g, 'ee'], [/yi\b/g, 'ee'],
  [/kh/g, 'k'], [/Kh/g, 'K'],
]

const GERMAN: Array<[RegExp, string]> = [
  [/\bW/g, 'V'], [/(?<=[a-z])w/g, 'v'],
  [/ü/g, 'ew'], [/Ü/g, 'Ew'], [/ö/g, 'ur'], [/Ö/g, 'Ur'], [/ä/g, 'eh'], [/Ä/g, 'Eh'],
  [/ß/g, 'ss'],
  [/ei/g, 'eye'], [/ie/g, 'ee'],
]

/** Letter rules for one name word, by the player's nationality family. */
export function applyLetterRules(word: string, nationality?: string): string {
  const fam = familyOf(nationality)
  let out = word
  const rules =
    fam === 'czsk' ? CZSK
    : fam === 'nordic' ? NORDIC
    : fam === 'finnish' ? FINNISH
    : fam === 'russian' ? RUSSIAN
    : fam === 'german' ? GERMAN
    : []
  for (const [re, rep] of rules) out = out.replace(re, rep)
  for (const [re, rep] of SAFE_DIACRITICS) out = out.replace(re, rep)
  // Whatever's left: strip combining marks so the engine never sees them.
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? fullName
}

/** What the booth says, as text for the TTS engine. */
export interface SpokenName {
  surname: string
  full: string
  /** Hash of both spellings — the name-clip cache key component. */
  hash: string
}

function hashStr(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** Respelling → engine text. Stress caps are lowered (an all-caps syllable is
 *  read letter by letter by the phonemiser); syllable hyphens are kept, which
 *  the phonemiser treats as one compound word: "NEH-chahs" → "neh-chahs". */
export function respellingToSpeech(respelling: string): string {
  return respelling.trim().split(/\s+/).map((w) => w.toLowerCase()).join(' ')
}

function wordSpoken(word: string, nationality: string | undefined, file: PronunciationFile | null): string {
  const fromFile = file?.byName?.[word]
  if (fromFile) return respellingToSpeech(fromFile)
  const def = DEFAULT_WORD_OVERRIDES[word]
  if (def) return respellingToSpeech(def)
  // Hyphenated surnames resolve per part ("Ekman-Larsson").
  if (word.includes('-')) return word.split('-').map((w) => wordSpoken(w, nationality, file)).join(' ')
  return applyLetterRules(word, nationality)
}

/**
 * Resolve how the booth says a player's name. Explicit respellings win, then
 * the community file, then word defaults, then nationality letter rules.
 */
export function spokenName(p: NameInput, file: PronunciationFile | null = null): SpokenName {
  const explicit =
    p.pronunciation ??
    (p.externalId ? file?.byExternalId?.[p.externalId] : undefined) ??
    file?.byName?.[p.name]
  let full: string
  let surname: string
  if (explicit) {
    const words = explicit.trim().split(/\s+/)
    if (words.length === 1) {
      // A surname-only respelling: first name through the normal rules.
      surname = respellingToSpeech(explicit)
      const first = p.name.trim().split(/\s+/).slice(0, -1)
      full = [...first.map((w) => wordSpoken(w, p.nationality, file)), surname].join(' ')
    } else {
      full = respellingToSpeech(explicit)
      surname = respellingToSpeech(words[words.length - 1]!)
    }
  } else {
    const words = p.name.trim().split(/\s+/)
    const spoken = words.map((w) => wordSpoken(w, p.nationality, file))
    full = spoken.join(' ')
    surname = spoken[spoken.length - 1] ?? full
  }
  return { surname, full, hash: hashStr(`${full}|${surname}`) }
}
