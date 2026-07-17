# UI loop — view-data requests for the human to wire

These are places where a screen could be meaningfully better with data the
frozen `views.ts` / `protocol.ts` don't currently expose. The UI loop cannot
add engine/view/protocol fields itself, so it worked around each and logged the
ask here.

## Calendar

- **`CalendarView.todayISO`** — the Calendar highlights "today" by pulling the
  in-game date from a *second* `getDashboard()` fetch (see
  `CalendarScreen.tsx`). A `todayISO` (or `currentDay`) field on `CalendarView`
  would drop the extra round-trip.
- **Game entries carry `opponentTeamId`** — `CalendarCell` renders the opponent
  crest with `teamId={entry.opponentAbbr}` because the game entry only exposes
  an abbreviation, so team-colour crest lookup can miss. A real
  `opponentTeamId` on the calendar game entry would fix crest colours.

## Dashboard / Schedule (nice-to-have, not blocking)

- **A short per-team form series** (e.g. last-10 goal differential or points
  pace) on `DashboardView.userTeam` would let the dashboard Season panel show a
  sparkline without the screen re-deriving it from the full schedule. The
  Schedule screen already derives a cumulative goal-diff sparkline from played
  results; a first-class series would be cheaper and reusable.

## Stats

- **User-team flag on `LeaderRowView`** — the league leaderboards can't
  highlight *your* players (only `teamAbbr` is available, not a stable team id
  or an `isUserTeam` flag). A flag would let the leaderboard rail the GM's own
  skaters/goalies the way Standings rails the user's team row.
