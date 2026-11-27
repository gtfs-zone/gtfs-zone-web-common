#!/bin/sh
# Switches a consumer's node_modules/gtfs-zone-web-common between the pinned
# tag and a symlink to a local checkout. Run from the consumer's root.
#   local [dir]  link to dir (default ../gtfs-zone-web-common)
#   tag          restore the link pnpm installed
#   check        fail while the link is local
set -eu

LINK="node_modules/gtfs-zone-web-common"
SAVED="node_modules/.gtfs-zone-web-common-tag"

if [ ! -f package.json ]; then
  echo "[common-link] run from the consumer's root (no package.json here)" >&2
  exit 1
fi

# The pnpm-installed copy always resolves into node_modules/.pnpm.
is_local() {
  case "$(cd "$LINK" && pwd -P)" in
    */node_modules/.pnpm/*) return 1 ;;
    *) return 0 ;;
  esac
}

case "${1:-}" in
  local)
    dir="${2:-../gtfs-zone-web-common}"
    target="$(cd "$dir" && pwd -P)"
    if [ ! -f "$target/src/ui/app-shell.ts" ]; then
      echo "[common-link] $target is not a gtfs-zone-web-common checkout" >&2
      exit 1
    fi
    if [ ! -L "$LINK" ]; then
      echo "[common-link] $LINK is missing, run pnpm install first" >&2
      exit 1
    fi
    if ! is_local; then
      readlink "$LINK" >"$SAVED"
    fi
    rm "$LINK"
    ln -s "$target" "$LINK"
    echo "[common-link] $LINK -> $target"
    echo "[common-link] restart the dev server; pnpm common:tag restores the tag"
    ;;
  tag)
    if [ -L "$LINK" ] && ! is_local; then
      echo "[common-link] $LINK already points at the pinned tag"
      exit 0
    fi
    if [ ! -f "$SAVED" ]; then
      echo "[common-link] no saved tag link in $SAVED; remove node_modules and run pnpm install" >&2
      exit 1
    fi
    saved="$(cat "$SAVED")"
    if [ ! -d "node_modules/$saved" ]; then
      echo "[common-link] saved target node_modules/$saved is gone; remove node_modules and run pnpm install" >&2
      exit 1
    fi
    rm -f "$LINK"
    ln -s "$saved" "$LINK"
    rm "$SAVED"
    echo "[common-link] $LINK -> $saved"
    echo "[common-link] restart the dev server"
    ;;
  check)
    if is_local; then
      echo "[common-link] $LINK is linked to $(cd "$LINK" && pwd -P); run pnpm common:tag first" >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: common-link.sh local [dir] | tag | check" >&2
    exit 2
    ;;
esac
