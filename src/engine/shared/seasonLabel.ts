/**
 * One way to name a season (loop audit F15): "2026–27". The summer copy used
 * to print the raw season year, so the takeover summer of a 2026–27 database
 * read "2025 season", "Owner sets the 2025 mandate" and "2025–2026 season
 * begins" all at once.
 */
export function seasonLabel(startYear: number): string {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** The season a date belongs to: in the summer, the one the club is building for. */
export function managedSeasonLabel(year: number, phase: string): string {
  return seasonLabel(phase === 'offseason' ? year + 1 : year)
}
