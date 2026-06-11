/**
 * Display formatting helpers. Engine values are plain numbers / ISO strings;
 * everything presentational lives here so screens agree on formats.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

/** Deterministic placeholder crest color until real team colors reach the UI. */
export function crestColor(teamId: string): string {
  let hash = 0
  for (let i = 0; i < teamId.length; i++) {
    hash = (hash * 31 + teamId.charCodeAt(i)) >>> 0
  }
  return `hsl(${hash % 360} 45% 36%)`
}
