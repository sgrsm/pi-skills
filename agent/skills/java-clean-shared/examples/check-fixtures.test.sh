#!/usr/bin/env bash
# Tests for check-fixtures.sh. Builds throwaway skill trees and checks the exit code and messages.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-fixtures.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=0

expected_body() {
  printf '# Expected\n\n## Must report\n\nNone.\n\n## May report\n\nNone.\n\n## Must not report\n\n- Anything.\n'
}

# Creates a valid tree: one file fixture, one directory fixture, and an empty audit fixture directory.
make_tree() {
  local root="$1"
  mkdir -p "$root/java-clean-shared/examples" "$root/java-clean-code/examples" \
    "$root/java-clean-solid/examples/multi.input/src" "$root/java-clean-audit/examples"
  cp "$SCRIPT" "$root/java-clean-shared/examples/check-fixtures.sh"
  echo 'class A {}' > "$root/java-clean-code/examples/single.input.java"
  expected_body > "$root/java-clean-code/examples/single.expected.md"
  echo 'class B {}' > "$root/java-clean-solid/examples/multi.input/src/B.java"
  expected_body > "$root/java-clean-solid/examples/multi.expected.md"
}

# run_case <name> <expected exit code> <expected output fragment> <setup command>
run_case() {
  local name="$1" want_code="$2" want_text="$3" setup="$4"
  local root="$WORK/$name" output code
  make_tree "$root"
  (cd "$root" && eval "$setup")
  set +e
  output="$("$root/java-clean-shared/examples/check-fixtures.sh" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -ne "$want_code" || "$output" != *"$want_text"* ]]; then
    echo "FAIL $name: exit $code (want $want_code), output:" >&2
    echo "$output" | sed 's/^/  /' >&2
    failures=$((failures + 1))
  else
    echo "PASS $name"
  fi
}

run_case valid-tree 0 "Fixture check passed: 2 input fixture(s)." ":"
run_case missing-expected 1 "Missing expected file for: java-clean-code/examples/single.input.java" \
  "rm java-clean-code/examples/single.expected.md"
run_case missing-heading 1 "Missing '## May report' in java-clean-solid/examples/multi.expected.md" \
  "printf '## Must report\n\n## Must not report\n' > java-clean-solid/examples/multi.expected.md"
run_case orphan-expected 1 "Expected file without input: java-clean-code/examples/stale.expected.md" \
  "expected_body > java-clean-code/examples/stale.expected.md"
run_case missing-directory 1 "Missing fixture directory: java-clean-audit/examples" \
  "rm -r java-clean-audit/examples"

if [[ "$failures" -ne 0 ]]; then
  echo "$failures check-fixtures test(s) failed." >&2
  exit 1
fi
echo "All check-fixtures tests passed."
