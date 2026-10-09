#!/bin/sh
# Frozen baseline build results seed the private cache; altered inputs still
# receive Go's ordinary content-keyed recompilation and test assertions.
set -eu
case "${HOME:-}" in
  /check/home)
    cache=${GOCACHE:-$HOME/.cache/go-build}
    if [ ! -f "$cache/.dsh-frozen-seed" ]; then
      mkdir -p "$cache"
      cp -a -n /opt/eval/go-build/. "$cache/"
      : > "$cache/.dsh-frozen-seed"
    fi
    ;;
esac
exec /opt/eval/go-real "$@"
