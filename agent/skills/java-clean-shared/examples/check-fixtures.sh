#!/usr/bin/env bash
# Structural check for java-clean-* fixtures: every input has an expected file with the
# required sections, and every expected file has an input.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIRS=(
  "$ROOT/java-clean-code/examples"
  "$ROOT/java-clean-solid/examples"
  "$ROOT/java-clean-audit/examples"
)
REQUIRED_HEADINGS=("## Must report" "## May report" "## Must not report")

failed=0
count=0

fail() {
  echo "$*" >&2
  failed=1
}

for dir in "${DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    fail "Missing fixture directory: ${dir#$ROOT/}"
    continue
  fi

  # Inputs are files named <name>.input.<ext> or directories named <name>.input (multi-file fixtures).
  while IFS= read -r -d '' input; do
    name="$(basename "$input")"
    expected="$dir/${name%%.input*}.expected.md"
    count=$((count + 1))
    if [[ ! -f "$expected" ]]; then
      fail "Missing expected file for: ${input#$ROOT/} (expected ${expected#$ROOT/})"
      continue
    fi
    missing_heading=0
    for heading in "${REQUIRED_HEADINGS[@]}"; do
      if ! grep -qxF "$heading" "$expected"; then
        fail "Missing '$heading' in ${expected#$ROOT/}"
        missing_heading=1
      fi
    done
    if [[ "$missing_heading" -eq 0 ]]; then
      echo "OK ${input#$ROOT/} -> ${expected#$ROOT/}"
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 \( -type f -name '*.input.*' -o -type d -name '*.input' \) -print0 | sort -z)

  while IFS= read -r -d '' expected; do
    stem="$(basename "$expected" .expected.md)"
    if ! compgen -G "$dir/$stem.input*" > /dev/null; then
      fail "Expected file without input: ${expected#$ROOT/}"
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type f -name '*.expected.md' -print0 | sort -z)
done

if [[ "$failed" -ne 0 ]]; then
  echo "Fixture check failed." >&2
  exit 1
fi

echo "Fixture check passed: $count input fixture(s)."
