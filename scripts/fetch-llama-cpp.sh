#!/bin/sh
# The llama.cpp checkout under plugins-src/local-llm-plugin/src/android/cpp/llama.cpp
# is ~200MB and deliberately gitignored — run this after a fresh clone of this repo
# (or any time you want to update it) to fetch it.
set -e
cd "$(dirname "$0")/.."

DEST=plugins-src/local-llm-plugin/src/android/cpp/llama.cpp
if [ -d "$DEST" ]; then
  echo "$DEST already exists — remove it first if you want to re-clone." >&2
  exit 1
fi

git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$DEST"
echo "Cloned llama.cpp into $DEST"
