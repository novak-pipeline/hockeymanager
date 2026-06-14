/**
 * Display formatting helpers. Engine values are plain numbers / ISO strings;
 * everything presentational lives here so screens agree on formats.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Nation name (as imported from the EHM DB) → ISO-3166 alpha-2 for flag emoji. */
const NATION_ISO: Record<string, string> = {
  canada: 'CA', 'united states': 'US', usa: 'US', america: 'US', russia: 'RU',
  sweden: 'SE', finland: 'FI', 'czech republic': 'CZ', czechia: 'CZ', czech: 'CZ',
  slovakia: 'SK', switzerland: 'CH', germany: 'DE', denmark: 'DK', norway: 'NO',
  latvia: 'LV', austria: 'AT', france: 'FR', belarus: 'BY', slovenia: 'SI',
  kazakhstan: 'KZ', ukraine: 'UA', 'great britain': 'GB', 'united kingdom': 'GB',
  england: 'GB', italy: 'IT', netherlands: 'NL', poland: 'PL', japan: 'JP',
  'south korea': 'KR', korea: 'KR', china: 'CN', australia: 'AU', estonia: 'EE',
  lithuania: 'LT', hungary: 'HU', croatia: 'HR', ireland: 'IE', spain: 'ES',
}

/**
 * Country flag emoji for a nation name. Returns '' when unknown so callers can
 * fall back to the plain text label.
 */
export function flagEmoji(nationality?: string): string {
  if (!nationality) return ''
  const iso = nationIso(nationality)
  if (!iso) return ''
  const A = 0x1f1e6
  return String.fromCodePoint(A + (iso.charCodeAt(0) - 65), A + (iso.charCodeAt(1) - 65))
}

/** Nation name → ISO-3166 alpha-2 code (lowercase-insensitive). */
export function nationIso(nationality?: string): string | undefined {
  if (!nationality) return undefined
  return NATION_ISO[nationality.trim().toLowerCase()]
}

/** '2026-10-12' → '12 Oct 2026'. Returns the input unchanged if malformed. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return iso
  return `${Number(m[3])} ${month} ${m[1]}`
}

/** Plain dollars → compact label: 3500000 → '$3.5M', 850000 → '$850K'. */
export function fmtMoney(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000
    const text = millions.toFixed(millions >= 100 ? 0 : millions >= 10 ? 1 : 2)
    return `${sign}$${trimZeros(text)}M`
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** Seconds → 'M:SS' (time on ice). */
export function fmtToi(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Player morale (0–100) → a broad mood word (no raw numbers shown to the GM). */
export function moraleWord(morale: number): string {
  if (morale >= 85) return 'Delighted'
  if (morale >= 70) return 'Happy'
  if (morale >= 55) return 'Content'
  if (morale >= 40) return 'Unsettled'
  if (morale >= 25) return 'Unhappy'
  return 'Miserable'
}

/** Color for a morale mood word, for colored text. */
export function moraleColor(morale: number): string {
  if (morale >= 70) return 'var(--success)'
  if (morale >= 55) return 'var(--green, #4ade80)'
  if (morale >= 40) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

/** Deterministic placeholder crest color until real team colors reach the UI. */
export function crestColor(teamId: string): string {
  let hash = 0
  for (let i = 0; i < teamId.length; i++) {
    hash = (hash * 31 + teamId.charCodeAt(i)) >>> 0
  }
  return `hsl(${hash % 360} 45% 36%)`
}
