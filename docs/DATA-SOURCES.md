# Hockey Data Sources

Two separate needs with very different rules.

## Need 1 — Calibration data (tune the engine)

Used by the calibration harness to derive engine coefficients. Free to use for tuning (we ship math, not the data).

| Source | What | Format | Best for |
|--------|------|--------|----------|
| **MoneyPuck** — moneypuck.com/data.htm | Per-shot data with **xG**, player/game/team CSVs, many seasons | Bulk CSV | Calibrating the `danger` field, sh%/sv% |
| **Natural Stat Trick** — naturalstattrick.com | Team & player rates: Corsi, shots, PP%/PK% | CSV export | Team-level rate targets (shots/game, PP%, PK%) |
| **Hockey-Reference** — hockey-reference.com | Deep historical stats, decades back | Tables (scrapeable) | Long-run distributions, aging curves |
| **Official NHL API** — `api-web.nhle.com` (no key) | Schedule, rosters, standings, **play-by-play** (`gamecenter/{id}/play-by-play`) | JSON | Event sequences for momentum/comeback/hot-goalie drama |

API endpoint map: github.com/Zmalski/NHL-API-Reference (unofficial). MoneyPuck & NST are cleaned-up versions of the same underlying NHL data — easier to bulk-download than scraping.

Engine-specific use:
- MoneyPuck shot+xG → calibrate `danger`, sh%, sv%.
- NST team rates → shots/game, PP%, PK%.
- NHL API play-by-play → extract sequences for drama modeling (momentum multiplier, goalie variance, comeback rates).

**Plan:** build a small importer (~half a day) that pulls these into a local SQLite table the calibrator reads.

## Need 2 — Shippable league database (legal)

**Cannot ship real NHL player names, team names, or logos commercially** — NHL/NHLPA own those marks. EHM's solution (copy exactly):
- Ship base game with **fictional or empty** DB.
- Make DB **fully editable/moddable**.
- Community creates & distributes real rosters as separate downloads users add themselves.

This is why the architecture's moddable-DB requirement is a legal necessity, not a nicety: it's the path to "real" hockey in-game without a licensing deal.
