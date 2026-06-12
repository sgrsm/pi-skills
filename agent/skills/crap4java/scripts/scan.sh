#!/usr/bin/env bash
set -euo pipefail

JAR="${CRAP4JAVA_JAR:-/Users/sergey/dev/crap4java/target/crap4java-0.1.0-SNAPSHOT.jar}"
JAVA_BIN="${CRAP4JAVA_JAVA:-java}"

usage() {
	cat <<'EOF'
Usage:
  scan.sh <project-root>
  scan.sh <project-root> --changed
  scan.sh <project-root> <path...>
  scan.sh --help

Runs crap4java from the target project root so Maven-based coverage generation
works correctly. Additional arguments after <project-root> are passed through to
crap4java unchanged.

Examples:
  scan.sh /path/to/repo
  scan.sh /path/to/repo --changed
  scan.sh /path/to/repo module-a src/main/java/com/example/Foo.java

Environment:
  CRAP4JAVA_JAR   Override the default jar location.
  CRAP4JAVA_JAVA  Java 17+ executable used to launch the scanner.
                  Defaults to "java" from PATH.
EOF
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" || $# -eq 0 ]]; then
	usage
	exit 0
fi

project_root=$1
shift

if [[ ! -f "$JAR" ]]; then
	echo "crap4java jar not found: $JAR" >&2
	exit 1
fi

if [[ ! -d "$project_root" ]]; then
	echo "project root does not exist: $project_root" >&2
	exit 1
fi

project_root=$(cd "$project_root" && pwd)
cd "$project_root"

exec "$JAVA_BIN" -jar "$JAR" "$@"
