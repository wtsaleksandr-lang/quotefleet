#!/usr/bin/env bash
# Encode the two hero loops: trim blank SPA-load lead-in → mild speedup → seamless
# crossfade-wrap (last 0.5s dissolves into the static opening) → VP9 webm (<400KB)
# + H.264 mp4 (<700KB) + poster jpg. Output → src/server/public/marketing/.
set -e
cd "$(dirname "$0")/.."
OUT=src/server/public/marketing
REV=_rec
X=0.5   # crossfade-wrap length (seconds)

# name : raw : trim_start(T0) : speed : poster_ts_from_start
# SPEED is ~1.0 on purpose. The old 1.25x/1.10x speed-up compounded with already
# short holds and cut the payoff frame (the quote / the parsed rate cards) to
# about ONE SECOND on screen — long enough to notice a number appeared, far too
# short to read it. The recordings now carry their own pacing, so don't
# re-compress it here. Posters point INTO the payoff hold, not the lead-in.
# Posters point INTO the payoff (final-webm timestamps): phone → the $3,950
# instant-quote total (~8.0s final); laptop → the new lead (Marcus Webb ·
# $3,950 · NEW) landing on the board (~17.2s final).
ROWS=(
  "qf-hero-phone:qf-hero-phone-raw:1.05:1.05:8.0"
  "qf-hero-laptop:qf-hero-laptop-raw:0.55:1.00:17.2"
)

seamless() {
  # $1 raw  $2 out  $3 T0  $4 SPEED
  local raw="$1" out="$2" t0="$3" spd="$4" crf="$5" codecargs="$6"
  local rawdur d d2x
  rawdur=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$raw")
  d=$(awk -v r="$rawdur" -v t="$t0" -v s="$spd" 'BEGIN{printf "%.3f",(r-t)/s}')
  d2x=$(awk -v d="$d" -v x="$X" 'BEGIN{printf "%.3f",d-2*x}')
  ffmpeg -y -loglevel error -ss "$t0" -i "$raw" -filter_complex \
"[0:v]setpts=(PTS-STARTPTS)/$spd,fps=25,format=yuv420p,split[c0][c1];\
[c0]trim=$X:$d,setpts=PTS-STARTPTS[main];\
[c1]trim=0:$X,setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=$X:alpha=1,setpts=PTS+$d2x/TB[head];\
[main][head]overlay=eof_action=pass:format=auto,format=yuv420p[v]" \
    -map "[v]" -an $codecargs "$out"
}

# Optional first arg = encode ONLY the row whose name matches (e.g. qf-hero-laptop).
FILTER="${1:-}"
for row in "${ROWS[@]}"; do
  IFS=':' read -r name raw t0 spd pts <<< "$row"
  if [ -n "$FILTER" ] && [ "$name" != "$FILTER" ]; then continue; fi
  RAW="$REV/$raw.webm"
  echo "== $name  (raw=$RAW T0=$t0 speed=$spd) =="

  # WEBM (VP9) — climb CRF until under 400KB. Ladder runs up to VP9's max (63)
  # so the longer, motion-heavy laptop loop can still fit the 400KB budget; the
  # payoff HOLDS are near-static so they compress cleanly and stay legible even
  # at the high end, while the softening lands on the fast pan frames.
  for crf in 32 35 38 42 46 50 54 58 61 63; do
    seamless "$RAW" "$OUT/$name.webm" "$t0" "$spd" "$crf" "-c:v libvpx-vp9 -b:v 0 -crf $crf -row-mt 1 -deadline good -cpu-used 1"
    sz=$(stat -c%s "$OUT/$name.webm")
    if [ "$sz" -lt 409600 ]; then echo "  webm crf=$crf size=$sz OK"; break; fi
    echo "  webm crf=$crf size=$sz too big, retry"
  done

  # MP4 (H.264) — climb CRF until under 700KB. Ladder extends past 37 so the
  # longer laptop loop (with the follow-up scene) still fits the 700KB budget.
  for crf in 26 28 31 34 37 40 43 46; do
    seamless "$RAW" "$OUT/$name.mp4" "$t0" "$spd" "$crf" "-c:v libx264 -crf $crf -preset veryslow -movflags +faststart"
    sz=$(stat -c%s "$OUT/$name.mp4")
    if [ "$sz" -lt 716800 ]; then echo "  mp4  crf=$crf size=$sz OK"; break; fi
    echo "  mp4  crf=$crf size=$sz too big, retry"
  done

  # Poster from the final webm.
  ffmpeg -y -loglevel error -ss "$pts" -i "$OUT/$name.webm" -frames:v 1 -q:v 3 "$OUT/$name-poster.jpg"

  d=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$OUT/$name.webm")
  dim=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT/$name.webm")
  echo "  final: ${dim} dur=${d} webm=$(stat -c%s "$OUT/$name.webm") mp4=$(stat -c%s "$OUT/$name.mp4") poster=$(stat -c%s "$OUT/$name-poster.jpg")"
done
echo "DONE"
