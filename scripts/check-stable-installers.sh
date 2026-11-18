#!/usr/bin/env bash
# Fail unless <dir> contains exactly the named files and nothing else.
# Usage: check-stable-installers.sh <dir> <name> [name...]
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: check-stable-installers.sh <dir> <name> [name...]" >&2
  exit 1
fi

dir=$1
shift

shopt -s nullglob
paths=("$dir"/*)
names=()
for path in "${paths[@]}"; do
  if [ ! -f "$path" ]; then
    echo "unexpected non-file in $dir: $path" >&2
    exit 1
  fi
  names+=("$(basename "$path")")
done

expected=$(printf '%s\n' "$@" | sort)
if [ "${#names[@]}" -eq 0 ]; then
  actual=""
else
  actual=$(printf '%s\n' "${names[@]}" | sort)
fi

if [ "$expected" != "$actual" ]; then
  echo "installer set mismatch in $dir" >&2
  echo "expected:" >&2
  printf '%s\n' "$expected" >&2
  echo "actual:" >&2
  if [ -n "$actual" ]; then
    printf '%s\n' "$actual" >&2
  else
    echo "(none)" >&2
  fi
  exit 1
fi
