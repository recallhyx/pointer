#!/usr/bin/env bash
# Copy the single installer matched by a glob to <dest>/<stable-name>.
# Usage: stage-stable-installer.sh <glob> <dest-dir> <stable-name>
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: stage-stable-installer.sh <glob> <dest-dir> <stable-name>" >&2
  exit 1
fi

glob=$1
dest=$2
name=$3

if [ -z "$name" ] || [ "$name" = "." ] || [ "$name" = ".." ] || [[ "$name" == */* ]]; then
  echo "stable installer name must be a single path segment: $name" >&2
  exit 1
fi

shopt -s nullglob
# The caller passes one glob; expanding it here is the point of the script.
files=($glob)
if [ "${#files[@]}" -ne 1 ]; then
  echo "Expected exactly one installer matching $glob, found ${#files[@]}." >&2
  exit 1
fi
if [ ! -f "${files[0]}" ]; then
  echo "installer is not a file: ${files[0]}" >&2
  exit 1
fi

mkdir -p "$dest"
cp "${files[0]}" "$dest/$name"
test -s "$dest/$name"
