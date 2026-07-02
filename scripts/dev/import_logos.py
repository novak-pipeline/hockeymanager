"""Copy team logos from an EHM logo megapack into a mod's logos/ folder.

Dev-only (gitignored output; we never ship real NHL marks - fictional DB only).

The pack (Steam workshop) is organized as clubs/{huge,large,small}/<League>/<Team>.png,
keyed by club NAME. We read the mod's database.json, collect every team-like
object (anything with both "name" and "abbreviation"), and copy the matching
huge PNG to mods/<mod>/logos/<sanitized-name>.png. The renderer resolves crests
by the same sanitization at run time, so no database changes are needed.

Usage:
  python scripts/dev/import_logos.py [pack_dir] [mod_dir]
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

DEFAULT_PACK = Path(r"X:/SteamLibrary/steamapps/workshop/content/301120/1720743334")
DEFAULT_MOD = Path(__file__).resolve().parents[2] / "mods" / "nhl-ehm"

# NHL/AHL first so their versions win when a name exists in several leagues.
PRIORITY_LEAGUES = ["National Hockey League", "American Hockey League"]

# DB names ("City Nickname") -> the pack's real club branding.
ALIASES = {
    "Wilkes-Barre Penguins": "Wilkes-Barre/Scranton Penguins",
    "Cedar Park Stars": "Texas Stars",
    "Des Moines Wild": "Iowa Wild",
    "Winnipeg Moose": "Manitoba Moose",
    "Palm Desert Firebirds": "Coachella Valley Firebirds",
}


def sanitize(name: str) -> str:
    """Mirror of the renderer's logoIdFor(): keep [A-Za-z0-9._-], rest -> _."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)[:60]


def loose(name: str) -> str:
    """Fuzzy key: lowercase alphanumerics only (St. Louis == St Louis)."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def collect_team_names(node: object, out: set[str]) -> None:
    if isinstance(node, dict):
        # Team-like objects carry city + nickname (full name = "Boston Bruins").
        if isinstance(node.get("city"), str) and isinstance(node.get("nickname"), str):
            out.add(f"{node['city']} {node['nickname']}")
        for v in node.values():
            collect_team_names(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_team_names(v, out)


def main() -> None:
    pack = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PACK
    mod = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_MOD
    clubs = pack / "clubs" / "huge"
    if not clubs.is_dir():
        sys.exit(f"pack clubs/huge not found at {clubs}")
    db_path = mod / "database.json"
    if not db_path.is_file():
        sys.exit(f"mod database not found at {db_path}")

    names: set[str] = set()
    collect_team_names(json.loads(db_path.read_text(encoding="utf-8")), names)
    print(f"{len(names)} team names in {db_path.name}")

    # Index the pack: loose-name -> png path. Priority leagues first;
    # first writer wins, so NHL/AHL versions beat minor-league name clashes.
    index: dict[str, Path] = {}
    league_dirs = [clubs / lg for lg in PRIORITY_LEAGUES if (clubs / lg).is_dir()]
    league_dirs += sorted(d for d in clubs.iterdir() if d.is_dir() and d.name not in PRIORITY_LEAGUES)
    for d in league_dirs:
        for png in d.glob("*.png"):
            index.setdefault(loose(png.stem), png)
    print(f"{len(index)} distinct club logos in pack")

    out_dir = mod / "logos"
    out_dir.mkdir(exist_ok=True)
    copied, missed = 0, []
    for name in sorted(names):
        src = index.get(loose(ALIASES.get(name, name)))
        if src is None:
            missed.append(name)
            continue
        shutil.copyfile(src, out_dir / f"{sanitize(name)}.png")
        copied += 1
    print(f"copied {copied} logos -> {out_dir}")
    if missed:
        print(f"no logo found for {len(missed)}:")
        for n in missed:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
