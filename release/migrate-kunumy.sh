#!/bin/bash
# migrate-kunumy.sh [--dry-run] [--bin FILE]: moves a Linux install from
# its earlier name (program ki, data ~/.ki, services ki-serve and
# ki-device) to Kunumy (kny, ~/.kunumy, kny-serve and kny-device).
# migrate-kunumy.sh --rollback [--dry-run]: puts it back.
#
# The folders move (a rename, so work sessions whose holders keep running
# go on in the same files), and each old path is left as a link to the
# new one: paths in the database, in agents' chats and in running
# processes (~/.ki/scratch/..., ~/.ki/sessions/...) still resolve.
# Moved: ~/.ki (ki.db becomes kunumy.db), ~/.config/ki, ~/.ki-updates,
# ~/.local/share/ki, and the dedicated browser's ~/.local/share and
# ~/.local/state unii-browser folders. config.json and the files in the
# config folder are rewritten (KI_* and UNII_* names become KNY_*, paths
# take the new names); their originals, and the old units, are kept in
# ~/.kunumy-migration for --rollback. The new program (FILE, default the
# kny built beside this script's folder) goes to ~/.local/bin/kny; the
# old one stays. ki-serve and ki-device are stopped and disabled, and
# kny-serve and kny-device made from them (same settings and drop-ins)
# and started; unii-browser.service likewise becomes
# kunumy-browser.service. Holders of running work sessions (ki-hold-*)
# are left running: the new server links to them.
#
# It refuses if ~/.kunumy (other than a rollback's link back) or
# ~/.kunumy-migration exists. --dry-run says
# what it would do, and shows each rewritten line, changing nothing.
set -euo pipefail

DRY="" BACK="" BIN=""
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY=1;;
    --rollback) BACK=1;;
    --bin) BIN=$2; shift;;
    *) echo "usage: migrate-kunumy.sh [--dry-run] [--bin FILE] | --rollback [--dry-run]" >&2; exit 2;;
  esac
  shift
done

H=$HOME
CONF=${XDG_CONFIG_HOME:-$H/.config}
UNITS=$CONF/systemd/user
SAVE=$H/.kunumy-migration
# old and new names of each folder that moves
MOVES=(
  "$H/.ki|$H/.kunumy"
  "$CONF/ki|$CONF/kunumy"
  "$H/.ki-updates|$H/.kunumy-updates"
  "$H/.local/share/ki|$H/.local/share/kunumy"
  "$H/.local/share/unii-browser|$H/.local/share/kunumy-browser"
  "$H/.local/state/unii-browser|$H/.local/state/kunumy-browser"
)
# old and new names of each unit that moves
SERVICES=("ki-serve|kny-serve" "ki-device|kny-device" "unii-browser|kunumy-browser")

say() { printf '%s\n' "$*"; }
die() { printf 'migrate-kunumy: %s\n' "$*" >&2; exit 1; }
# a step: run, or with --dry-run only told
do_() {
  if [ -n "$DRY" ]; then say "  would: $*"; else say "  $*"; "$@"; fi
}
sc() { systemctl --user "$@"; }
active() { sc is-active -q "$1" 2>/dev/null; }
enabled() { sc is-enabled -q "$1" 2>/dev/null; }

# the new names in a file's text: settings KI_*/UNII_* -> KNY_*, and the
# paths of the folders that move
renamed() {
  sed -E 's/\b(KI|UNII)_/KNY_/g;
    s#/\.ki(/|"|$|[[:space:]])#/.kunumy\1#g;
    s#/\.ki-updates(/|"|$|[[:space:]])#/.kunumy-updates\1#g;
    s#/\.config/ki(/|"|$|[[:space:]])#/.config/kunumy\1#g;
    s#/\.local/share/ki(/|"|$|[[:space:]])#/.local/share/kunumy\1#g;
    s#/\.local/bin/ki(\.exe)?("|$|[[:space:]])#/.local/bin/kny\1\2#g;
    s#unii-browser#kunumy-browser#g' "$1"
}

# file $1 rewritten by renamed(), its original kept as $SAVE/files/$2
rewrite() {
  local f=$1 keep=$SAVE/files/$2
  [ -f "$f" ] || return 0
  if [ -n "$DRY" ]; then
    if ! renamed "$f" | diff -q "$f" - > /dev/null; then
      say "  would rewrite $f:"
      renamed "$f" | diff "$f" - | grep '^[<>]' | sed -E 's/((TOKEN|KEY|SECRET|PASSWORD)[A-Z_]*=).*/\1…/I; s/^/      /' || true
    fi
    return 0
  fi
  mkdir -p "$(dirname "$keep")"
  cp -p "$f" "$keep"
  renamed "$keep" > "$f.kunumy-new"
  chmod --reference="$keep" "$f.kunumy-new"
  mv "$f.kunumy-new" "$f"
  cmp -s "$keep" "$f" || say "  rewrote $f"
}

# unit file $1 (from ki's Service.ts, or a drop-in) as the new program's
unit_text() {
  renamed "$1" | sed -E "s#^ExecStart=\"[^\"]*/ki\"#ExecStart=\"$H/.local/bin/kny\"#;
    s#^\\# ki-made: \`ki (serve|device) -d\` wrote this unit, and writes it again; \`ki (serve|device) stop\` removes it\\.#\\# kny-made: \`kny \\1 -d\` wrote this unit, and writes it again; \`kny \\2 stop\` removes it.#;
    s#^Description=Ki server \\(ki serve\\)#Description=Kunumy server (kny serve)#;
    s#^Description=Ki device \\(ki device\\)#Description=Kunumy device (kny device)#;
    s#^Description=(Ki|Unii|UniiChat|unii) dedicated#Description=Kunumy dedicated#"
}

forward() {
  local o n src
  BIN=${BIN:-$(cd "$(dirname "$0")/.." && pwd)/kny}
  [ -d "$H/.ki" ] && [ ! -L "$H/.ki" ] || die "no ~/.ki folder to move (or it is a link already)"
  for m in "${MOVES[@]}"; do
    o=${m%|*} n=${m#*|}
    [ ! -e "$n" ] && [ ! -L "$n" ] || [ "$(readlink "$n")" = "$o" ] || die "$n exists already: nothing was changed"
  done
  [ ! -e "$SAVE" ] || die "$SAVE exists (an earlier migration's): move it away first; nothing was changed"
  [ -x "$BIN" ] || die "no kny program at $BIN: build it (bun run build) or give --bin FILE"
  "$BIN" version | grep -q '^kny ' || die "$BIN doesn't say it is kny"
  command -v systemctl > /dev/null || die "systemctl isn't here: this moves systemd user services"
  local pid
  pid=$(cat "$H/.ki/server.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ! active ki-serve; then
    die "a ki server runs on ~/.ki outside the ki-serve service (pid $pid): stop it first; nothing was changed"
  fi

  say "== moving ki to Kunumy${DRY:+ (dry run: nothing changes)}"
  say "-- the services"
  for s in "${SERVICES[@]}"; do
    o=${s%|*}
    if active "$o"; then do_ systemctl --user stop "$o"; fi
  done

  [ -n "$DRY" ] || { mkdir -p "$SAVE/units" "$SAVE/files"; chmod 700 "$SAVE"; }
  say "-- the folders (each old path left as a link to the new)"
  for m in "${MOVES[@]}"; do
    o=${m%|*} n=${m#*|}
    [ -d "$o" ] && [ ! -L "$o" ] || continue
    # a link a rollback left
    [ ! -L "$n" ] || do_ rm "$n"
    do_ mv "$o" "$n"
    do_ ln -s "$n" "$o"
  done
  for end in "" -wal -shm; do
    if [ -n "$DRY" ] && [ -e "$H/.ki/ki.db$end" ]; then
      say "  would: mv $H/.kunumy/ki.db$end $H/.kunumy/kunumy.db$end"
    elif [ -z "$DRY" ] && [ -e "$H/.kunumy/ki.db$end" ]; then
      do_ mv "$H/.kunumy/ki.db$end" "$H/.kunumy/kunumy.db$end"
    fi
  done

  say "-- the settings"
  local data=$H/.kunumy cdir=$CONF/kunumy
  [ -z "$DRY" ] || { data=$H/.ki; cdir=$CONF/ki; }
  rewrite "$data/config.json" data/config.json
  if [ -d "$cdir" ]; then
    for f in "$cdir"/*; do
      [ -f "$f" ] && rewrite "$f" "config/$(basename "$f")"
    done
  fi

  say "-- the program"
  do_ install -D -m 755 "$BIN" "$H/.local/bin/kny"

  say "-- the units"
  for s in "${SERVICES[@]}"; do
    o=${s%|*} n=${s#*|}
    src=$UNITS/$o.service
    [ -f "$src" ] || continue
    [ -n "$DRY" ] || cp -p "$UNITS/$o.service" "$SAVE/units/"
    if enabled "$o"; then
      [ -n "$DRY" ] || echo "$o" >> "$SAVE/enabled"
      do_ systemctl --user disable "$o"
    fi
    if [ -n "$DRY" ]; then
      say "  would write $UNITS/$n.service:"; unit_text "$src" | diff "$UNITS/$o.service" - | grep '^[<>]' | sed 's/^/      /' || true
    else
      unit_text "$src" > "$UNITS/$n.service"; say "  wrote $UNITS/$n.service"
    fi
    if [ -d "$UNITS/$o.service.d" ]; then
      [ -n "$DRY" ] || { mkdir -p "$UNITS/$n.service.d"; cp -rp "$UNITS/$o.service.d" "$SAVE/units/"; }
      for f in "$UNITS/$o.service.d"/*; do
        [ -f "$f" ] || continue
        if [ -n "$DRY" ]; then
          say "  would write $UNITS/$n.service.d/$(basename "$f"):"; unit_text "$f" | diff "$f" - | grep '^[<>]' | sed 's/^/      /' || true
        else
          unit_text "$f" > "$UNITS/$n.service.d/$(basename "$f")"; say "  wrote $UNITS/$n.service.d/$(basename "$f")"
        fi
      done
    fi
  done
  do_ systemctl --user daemon-reload
  for s in "${SERVICES[@]}"; do
    o=${s%|*} n=${s#*|}
    if [ -n "$DRY" ] && [ -f "$UNITS/$o.service" ] || [ -f "$UNITS/$n.service" ]; then
      do_ systemctl --user enable --now "$n"
    fi
  done
  [ -n "$DRY" ] || date -u +%FT%TZ > "$SAVE/done"
  say "== done${DRY:+ (dry run)}. Check: kny version; systemctl --user status kny-serve kny-device; open the web app."
  say "   Back: $0 --rollback"
}

back() {
  local o n
  [ -d "$SAVE" ] || die "no $SAVE: nothing to roll back"
  say "== moving Kunumy back to ki${DRY:+ (dry run: nothing changes)}"
  say "-- the services"
  for s in "${SERVICES[@]}"; do
    n=${s#*|}
    if active "$n"; then do_ systemctl --user stop "$n"; fi
    if enabled "$n"; then do_ systemctl --user disable "$n"; fi
    [ ! -e "$UNITS/$n.service" ] || do_ rm "$UNITS/$n.service"
    [ ! -d "$UNITS/$n.service.d" ] || do_ rm -r "$UNITS/$n.service.d"
  done

  say "-- the folders (each new path left as a link to the old, for what ran meanwhile)"
  [ ! -e "$H/.kunumy/kunumy.db" ] || for end in "" -wal -shm; do
    [ ! -e "$H/.kunumy/kunumy.db$end" ] || do_ mv "$H/.kunumy/kunumy.db$end" "$H/.kunumy/ki.db$end"
  done
  for m in "${MOVES[@]}"; do
    o=${m%|*} n=${m#*|}
    [ -L "$o" ] && [ -d "$n" ] && [ ! -L "$n" ] || continue
    do_ rm "$o"
    do_ mv "$n" "$o"
    do_ ln -s "$o" "$n"
  done

  say "-- the settings, as they were before"
  [ ! -f "$SAVE/files/data/config.json" ] || do_ cp -p "$SAVE/files/data/config.json" "$H/.ki/config.json"
  if [ -d "$SAVE/files/config" ]; then
    for f in "$SAVE/files/config"/*; do
      [ -f "$f" ] && do_ cp -p "$f" "$CONF/ki/$(basename "$f")"
    done
  fi

  say "-- the units"
  if [ -d "$SAVE/units" ]; then
    for f in "$SAVE/units"/*; do
      [ -e "$f" ] || continue
      [ -e "$UNITS/$(basename "$f")" ] || do_ cp -rp "$f" "$UNITS/"
    done
  fi
  do_ systemctl --user daemon-reload
  if [ -f "$SAVE/enabled" ]; then
    while read -r o; do do_ systemctl --user enable --now "$o"; done < "$SAVE/enabled"
  fi
  [ ! -e "$H/.local/bin/kny" ] || do_ rm "$H/.local/bin/kny"
  do_ mv "$SAVE" "$SAVE.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"
  say "== rolled back${DRY:+ (dry run)}. Check: ki version; systemctl --user status ki-serve ki-device."
}

if [ -n "$BACK" ]; then back; else forward; fi
