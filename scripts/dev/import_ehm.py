#!/usr/bin/env python3
"""
DEV-ONLY EHM roster importer.

Reads an EHM "Players and non-players" .xlsx export, filters to the 32 NHL
clubs, and emits a fictional-DB-shaped mod our loader understands:

    mods/nhl-ehm/database.json   - ModDatabase (real names/teams/positions)
    mods/nhl-ehm/faces.json      - faceId -> absolute facepack PNG path

Nothing here is committed (mods/ is gitignored). The shipped game stays
fictional; this is only to make local review familiar.

Usage:
    py scripts/dev/import_ehm.py <export.xlsx> <out_dir> [facepack_dir ...]
"""
import sys, os, io, json, unicodedata, glob, shutil

# Column indices (0-based) from the EHM "Players and non-players" export.
C_FIRST, C_SECOND, C_DOB, C_NATION = 1, 2, 3, 4
C_JOB, C_CLUB = 9, 11
C_CA, C_PA = 37, 38
C_GOALIE, C_LD, C_RD, C_LW, C_C, C_RW = 42, 43, 44, 45, 46, 47
C_HAND = 51

SEASON_YEAR = 2025

# nickname -> (city, abbr, conference, division, primary, secondary)
NHL = {
    "Bruins": ("Boston", "BOS", "Eastern", "Atlantic", "#FFB81C", "#000000"),
    "Sabres": ("Buffalo", "BUF", "Eastern", "Atlantic", "#003087", "#FFB81C"),
    "Red Wings": ("Detroit", "DET", "Eastern", "Atlantic", "#CE1126", "#FFFFFF"),
    "Panthers": ("Florida", "FLA", "Eastern", "Atlantic", "#041E42", "#C8102E"),
    "Canadiens": ("Montreal", "MTL", "Eastern", "Atlantic", "#AF1E2D", "#192168"),
    "Senators": ("Ottawa", "OTT", "Eastern", "Atlantic", "#C8102E", "#000000"),
    "Lightning": ("Tampa Bay", "TBL", "Eastern", "Atlantic", "#002868", "#FFFFFF"),
    "Maple Leafs": ("Toronto", "TOR", "Eastern", "Atlantic", "#00205B", "#FFFFFF"),
    "Hurricanes": ("Carolina", "CAR", "Eastern", "Metropolitan", "#CC0000", "#000000"),
    "Blue Jackets": ("Columbus", "CBJ", "Eastern", "Metropolitan", "#002654", "#CE1126"),
    "Devils": ("New Jersey", "NJD", "Eastern", "Metropolitan", "#CE1126", "#000000"),
    "Islanders": ("New York", "NYI", "Eastern", "Metropolitan", "#00539B", "#F47D30"),
    "Rangers": ("New York", "NYR", "Eastern", "Metropolitan", "#0038A8", "#CE1126"),
    "Flyers": ("Philadelphia", "PHI", "Eastern", "Metropolitan", "#F74902", "#000000"),
    "Penguins": ("Pittsburgh", "PIT", "Eastern", "Metropolitan", "#FCB514", "#000000"),
    "Capitals": ("Washington", "WSH", "Eastern", "Metropolitan", "#C8102E", "#041E42"),
    "Blackhawks": ("Chicago", "CHI", "Western", "Central", "#CF0A2C", "#000000"),
    "Avalanche": ("Colorado", "COL", "Western", "Central", "#6F263D", "#236192"),
    "Stars": ("Dallas", "DAL", "Western", "Central", "#006847", "#000000"),
    "Wild": ("Minnesota", "MIN", "Western", "Central", "#154734", "#A6192E"),
    "Predators": ("Nashville", "NSH", "Western", "Central", "#FFB81C", "#041E42"),
    "Blues": ("St. Louis", "STL", "Western", "Central", "#002F87", "#FCB514"),
    "Mammoth": ("Utah", "UTA", "Western", "Central", "#69BE28", "#010101"),
    "Jets": ("Winnipeg", "WPG", "Western", "Central", "#041E42", "#004C97"),
    "Ducks": ("Anaheim", "ANA", "Western", "Pacific", "#F47A38", "#B09862"),
    "Flames": ("Calgary", "CGY", "Western", "Pacific", "#C8102E", "#F1BE48"),
    "Oilers": ("Edmonton", "EDM", "Western", "Pacific", "#FF4C00", "#041E42"),
    "Kings": ("Los Angeles", "LAK", "Western", "Pacific", "#111111", "#A2AAAD"),
    "Sharks": ("San Jose", "SJS", "Western", "Pacific", "#006D75", "#000000"),
    "Kraken": ("Seattle", "SEA", "Western", "Pacific", "#001628", "#99D9D9"),
    "Canucks": ("Vancouver", "VAN", "Western", "Pacific", "#00205B", "#00843D"),
    "Golden Knights": ("Vegas", "VGK", "Western", "Pacific", "#B4975A", "#333F42"),
}

def norm(s):
    """Lowercase, strip accents, spaces->underscores — for face matching."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return s.lower().replace(" ", "_").strip()

def match_club(club):
    if not club or club == "[None]":
        return None
    for nick in NHL:
        if nick.lower() in str(club).lower():
            return nick
    return None

def position(row):
    g = row[C_GOALIE] or 0
    d = max(row[C_LD] or 0, row[C_RD] or 0)
    c = row[C_C] or 0
    w = max(row[C_LW] or 0, row[C_RW] or 0)
    best = max((g, "G"), (d, "D"), (c, "C"), (w, "W"), key=lambda t: t[0])
    return best[1]

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def to_int(v, default=0):
    try:
        return int(float(v))
    except Exception:
        return default

def main():
    xlsx, out_dir = sys.argv[1], sys.argv[2]
    facedirs = sys.argv[3:]
    import openpyxl
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    it = ws.iter_rows(values_only=True); next(it); next(it)

    # team -> list of player dicts
    teams = {nick: [] for nick in NHL}
    for r in it:
        job = r[C_JOB]
        if not (job and "player" in str(job).lower()):
            continue
        nick = match_club(r[C_CLUB])
        if nick is None:
            continue
        first, last = str(r[C_FIRST] or "").strip(), str(r[C_SECOND] or "").strip()
        if not first and not last:
            continue
        dob = str(r[C_DOB] or "")
        parts = dob.split(".")
        year = to_int(parts[2]) if len(parts) == 3 else 0
        age = clamp(SEASON_YEAR - year if year else 25, 16, 45)
        ca = to_int(r[C_CA], 50)
        pa = to_int(r[C_PA], ca)
        face_id = norm(f"{first}_{last}_{'_'.join(parts)}") if len(parts) == 3 else None
        teams[nick].append({
            "externalId": f"ehm-{norm(first)}-{norm(last)}-{year}",
            "name": f"{first} {last}".strip(),
            "age": age,
            "position": position(r),
            "handedness": "L" if str(r[C_HAND] or "Right").lower().startswith("l") else "R",
            "overall": clamp(round(ca / 2), 1, 99),
            "potential": clamp(round(pa / 2), 1, 99),
            "faceId": face_id,
            "_ca": ca,
        })

    # Build face index from the facepack dirs (filename without .png -> path).
    face_index = {}
    for d in facedirs:
        for p in glob.glob(os.path.join(d, "*.png")):
            face_index[norm(os.path.splitext(os.path.basename(p))[0])] = p

    # Copy matched faces into the mod's own faces/ folder (self-contained,
    # per MODDING.md: faces/<faceId>.png). Keeps the mod portable instead of
    # depending on the multi-GB external facepacks at runtime.
    faces_dir = os.path.join(out_dir, "faces")
    os.makedirs(faces_dir, exist_ok=True)

    # Assemble conferences/divisions/teams; per team take a sensible NHL roster.
    confs = {}
    faces_out = {}
    matched = 0
    total = 0
    for nick, (city, abbr, conf, div, prim, sec) in NHL.items():
        roster = sorted(teams[nick], key=lambda p: -p["_ca"])
        goalies = [p for p in roster if p["position"] == "G"][:3]
        d = [p for p in roster if p["position"] == "D"][:8]
        fwd = [p for p in roster if p["position"] in ("C", "W")][:14]
        chosen = goalies[:max(2, len(goalies))] + d + fwd
        # ensure minimums
        if len(goalies) < 2 or len(d) < 7 or len(fwd) < 13:
            print(f"  WARN {nick}: G{len(goalies)} D{len(d)} F{len(fwd)}")
        clean = []
        for p in chosen:
            total += 1
            fid = p.get("faceId")
            if fid and fid in face_index:
                dest = os.path.join(faces_dir, fid + ".png")
                if not os.path.exists(dest):
                    try:
                        shutil.copyfile(face_index[fid], dest)
                    except Exception:
                        pass
                faces_out[fid] = fid + ".png"
                matched += 1
            elif fid:
                # keep faceId even if no image (resolver falls back to avatar)
                pass
            q = {k: v for k, v in p.items() if not k.startswith("_")}
            clean.append(q)
        confs.setdefault(conf, {}).setdefault(div, []).append({
            "externalId": f"ehm-team-{abbr}",
            "city": city, "nickname": nick, "abbreviation": abbr,
            "primary": prim, "secondary": sec, "players": clean,
        })

    db = {
        "formatVersion": 1,
        "meta": {"name": "NHL (EHM import, dev)", "author": "local", "season": "2025-26"},
        "conferences": [
            {"name": cname, "divisions": [{"name": dname, "teams": dteams}
                                          for dname, dteams in divs.items()]}
            for cname, divs in confs.items()
        ],
    }
    os.makedirs(out_dir, exist_ok=True)
    io.open(os.path.join(out_dir, "database.json"), "w", encoding="utf-8").write(
        json.dumps(db, ensure_ascii=False))
    io.open(os.path.join(out_dir, "faces.json"), "w", encoding="utf-8").write(
        json.dumps(faces_out, ensure_ascii=False))
    nteams = sum(len(d) for c in db["conferences"] for d in [t for t in [dd["teams"] for dd in c["divisions"]]])
    print(f"teams: {sum(len(dd['teams']) for c in db['conferences'] for dd in c['divisions'])}")
    print(f"players: {total}  faces matched: {matched} ({100*matched//max(1,total)}%)")

if __name__ == "__main__":
    main()
