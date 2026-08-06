#!/usr/bin/env bash
# Encode the two hero loops: trim blank SPA-load lead-in → seamless crossfade-wrap
# (last 0.5s dissolves into the static opening) → VP9 webm + H.264 mp4 + poster jpg.
# Output → src/server/public/marketing/.
#
# CRISPNESS OVER SIZE (the whole point of this re-record): the old build crushed
# the laptop to ~100 kbps / 320 KB at 1280×800, which — displayed at ~786 CSS px on
# a retina (DSF2 = 1572 physical px) page — was UPSCALED and smeared. Now:
#   · the recorders capture at 2x (laptop raw 2560×1600, phone raw 780×1688),
#   · the laptop is downscaled to 1792×1120 with LANCZOS (≥1572 physical → no
#     upscaling on retina; sharp text),
#   · we encode at a LOW CRF (sharp) and DROP the <400 KB budget. A crisp hero
#     webm of 1–3 MB is fine — sharp text beats a tiny file.
set -e
cd "$(dirname "$0")/.."
OUT=src/server/public/marketing
REV=_rec
X=0.5   # crossfade-wrap length (seconds)

# name : raw : trim_start(T0) : speed : poster_ts : scale_w : scale_h : webm_crf : mp4_crf
# T0 trims the blank SPA-load lead-in up to the first framed beat. Laptop T0 lands
# on the tight beat-1 dropzone framing (see BEAT1_MS logged by the recorder).
# Posters point INTO a content-rich payoff (final-webm timestamps).
ROWS=(
  "qf-hero-phone:qf-hero-phone-raw:1.10:1.05:9.0:520:1126:30:22"
  "qf-hero-laptop:qf-hero-laptop-raw:1.60:1.00:18.5:1792:1120:33:23"
)

seamless() {
  # $1 raw  $2 out  $3 T0  $4 SPEED  $5 sw  $6 sh  $7 codecargs
  local raw="$1" out="$2" t0="$3" spd="$4" sw="$5" sh="$6" codecargs="$7"
  local rawdur d d2x
  rawdur=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$raw")
  d=$(awk -v r="$rawdur" -v t="$t0" -v s="$spd" 'BEGIN{printf "%.3f",(r-t)/s}')
  d2x=$(awk -v d="$d" -v x="$X" 'BEGIN{printf "%.3f",d-2*x}')
  ffmpeg -y -loglevel error -ss "$t0" -i "$raw" -filter_complex \
"[0:v]setpts=(PTS-STARTPTS)/$spd,fps=30,scale=$sw:$sh:flags=lanczos,format=yuv420p,split[c0][c1];\
[c0]trim=$X:$d,setpts=PTS-STARTPTS[main];\
[c1]trim=0:$X,setpts=PTS-STARTPTS,format=yuva420p,fade=t=in:st=0:d=$X:alpha=1,setpts=PTS+$d2x/TB[head];\
[main][head]overlay=eof_action=pass:format=auto,format=yuv420p[v]" \
    -map "[v]" -an $codecargs "$out"
}

# Optional first arg = encode ONLY the row whose name matches (e.g. qf-hero-laptop).
FILTER="${1:-}"
for row in "${ROWS[@]}"; do
  IFS=':' read -r name raw t0 spd pts sw sh wcrf mcrf <<< "$row"
  if [ -n "$FILTER" ] && [ "$name" != "$FILTER" ]; then continue; fi
  RAW="$REV/$raw.webm"
  echo "== $name  (raw=$RAW T0=$t0 speed=$spd scale=${sw}x${sh} webm_crf=$wcrf mp4_crf=$mcrf) =="

  # WEBM (VP9) — fixed LOW crf for sharpness (no size-budget ladder).
  seamless "$RAW" "$OUT/$name.webm" "$t0" "$spd" "$sw" "$sh" \
    "-c:v libvpx-vp9 -b:v 0 -crf $wcrf -row-mt 1 -deadline good -cpu-used 1 -pix_fmt yuv420p"

  # MP4 (H.264) — fixed LOW crf, veryslow, faststart.
  seamless "$RAW" "$OUT/$name.mp4" "$t0" "$spd" "$sw" "$sh" \
    "-c:v libx264 -crf $mcrf -preset veryslow -pix_fmt yuv420p -movflags +faststart"

  # Poster from the final webm (points into the payoff).
  ffmpeg -y -loglevel error -ss "$pts" -i "$OUT/$name.webm" -frames:v 1 -q:v 3 "$OUT/$name-poster.jpg"

  d=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$OUT/$name.webm")
  dim=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT/$name.webm")
  wsz=$(stat -c%s "$OUT/$name.webm"); msz=$(stat -c%s "$OUT/$name.mp4")
  wkbps=$(awk -v s="$wsz" -v dd="$d" 'BEGIN{printf "%d",(s*8/1000)/dd}')
  echo "  final: ${dim} dur=${d} webm=${wsz} (${wkbps} kbps) mp4=${msz} poster=$(stat -c%s "$OUT/$name-poster.jpg")"
done
echo "DONE"
