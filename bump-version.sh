#!/usr/bin/env bash
# Bump the app version everywhere it appears (page header, ?v= cache-busters on
# script/css URLs, and the ES-module import URLs). Every update that changes
# code/markup/styles/api must ship under a new version so browsers drop their
# cached copies.   Usage: ./bump-version.sh [x.y.z]   (default: patch + 1)
set -euo pipefail
cd "$(dirname "$0")"
current=$(grep -o 'app-version">v[0-9.]*' index.html | grep -o '[0-9][0-9.]*$')
if [ -n "${1:-}" ]; then new="$1"; else
  IFS=. read -r a b c <<<"$current"; new="$a.$b.$((c + 1))"
fi
[ "$new" != "$current" ] || { echo "already at $current"; exit 1; }
files=$(grep -lF "$current" index.html js/*.js)
printf '{"version":"%s"}\n' "$new" > version.json
sed -i "s/$(printf '%s' "$current" | sed 's/\./\\./g')/$new/g" $files
echo "bumped $current -> $new in: $(echo $files | tr '\n' ' ')"
