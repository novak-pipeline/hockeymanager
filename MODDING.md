# Modding Guide

This game ships with a fully fictional league database. The mod system lets the
community build and distribute real-roster databases, logo packs, and face packs
as separate downloads — a legal necessity since team/player names and logos are
owned by their respective rights holders and cannot be included in the base game
(see the note at the end of this document).

---

## Folder layout

A mod lives inside the `mods/` folder next to the game executable. Each mod
gets its own named sub-folder:

```
mods/
  my-roster-pack/
    database.json          ← the structured league database (required)
    faces/
      <faceId>.png         ← player face images (optional)
    logos/
      <logoId>.png         ← team logo images (optional)
```

The game scans `mods/` on startup and lists available mods on the New Career
screen. Selecting a mod loads its `database.json` and resolves face/logo images
from the same sub-folder.

**Save-game persistence:** the `database.json` contents are embedded in the
career save file when a new career is started. Deleting the mod folder after
that point does not break a save — the game already holds a copy. Face and logo
assets are resolved at display time, however, so removing the folder will cause
images to fall back to generated silhouettes and color crests.

---

## The database.json schema

`database.json` must be valid JSON conforming to the following structure.
`formatVersion` must be exactly `1`.

```jsonc
{
  "formatVersion": 1,
  "meta": {
    "name":    "My Roster Pack",      // required — league name displayed in-game
    "author":  "Community User",      // optional
    "season":  "2024-25"              // optional — display label only
  },
  "conferences": [
    {
      "name": "Eastern Conference",
      "divisions": [
        {
          "name": "Atlantic Division",
          "teams": [ /* ModTeam objects — see below */ ]
        }
      ]
    }
    // ... more conferences
  ]
}
```

### Structural requirements

| Rule | Detail |
|------|--------|
| Total team count | Must be **even** and **>= 4** |
| Skaters per team | At least **17** (combined C + W + D) |
| Goalies per team | At least **2** |
| `externalId` | Must be **unique** within its scope (players within a team; teams across the whole mod) |

### ModTeam

```jsonc
{
  "externalId":  "nhl-team-10",      // stable key; must be unique across the mod
  "city":        "Lake City",
  "nickname":    "Wolves",
  "abbreviation":"LCW",              // exactly 3 characters
  "primary":     "#C8102E",          // jersey color, '#RRGGBB' hex
  "secondary":   "#FFFFFF",
  "logoId":      "logo-lcw",         // optional — resolves to logos/logo-lcw.png
  "players":     [ /* ModPlayer objects */ ]
}
```

### ModPlayer

```jsonc
{
  "externalId":  "nhl-8478402",      // stable key; must be unique within the team
  "name":        "Aleksander Volkov",
  "age":         27,                 // 16–45
  "position":    "C",               // C | W | D | G
  "handedness":  "L",               // L | R
  "faceId":      "nhl-8478402",     // optional — resolves to faces/nhl-8478402.png

  // --- Attribute shorthand (recommended) ---
  "overall":     82,                 // 1–99; synthesises a coherent attribute spread

  // --- Per-attribute overrides (optional) ---
  // Any key from the flat attribute map below may be provided.
  // Overrides are applied on top of the synthesised 'overall' base.
  // Omitted keys are generated from 'overall'.
  "attributes": {
    "wristShot":   88,
    "speed":       91,
    "defensiveIQ": 70
  },

  // --- Ceiling ---
  "potential":   90,                 // optional 1–99; absent = age-derived headroom

  // --- Contract ---
  "contract": {
    "salary": 8500000,               // dollars per year
    "years":  4                      // 1–8
  }
}
```

If you provide neither `overall` nor `attributes`, the player's attributes are
synthesised around the league baseline (50 overall). It is recommended to always
provide at least `overall`.

---

## Full flat attribute key list

Use these exact keys in `attributes`. All values must be integers **1–99**.

| Group | Keys |
|-------|------|
| Technical | `wristShot`, `slapShot`, `stickhandling`, `passing`, `deflections`, `faceoffs` |
| Physical | `speed`, `acceleration`, `strength`, `balance`, `stamina`, `agility`, `height` |
| Mental | `offensiveIQ`, `defensiveIQ`, `positioning`, `vision`, `aggression`, `composure`, `workRate`, `discipline`, `anticipation` |
| Defensive | `checking`, `shotBlocking`, `stickChecking`, `takeaway` |
| Goalie only | `reflexes`, `positioningG`, `reboundControl`, `glove`, `blocker`, `recovery`, `puckHandlingG` |

Goalie-only keys are ignored for skaters; non-goalie keys synthesised for
goalies will not affect the simulation (the engine reads goalie-specific
composites only).

---

## How attribute shorthand works

When you provide `"overall": 82` without `attributes`, the loader synthesises
a full `RawAttributes` object by drawing each attribute from a Gaussian
distribution centred on 82 with a standard deviation of ~7. The result is a
realistic player where every attribute clusters around the overall value with
natural variation — the same algorithm the built-in fictional league generator
uses.

When you add `attributes` overrides, those exact values replace the synthesised
ones. Everything else is still synthesised from `overall`. For example:

```jsonc
{
  "overall": 75,
  "attributes": { "wristShot": 94, "slapShot": 90 }
}
```

Produces a player who is roughly 75 overall but with elite shot attributes —
useful for modeling a one-dimensional sniper whose other skills are average.

All synthesis is **seeded** — the same seed passed to the loader always produces
the same attributes. Career saves embed the seed, so a career started from a
given mod is fully reproducible.

---

## Worked example (fictional data)

The following is a minimal but complete `database.json`. Team and player names
are entirely fictional.

```json
{
  "formatVersion": 1,
  "meta": {
    "name":   "Lakeland Hockey League",
    "author": "Community Modder",
    "season": "2024-25"
  },
  "conferences": [
    {
      "name": "Northern Conference",
      "divisions": [
        {
          "name": "Lakes Division",
          "teams": [
            {
              "externalId":  "lhl-team-1",
              "city":        "Northport",
              "nickname":    "Glaciers",
              "abbreviation":"NGL",
              "primary":     "#003087",
              "secondary":   "#FCAF17",
              "logoId":      "logo-ngl",
              "players": [
                { "externalId":"lhl-001","name":"Ivan Petrov",    "age":28,"position":"C","handedness":"L","overall":84,"attributes":{"faceoffs":90},"contract":{"salary":7200000,"years":3} },
                { "externalId":"lhl-002","name":"Marco Ferretti", "age":24,"position":"C","handedness":"R","overall":72 },
                { "externalId":"lhl-003","name":"Jakub Novacek",  "age":32,"position":"C","handedness":"L","overall":68 },
                { "externalId":"lhl-004","name":"Dmitri Smirnov", "age":22,"position":"C","handedness":"L","overall":65,"potential":80 },
                { "externalId":"lhl-005","name":"Riku Makinen",   "age":27,"position":"W","handedness":"L","overall":81 },
                { "externalId":"lhl-006","name":"Thomas Gruber",  "age":26,"position":"W","handedness":"L","overall":79 },
                { "externalId":"lhl-007","name":"Sebastian Wolf", "age":30,"position":"W","handedness":"R","overall":75 },
                { "externalId":"lhl-008","name":"Lars Eriksson",  "age":23,"position":"W","handedness":"L","overall":71 },
                { "externalId":"lhl-009","name":"Patrick Dumont", "age":29,"position":"W","handedness":"R","overall":70 },
                { "externalId":"lhl-010","name":"Artem Volkov",   "age":21,"position":"W","handedness":"L","overall":67,"potential":83 },
                { "externalId":"lhl-011","name":"Stefan Kowalski","age":31,"position":"W","handedness":"R","overall":65 },
                { "externalId":"lhl-012","name":"Yuki Tanaka",    "age":25,"position":"W","handedness":"L","overall":63 },
                { "externalId":"lhl-013","name":"Mikael Lindqvist","age":28,"position":"W","handedness":"L","overall":62 },
                { "externalId":"lhl-014","name":"Conor Brennan",  "age":24,"position":"D","handedness":"R","overall":80 },
                { "externalId":"lhl-015","name":"Henrik Bauer",   "age":27,"position":"D","handedness":"L","overall":77 },
                { "externalId":"lhl-016","name":"Alexei Churilov","age":30,"position":"D","handedness":"R","overall":73 },
                { "externalId":"lhl-017","name":"Jonas Brandt",   "age":26,"position":"D","handedness":"L","overall":70 },
                { "externalId":"lhl-018","name":"Filip Novotny",  "age":22,"position":"D","handedness":"R","overall":67,"potential":78 },
                { "externalId":"lhl-019","name":"Marcus Holst",   "age":29,"position":"D","handedness":"L","overall":64 },
                { "externalId":"lhl-020","name":"Pierre Fontaine","age":31,"position":"D","handedness":"R","overall":62 },
                { "externalId":"lhl-021","name":"Nikolai Orlov",  "age":28,"position":"G","handedness":"L","overall":82,"faceId":"face-lhl-021","contract":{"salary":5800000,"years":2} },
                { "externalId":"lhl-022","name":"Tomas Horak",    "age":26,"position":"G","handedness":"L","overall":70 }
              ]
            },
            {
              "externalId":  "lhl-team-2",
              "city":        "Southgate",
              "nickname":    "Storm",
              "abbreviation":"SGS",
              "primary":     "#8B0000",
              "secondary":   "#C0C0C0",
              "players": [
                { "externalId":"lhl-101","name":"Karl Fischer",   "age":29,"position":"C","handedness":"L","overall":85 },
                { "externalId":"lhl-102","name":"Petr Horacek",   "age":25,"position":"C","handedness":"R","overall":74 },
                { "externalId":"lhl-103","name":"Gianni Moretti",  "age":33,"position":"C","handedness":"L","overall":69 },
                { "externalId":"lhl-104","name":"Vasily Grachev", "age":21,"position":"C","handedness":"L","overall":66,"potential":82 },
                { "externalId":"lhl-105","name":"Emil Sorensen",  "age":28,"position":"W","handedness":"L","overall":80 },
                { "externalId":"lhl-106","name":"Luca Romano",    "age":27,"position":"W","handedness":"R","overall":78 },
                { "externalId":"lhl-107","name":"Ryan Gallagher", "age":31,"position":"W","handedness":"L","overall":74 },
                { "externalId":"lhl-108","name":"Andreas Huber",  "age":24,"position":"W","handedness":"R","overall":72 },
                { "externalId":"lhl-109","name":"Samuel Dupont",  "age":26,"position":"W","handedness":"L","overall":69 },
                { "externalId":"lhl-110","name":"Victor Strand",  "age":23,"position":"W","handedness":"L","overall":66 },
                { "externalId":"lhl-111","name":"Tomi Virtanen",  "age":30,"position":"W","handedness":"R","overall":64 },
                { "externalId":"lhl-112","name":"Ondrej Blazek",  "age":22,"position":"W","handedness":"L","overall":63 },
                { "externalId":"lhl-113","name":"David Palacek",  "age":27,"position":"W","handedness":"R","overall":61 },
                { "externalId":"lhl-114","name":"Marc Schneider", "age":30,"position":"D","handedness":"R","overall":79 },
                { "externalId":"lhl-115","name":"Pavel Ryabov",   "age":28,"position":"D","handedness":"L","overall":76 },
                { "externalId":"lhl-116","name":"Johan Bergstrom","age":25,"position":"D","handedness":"R","overall":72 },
                { "externalId":"lhl-117","name":"Niko Valtonen",  "age":27,"position":"D","handedness":"L","overall":69 },
                { "externalId":"lhl-118","name":"Brendan Walsh",  "age":23,"position":"D","handedness":"R","overall":66,"potential":77 },
                { "externalId":"lhl-119","name":"Raul Delgado",   "age":32,"position":"D","handedness":"L","overall":63 },
                { "externalId":"lhl-120","name":"Jaroslav Tichy", "age":29,"position":"D","handedness":"R","overall":61 },
                { "externalId":"lhl-121","name":"Sergei Morozov", "age":27,"position":"G","handedness":"L","overall":80 },
                { "externalId":"lhl-122","name":"Lukas Nemec",    "age":24,"position":"G","handedness":"L","overall":68 }
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Southern Conference",
      "divisions": [
        {
          "name": "Coastal Division",
          "teams": [
            {
              "externalId":  "lhl-team-3",
              "city":        "Eastville",
              "nickname":    "Tides",
              "abbreviation":"EVT",
              "primary":     "#006400",
              "secondary":   "#FFD700",
              "players": [
                { "externalId":"lhl-201","name":"Antonio Ricci",  "age":26,"position":"C","handedness":"L","overall":83 },
                { "externalId":"lhl-202","name":"Oleg Tarasov",   "age":28,"position":"C","handedness":"R","overall":73 },
                { "externalId":"lhl-203","name":"Mikko Leinonen", "age":31,"position":"C","handedness":"L","overall":70 },
                { "externalId":"lhl-204","name":"Chris Hartley",  "age":22,"position":"C","handedness":"L","overall":64,"potential":79 },
                { "externalId":"lhl-205","name":"Florian Dietrich","age":27,"position":"W","handedness":"L","overall":82 },
                { "externalId":"lhl-206","name":"Kenji Yamamoto", "age":25,"position":"W","handedness":"R","overall":77 },
                { "externalId":"lhl-207","name":"Denis Cherepanov","age":30,"position":"W","handedness":"L","overall":74 },
                { "externalId":"lhl-208","name":"Tobias Keller",  "age":23,"position":"W","handedness":"R","overall":71 },
                { "externalId":"lhl-209","name":"Aleksi Haltia",  "age":27,"position":"W","handedness":"L","overall":68 },
                { "externalId":"lhl-210","name":"Mathieu Garnier","age":26,"position":"W","handedness":"L","overall":66 },
                { "externalId":"lhl-211","name":"Oscar Lindgren", "age":29,"position":"W","handedness":"R","overall":64 },
                { "externalId":"lhl-212","name":"Pavel Cizek",    "age":21,"position":"W","handedness":"L","overall":62 },
                { "externalId":"lhl-213","name":"Maxim Ignatov",  "age":28,"position":"W","handedness":"R","overall":60 },
                { "externalId":"lhl-214","name":"Stefan Braun",   "age":27,"position":"D","handedness":"R","overall":78 },
                { "externalId":"lhl-215","name":"Ville Heikkinen","age":26,"position":"D","handedness":"L","overall":75 },
                { "externalId":"lhl-216","name":"Radek Cerveny",  "age":29,"position":"D","handedness":"R","overall":71 },
                { "externalId":"lhl-217","name":"Andrei Golubev", "age":24,"position":"D","handedness":"L","overall":68 },
                { "externalId":"lhl-218","name":"Jack Whitfield", "age":22,"position":"D","handedness":"R","overall":65,"potential":76 },
                { "externalId":"lhl-219","name":"Hugo Mercier",   "age":31,"position":"D","handedness":"L","overall":62 },
                { "externalId":"lhl-220","name":"Tomasz Wojcik",  "age":28,"position":"D","handedness":"R","overall":60 },
                { "externalId":"lhl-221","name":"Alexei Kuznetsov","age":29,"position":"G","handedness":"L","overall":81 },
                { "externalId":"lhl-222","name":"Mikael Forsberg","age":25,"position":"G","handedness":"L","overall":69 }
              ]
            },
            {
              "externalId":  "lhl-team-4",
              "city":        "Westpoint",
              "nickname":    "Thunder",
              "abbreviation":"WPT",
              "primary":     "#4B0082",
              "secondary":   "#E0E0E0",
              "players": [
                { "externalId":"lhl-301","name":"Sven Magnusson", "age":27,"position":"C","handedness":"L","overall":86 },
                { "externalId":"lhl-302","name":"Romain Bouchard","age":24,"position":"C","handedness":"R","overall":75 },
                { "externalId":"lhl-303","name":"Stanislav Horak","age":32,"position":"C","handedness":"L","overall":71 },
                { "externalId":"lhl-304","name":"Finn Jacobsen",  "age":21,"position":"C","handedness":"L","overall":63,"potential":81 },
                { "externalId":"lhl-305","name":"Tommi Rantanen", "age":28,"position":"W","handedness":"L","overall":83 },
                { "externalId":"lhl-306","name":"Xavier Chartier","age":26,"position":"W","handedness":"R","overall":79 },
                { "externalId":"lhl-307","name":"Rostislav Kolar","age":29,"position":"W","handedness":"L","overall":75 },
                { "externalId":"lhl-308","name":"Jan Vesely",     "age":23,"position":"W","handedness":"R","overall":72 },
                { "externalId":"lhl-309","name":"Niklas Freund",  "age":27,"position":"W","handedness":"L","overall":69 },
                { "externalId":"lhl-310","name":"Arttu Peltonen", "age":22,"position":"W","handedness":"L","overall":67,"potential":78 },
                { "externalId":"lhl-311","name":"Daniel Cermak",  "age":30,"position":"W","handedness":"R","overall":65 },
                { "externalId":"lhl-312","name":"Mathias Bakke",  "age":25,"position":"W","handedness":"L","overall":62 },
                { "externalId":"lhl-313","name":"Lasse Thorsen",  "age":28,"position":"W","handedness":"R","overall":61 },
                { "externalId":"lhl-314","name":"Gregor Mayer",   "age":28,"position":"D","handedness":"R","overall":80 },
                { "externalId":"lhl-315","name":"Patrik Navratil","age":27,"position":"D","handedness":"L","overall":77 },
                { "externalId":"lhl-316","name":"Ilkka Laukkanen","age":26,"position":"D","handedness":"R","overall":73 },
                { "externalId":"lhl-317","name":"Brendan Cassidy","age":24,"position":"D","handedness":"L","overall":70 },
                { "externalId":"lhl-318","name":"Morten Dahl",    "age":23,"position":"D","handedness":"R","overall":66,"potential":75 },
                { "externalId":"lhl-319","name":"Ondrej Havel",   "age":31,"position":"D","handedness":"L","overall":63 },
                { "externalId":"lhl-320","name":"Sergei Plotnikov","age":29,"position":"D","handedness":"R","overall":61 },
                { "externalId":"lhl-321","name":"Henrik Johannsen","age":30,"position":"G","handedness":"L","overall":83 },
                { "externalId":"lhl-322","name":"Mario Baier",    "age":27,"position":"G","handedness":"L","overall":71 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Face pack and logo pack

Place images alongside `database.json` in the mod sub-folder:

```
mods/my-pack/
  database.json
  faces/
    nhl-8478402.png     ← faceId referenced in a ModPlayer
  logos/
    logo-ngl.png        ← logoId referenced in a ModTeam
```

Image formats: PNG recommended; JPEG accepted. Face images should be square
(ideally 256×256 px). Logo images should have a transparent background
(ideally 512×512 px PNG).

If an image file is missing the game silently falls back to a generated
silhouette (for faces) or a color crest derived from the team's primary color
(for logos).

---

## Building a real-roster database yourself

The game can never ship real NHL player or team data, but nothing prevents you
from building a database from public information and distributing it separately.

### Using the free NHL API

The official NHL stats API (`api-web.nhle.com`) returns JSON with no
authentication key. Community documentation of all endpoints is at
https://github.com/Zmalski/NHL-API-Reference.

Useful endpoints for an importer:

| Endpoint | What you get |
|----------|-------------|
| `https://api-web.nhle.com/v1/standings/now` | Current standings with team IDs |
| `https://api-web.nhle.com/v1/roster/{teamAbbr}/current` | Full roster with player IDs, positions, handed-ness |
| `https://api-web.nhle.com/v1/player/{playerId}/landing` | Career stats, age, position, name |

Suggested importer workflow (no scraper shipped — you write this):

1. Fetch `standings/now` to get every team's abbreviation.
2. For each team, fetch `roster/{abbr}/current` to enumerate player IDs.
3. For each player, fetch `player/{id}/landing` for name, age, position, and
   handedness.
4. Map the NHL API position codes (`C`, `L` → `W`, `R` → `W`, `D`, `G`) to the
   mod format.
5. Convert the player's NHL player ID to an `externalId` string, e.g.
   `"nhl-8478402"`.
6. Translate stats-based overall estimates into the `overall` shorthand (or
   fill `attributes` keys individually for a more nuanced map).
7. Emit a `database.json` conforming to the schema above and validate it with a
   tool that calls `validateModDatabase` before shipping it.

**Important:** the `overall` field is a shorthand — the game synthesises
realistic attribute variation around it. A simple mapping like
"points/game → overall" will produce a playable database even without deep
attribute research.

---

## Legal note

This game ships only fictional data. Real team names, player names, and logos
are intellectual property of the NHL, NHLPA, and individual clubs respectively.
No real data is included in the base game.

Mods that include real names or likenesses are created and distributed entirely
by community members, not by this game's developers. Users install community
mods at their own discretion. This is the same legal model used by games like
Eastside Hockey Manager — the official game is fictional; community roster packs
are unofficial, user-created add-ons.

If you create a roster pack, do not include official logos or photos you do not
have rights to redistribute. Stick to publicly available text data (names,
statistics) and original or appropriately licensed artwork.
