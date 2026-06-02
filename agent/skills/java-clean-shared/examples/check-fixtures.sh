#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIRS=(
  "$ROOT/java-clean-code/examples"
  "$ROOT/java-clean-solid/examples"
)

missing=0
count=0

for dir in "${DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    echo "Missing fixture directory: $dir" >&2
    missing=1
    continue
  fi

  while IFS= read -r -d '' input; do
    stem="${input%.*}"
    expected="${stem%.input}.expected.md"
    count=$((count + 1))
    if [[ ! -f "$expected" ]]; then
      echo "Missing expected file for: ${input#$ROOT/}" >&2
      echo "  expected: ${expected#$ROOT/}" >&2
      missing=1
    else
      echo "OK ${input#$ROOT/} -> ${expected#$ROOT/}"
    fi
  done < <(find "$dir" -type f -name '*.input.*' -print0 | sort -z)
done

if [[ "$missing" -ne 0 ]]; then
  echo "Fixture check failed." >&2
  exit 1
fi

echo "Fixture check passed: $count input fixture(s)."
