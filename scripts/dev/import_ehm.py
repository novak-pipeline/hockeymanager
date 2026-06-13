#!/usr/bin/env python3
"""
DEV-ONLY EHM roster importer.

Reads an EHM "Players and non-players" .xlsx export, filters to the 32 NHL
clubs AND their 32 AHL affiliates, and emits a fictional-DB-shaped mod our
loader understands:

    mods/nhl-ehm/database.json   - ModDatabase (real names/teams/positions)
    mods/nhl-ehm/faces.json      - faceId -> relative faces/<faceId>.png path

Nothing here is committed (mods/ is gitignored). The shipped game stays
fictional; this is only to make local review familiar.

AHL affiliates:
  Each NHL ModTeam now carries an optional `affiliate` field (ModAffiliate) with
  the AHL club's city/nickname/abbreviation/colors and its player roster. Players
  whose ClubPlaying matches a known AHL club are routed to that parent's affiliate.
  Only the real AHL players we match are emitted (an affiliate may be thin or
  empty); the game's mod loader tops every affiliate up to valid roster minimums
  with synthesised depth fillers, so we never duplicate an NHL player onto two
  teams.

AHL->NHL parent map (32 affiliates):
  Toronto Marlies     -> TOR    Laval Rocket          -> MTL
  Hershey Bears       -> WSH    Providence Bruins     -> BOS
  Rochester Americans -> BUF    Grand Rapids Griffins -> DET
  Charlotte Checkers  -> FLA    Belleville Senators   -> OTT
  Syracuse Crunch     -> TBL    Cleveland Monsters    -> CBJ
  Utica Comets        -> NJD    Bridgeport Islanders  -> NYI
  Hartford Wolf Pack  -> NYR    Lehigh Valley Phantoms-> PHI
  W-B/Scranton Pens   -> PIT    Rockford IceHogs      -> CHI
  Colorado Eagles     -> COL    Texas Stars           -> DAL
  Iowa Wild           -> MIN    Milwaukee Admirals    -> NSH
  Springfield T-Birds -> STL    Tucson Roadrunners    -> UTA
  Manitoba Moose      -> WPG    San Diego Gulls       -> ANA
  Calgary Wranglers   -> CGY    Bakersfield Condors   -> EDM
  Ontario Reign       -> LAK    San Jose Barracuda    -> SJS
  Coachella Valley    -> SEA    Abbotsford Canucks    -> VAN
  Henderson Silver K. -> VGK    Capitals AHL*         -> WSH (fallback)

* WSH has Hershey Bears as its primary affiliate.

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

# AHL club nickname keywords -> (parent NHL abbreviation, city, full nickname,
#                                 abbreviation, primary, secondary)
# Keyword matching: if any word in this key appears in ClubPlaying (case-insensitive).
AHL_CLUBS = {
    "Marlies":       ("TOR", "Toronto",              "Marlies",       "TOR", "#003E7E", "#FFFFFF"),
    "Rocket":        ("MTL", "Laval",                "Rocket",        "LAV", "#AF1E2D", "#192168"),
    "Hershey":       ("WSH", "Hershey",              "Bears",         "HER", "#862633", "#C0A96A"),
    "Providence":    ("BOS", "Providence",           "Bruins",        "PRO", "#FFB81C", "#000000"),
    "Rochester":     ("BUF", "Rochester",            "Americans",     "ROC", "#003087", "#FFB81C"),
    "Grand Rapids":  ("DET", "Grand Rapids",         "Griffins",      "GRR", "#CE1126", "#FFFFFF"),
    "Charlotte":     ("FLA", "Charlotte",            "Checkers",      "CLT", "#041E42", "#C8102E"),
    "Belleville":    ("OTT", "Belleville",           "Senators",      "BEL", "#C8102E", "#000000"),
    "Syracuse":      ("TBL", "Syracuse",             "Crunch",        "SYR", "#002868", "#FFFFFF"),
    "Cleveland":     ("CBJ", "Cleveland",            "Monsters",      "CLE", "#002654", "#CE1126"),
    "Utica":         ("NJD", "Utica",                "Comets",        "UTI", "#CE1126", "#000000"),
    "Bridgeport":    ("NYI", "Bridgeport",           "Islanders",     "BRI", "#00539B", "#F47D30"),
    "Hartford":      ("NYR", "Hartford",             "Wolf Pack",     "HAR", "#0038A8", "#CE1126"),
    "Lehigh":        ("PHI", "Lehigh Valley",        "Phantoms",      "LHV", "#F74902", "#000000"),
    "Wilkes":        ("PIT", "Wilkes-Barre",         "Penguins",      "WBS", "#FCB514", "#000000"),
    "Rockford":      ("CHI", "Rockford",             "IceHogs",       "RFD", "#CF0A2C", "#000000"),
    "Colorado Eagles": ("COL", "Colorado",           "Eagles",        "COE", "#6F263D", "#236192"),
    "Texas":         ("DAL", "Cedar Park",           "Stars",         "TEX", "#006847", "#000000"),
    "Iowa":          ("MIN", "Des Moines",           "Wild",          "IOW", "#154734", "#A6192E"),
    "Milwaukee":     ("NSH", "Milwaukee",            "Admirals",      "MIL", "#FFB81C", "#041E42"),
    "Springfield":   ("STL", "Springfield",          "Thunderbirds",  "SPR", "#002F87", "#FCB514"),
    "Tucson":        ("UTA", "Tucson",               "Roadrunners",   "TUC", "#69BE28", "#010101"),
    "Manitoba":      ("WPG", "Winnipeg",             "Moose",         "MAN", "#041E42", "#004C97"),
    "San Diego":     ("ANA", "San Diego",            "Gulls",         "SDG", "#F47A38", "#B09862"),
    "Wranglers":     ("CGY", "Calgary",              "Wranglers",     "CGW", "#C8102E", "#F1BE48"),
    "Bakersfield":   ("EDM", "Bakersfield",          "Condors",       "BAK", "#FF4C00", "#041E42"),
    "Ontario":       ("LAK", "Ontario",              "Reign",         "ONT", "#111111", "#A2AAAD"),
    "Barracuda":     ("SJS", "San Jose",             "Barracuda",     "SJB", "#006D75", "#000000"),
    "Coachella":     ("SEA", "Palm Desert",          "Firebirds",     "CVF", "#001628", "#99D9D9"),
    "Abbotsford":    ("VAN", "Abbotsford",           "Canucks",       "ABB", "#00205B", "#00843D"),
    "Henderson":     ("VGK", "Henderson",            "Silver Knights","HEN", "#B4975A", "#333F42"),
}

def norm(s):
    """Lowercase, strip accents, spaces->underscores — for face matching."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return s.lower().replace(" ", "_").strip()

def match_nhl_club(club):
    """Return the NHL nickname key if the club string matches an NHL team."""
    if not club or club == "[None]":
        return None
    for nick in NHL:
        if nick.lower() in str(club).lower():
            return nick
    return None

def match_ahl_club(club):
    """Return the AHL keyword key if the club string matches a known AHL affiliate."""
    if not club or club == "[None]":
        return None
    club_lower = str(club).lower()
    for keyword in AHL_CLUBS:
        # Multi-word keywords (e.g. "Grand Rapids", "San Diego") need all words present.
        if all(word.lower() in club_lower for word in keyword.split()):
            return keyword
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
    nhl_teams = {nick: [] for nick in NHL}
    # ahl_keyword -> list of player dicts
    ahl_teams = {kw: [] for kw in AHL_CLUBS}

    for r in it:
        job = r[C_JOB]
        if not (job and "player" in str(job).lower()):
            continue
        club = r[C_CLUB]

        # Try NHL match first, then AHL.
        nhl_nick = match_nhl_club(club)
        ahl_kw = None if nhl_nick else match_ahl_club(club)

        if nhl_nick is None and ahl_kw is None:
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
        player = {
            "externalId": f"ehm-{norm(first)}-{norm(last)}-{year}",
            "name": f"{first} {last}".strip(),
            "age": age,
            "position": position(r),
            "handedness": "L" if str(r[C_HAND] or "Right").lower().startswith("l") else "R",
            "overall": clamp(round(ca / 2), 1, 99),
            "potential": clamp(round(pa / 2), 1, 99),
            "faceId": face_id,
            "_ca": ca,
        }
        if nhl_nick:
            nhl_teams[nhl_nick].append(player)
        else:
            ahl_teams[ahl_kw].append(player)

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

    def resolve_faces(players, faces_out, total_ref, matched_ref):
        """Copy face images for a player list, return cleaned player list."""
        clean = []
        for p in players:
            total_ref[0] += 1
            fid = p.get("faceId")
            if fid and fid in face_index:
                dest = os.path.join(faces_dir, fid + ".png")
                if not os.path.exists(dest):
                    try:
                        shutil.copyfile(face_index[fid], dest)
                    except Exception:
                        pass
                faces_out[fid] = fid + ".png"
                matched_ref[0] += 1
            q = {k: v for k, v in p.items() if not k.startswith("_")}
            clean.append(q)
        return clean

    # Build reverse lookup: NHL abbreviation -> NHL nickname key.
    abbr_to_nick = {v[1]: k for k, v in NHL.items()}

    # Assemble conferences/divisions/teams; per NHL team take a sensible roster.
    confs = {}
    faces_out = {}
    total, matched = [0], [0]
    ahl_total, ahl_matched = [0], [0]

    for nick, (city, abbr, conf, div, prim, sec) in NHL.items():
        roster = sorted(nhl_teams[nick], key=lambda p: -p["_ca"])
        goalies = [p for p in roster if p["position"] == "G"][:3]
        d = [p for p in roster if p["position"] == "D"][:8]
        fwd = [p for p in roster if p["position"] in ("C", "W")][:14]
        chosen = goalies[:max(2, len(goalies))] + d + fwd
        overflow = [p for p in roster if p not in chosen]  # NHL players not selected

        if len(goalies) < 2 or len(d) < 7 or len(fwd) < 13:
            print(f"  WARN NHL {nick}: G{len(goalies)} D{len(d)} F{len(fwd)}")

        clean_nhl = resolve_faces(chosen, faces_out, total, matched)

        # Build the affiliate section for this NHL team.
        # Find the AHL club whose parent maps to this NHL abbreviation.
        aff_kw = None
        for kw, (parent_abbr, *_) in AHL_CLUBS.items():
            if parent_abbr == abbr:
                aff_kw = kw
                break

        affiliate_obj = None
        if aff_kw is not None:
            aff_info = AHL_CLUBS[aff_kw]  # (parent_abbr, city, nickname, abbr3, prim, sec)
            _, aff_city, aff_nick, aff_abbr, aff_prim, aff_sec = aff_info
            aff_roster = sorted(ahl_teams[aff_kw], key=lambda p: -p["_ca"])
            aff_goalies = [p for p in aff_roster if p["position"] == "G"][:3]
            aff_d = [p for p in aff_roster if p["position"] == "D"][:8]
            aff_fwd = [p for p in aff_roster if p["position"] in ("C", "W")][:12]
            aff_chosen = aff_goalies[:max(2, len(aff_goalies))] + aff_d + aff_fwd

            if len(aff_goalies) < 2 or len(aff_d) < 5 or len(aff_fwd) < 9:
                # Emit only the real AHL players we matched; the game's loader
                # tops every affiliate up to valid minimums with synthesised
                # depth fillers. We do NOT pad from the NHL parent here — that
                # would duplicate the same real player onto two teams.
                print(f"  note AHL {aff_kw}: G{len(aff_goalies)} D{len(aff_d)} F{len(aff_fwd)} — loader will fill the rest")

            clean_aff = resolve_faces(aff_chosen, faces_out, ahl_total, ahl_matched)

            affiliate_obj = {
                "city": aff_city,
                "nickname": aff_nick,
                "abbreviation": aff_abbr,
                "primary": aff_prim,
                "secondary": aff_sec,
                "players": clean_aff,
            }

        team_obj = {
            "externalId": f"ehm-team-{abbr}",
            "city": city, "nickname": nick, "abbreviation": abbr,
            "primary": prim, "secondary": sec, "players": clean_nhl,
        }
        if affiliate_obj is not None:
            team_obj["affiliate"] = affiliate_obj

        confs.setdefault(conf, {}).setdefault(div, []).append(team_obj)

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
    print(f"NHL teams: {sum(len(dd['teams']) for c in db['conferences'] for dd in c['divisions'])}")
    print(f"NHL players: {total[0]}  faces matched: {matched[0]} ({100*matched[0]//max(1,total[0])}%)")
    print(f"AHL players: {ahl_total[0]}  faces matched: {ahl_matched[0]} ({100*ahl_matched[0]//max(1,ahl_total[0])}%)")

if __name__ == "__main__":
    main()
