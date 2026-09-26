#!/usr/bin/env bash
# Blender-vs-procedural bake-off: renders the SAME harness shots with both
# athlete sources and tiles them side by side (left = procedural, right =
# Blender) into docs/graphics/blender/. Needs the harness on :5175 and Python+Pillow.
#   bash scripts/dev/render3d-harness/bakeoff.sh [shot-name ...]
set -e
cd "$(dirname "$0")/../../.."
OUT=docs/graphics/blender
TMP=${TMPDIR:-/tmp}/r3d-bakeoff
mkdir -p "$OUT" "$TMP"
declare -A SHOTS=(
  [broadcast]="t=0.3&cam=broadcast|3000"
  [broadcast-play]="t=0.3&cam=broadcast&play=1|3500"
  [front]="t=0.3&closeup=away:0,14,30|3000"
  [back]="t=0.3&closeup=home:1,10,200,5|3000"
  [goalie]="t=0.3&closeup=home:g,12,20,5|3000"
  [butterfly]="t=0.3&fly=1&closeup=home:g,12,20,4|3500"
  [skating]="t=0.3&play=1&closeup=home:2,16,80,5|2600"
  [endzone]="t=0.3&cam=endzone|3000"
  [overhead]="t=0.3&cam=overhead|3000"
)
names=("$@")
[ ${#names[@]} -eq 0 ] && names=("${!SHOTS[@]}")
for n in "${names[@]}"; do
  IFS='|' read -r q w <<<"${SHOTS[$n]}"
  node scripts/dev/render3d-harness/shot.mjs "$TMP/p-$n.png" "$q" --wait="$w" >/dev/null
  node scripts/dev/render3d-harness/shot.mjs "$TMP/b-$n.png" "$q&model=blender" --wait="$w" >/dev/null
  python - "$TMP/p-$n.png" "$TMP/b-$n.png" "$OUT/bakeoff-$n.png" <<'EOF'
import sys
from PIL import Image, ImageDraw
a, b = Image.open(sys.argv[1]).convert('RGB'), Image.open(sys.argv[2]).convert('RGB')
w, h = a.size
s = Image.new('RGB', (w * 2 + 8, h), (0, 0, 0))
s.paste(a, (0, 0)); s.paste(b, (w + 8, 0))
d = ImageDraw.Draw(s)
for x, t in ((10, 'PROCEDURAL (current)'), (w + 18, 'BLENDER')):
    d.rectangle((x - 4, 6, x + 150, 24), fill=(0, 0, 0))
    d.text((x, 9), t, fill=(255, 220, 60))
s = s.resize((s.width * 3 // 4, s.height * 3 // 4), Image.LANCZOS)
s.save(sys.argv[3], optimize=True)
EOF
  echo "$n done"
done
