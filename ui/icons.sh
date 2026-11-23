#!/bin/sh
set -eu
cd "$(dirname "$0")/public"

TILE="#6e56f8"
# the loop's width on mark.svg's grid: 49.4 plus its stroke of 8, centred on 32
LOOP_W=57.4

LOOP=$(sed -n 's/.*class="ink" d="\([^"]*\)".*/\1/p' mark.svg)
[ -n "$LOOP" ] || { echo "icons.sh: mark.svg not as expected" >&2; exit 1; }

icon() {
  side=$(awk -v w="$LOOP_W" -v s="$3" 'BEGIN { printf "%.4f", w / s }')
  o=$(awk -v w="$side" 'BEGIN { printf "%.4f", 32 - w / 2 }')
  r=$(awk -v w="$side" -v k="$4" 'BEGIN { printf "%.4f", k == "round" ? w * 0.225 : 0 }')
  {
    echo "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"$2\" height=\"$2\" viewBox=\"$o $o $side $side\">"
    [ "$4" = none ] || echo "<rect x=\"$o\" y=\"$o\" width=\"$side\" height=\"$side\" rx=\"$r\" fill=\"$TILE\"/>"
    echo "<path d=\"$LOOP\" fill=\"none\" stroke=\"#fff\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
    echo "</svg>"
  } > "$1.svg"
  rsvg-convert -w "$2" -h "$2" "$1.svg" -o "$1"
  rm -f "$1.svg"
}

# "any" icons keep transparent corners: Windows, Linux and Edge draw them unmasked
icon icon-192.png          192 0.66 round
icon icon-512.png          512 0.66 round
# an Android launcher shows a maskable icon's middle two-thirds
icon icon-maskable-192.png 192 0.44 square
icon icon-maskable-512.png 512 0.44 square

icon apple-touch-icon.png  180 0.66 square
icon badge.png              96 0.90 none
echo "icons.sh: icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png apple-touch-icon.png badge.png"
