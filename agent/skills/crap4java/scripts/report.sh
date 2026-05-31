#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCAN_SH="$SCRIPT_DIR/scan.sh"
RENDER_PY="$SCRIPT_DIR/render_report.py"

usage() {
	cat <<'EOF'
Usage:
  report.sh <project-root> [options] [--changed]
  report.sh <project-root> [options] [-- <path...>]
  report.sh --help

Runs crap4java, saves raw output, and renders a viewer-friendly Markdown summary
with overall stats, threshold-based buckets, and a top-offenders table.

Options:
  --output-dir <dir>    Directory for generated files.
                        Default: <project-root>/target/crap4java-reports
  --output <file>       Markdown report path. If set, raw/json defaults are
                        derived next to it with .txt and .json extensions.
  --raw-output <file>   Raw scanner output path.
  --json-output <file>  JSON summary output path.
  --top <n>             Number of worst offenders to include. Default: 10
  --medium <n>          Medium-risk CRAP threshold. Default: 10
  --high <n>            High-risk CRAP threshold. Default: 20
  --critical <n>        Critical-risk CRAP threshold. Default: 30
  --changed             Pass through to crap4java for changed-file analysis.
  --                    End report options and pass remaining args to crap4java.

Examples:
  report.sh /path/to/repo
  report.sh /path/to/repo --changed
  report.sh /path/to/repo --output-dir /tmp/crap-reports --top 15
  report.sh /path/to/repo --output repo-crap.md -- module-a src/main/java/com/example/Foo.java
EOF
}

is_number() {
	[[ ${1:-} =~ ^[0-9]+([.][0-9]+)?$ ]]
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" || $# -eq 0 ]]; then
	usage
	exit 0
fi

project_root=$1
shift

if [[ ! -d "$project_root" ]]; then
	echo "project root does not exist: $project_root" >&2
	exit 1
fi

project_root=$(cd "$project_root" && pwd)
output_dir=""
report_file=""
raw_file=""
json_file=""
top_n=10
medium=10
high=20
critical=30
scan_args=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--help|-h)
			usage
			exit 0
			;;
		--output-dir)
			output_dir=$2
			shift 2
			;;
		--output)
			report_file=$2
			shift 2
			;;
		--raw-output)
			raw_file=$2
			shift 2
			;;
		--json-output)
			json_file=$2
			shift 2
			;;
		--top)
			top_n=$2
			shift 2
			;;
		--medium)
			medium=$2
			shift 2
			;;
		--high)
			high=$2
			shift 2
			;;
		--critical)
			critical=$2
			shift 2
			;;
		--changed)
			scan_args+=("$1")
			shift
			;;
		--)
			shift
			scan_args+=("$@")
			break
			;;
		*)
			scan_args+=("$@")
			break
			;;
	esac
done

if ! [[ $top_n =~ ^[0-9]+$ ]] || (( top_n < 1 )); then
	echo "--top must be an integer >= 1" >&2
	exit 1
fi

for value in "$medium" "$high" "$critical"; do
	if ! is_number "$value"; then
		echo "threshold values must be numeric" >&2
		exit 1
	fi
done

scan_label="all"
if [[ ${#scan_args[@]} -gt 0 ]]; then
	for arg in "${scan_args[@]}"; do
		if [[ "$arg" == "--changed" ]]; then
			scan_label="changed"
			break
		fi
	done
fi
if [[ "$scan_label" == "all" && ${#scan_args[@]} -gt 0 ]]; then
	scan_label="targeted"
fi

timestamp=$(date +"%Y%m%d-%H%M%S")

if [[ -n "$report_file" ]]; then
	report_dir=$(dirname "$report_file")
	mkdir -p "$report_dir"
	base_no_ext=${report_file%.*}
	if [[ -z "$raw_file" ]]; then
		raw_file="${base_no_ext}.txt"
	fi
	if [[ -z "$json_file" ]]; then
		json_file="${base_no_ext}.json"
	fi
else
	if [[ -z "$output_dir" ]]; then
		output_dir="$project_root/target/crap4java-reports"
	fi
	mkdir -p "$output_dir"
	base="$output_dir/crap4java-$scan_label-$timestamp"
	report_file="${base}.md"
	if [[ -z "$raw_file" ]]; then
		raw_file="${base}.txt"
	fi
	if [[ -z "$json_file" ]]; then
		json_file="${base}.json"
	fi
fi

mkdir -p "$(dirname "$raw_file")" "$(dirname "$json_file")"

tmp_output=$(mktemp)
cleanup() {
	rm -f "$tmp_output"
}
trap cleanup EXIT

if [[ ${#scan_args[@]} -gt 0 ]]; then
	if "$SCAN_SH" "$project_root" "${scan_args[@]}" >"$tmp_output" 2>&1; then
		scan_exit=0
	else
		scan_exit=$?
	fi
else
	if "$SCAN_SH" "$project_root" >"$tmp_output" 2>&1; then
		scan_exit=0
	else
		scan_exit=$?
	fi
fi

cp "$tmp_output" "$raw_file"

if (( scan_exit != 0 )); then
	echo "crap4java scan failed with exit code $scan_exit" >&2
	echo "saved raw output to: $raw_file" >&2
	cat "$tmp_output" >&2
	exit "$scan_exit"
fi

render_args=(
	--input "$raw_file"
	--project-root "$project_root"
	--report-file "$report_file"
	--raw-file "$raw_file"
	--json-file "$json_file"
	--top "$top_n"
	--medium "$medium"
	--high "$high"
	--critical "$critical"
)
if [[ ${#scan_args[@]} -gt 0 ]]; then
	for arg in "${scan_args[@]}"; do
		render_args+=("--scan-arg=$arg")
	done
fi

python3 "$RENDER_PY" "${render_args[@]}" >"$report_file"
cat "$report_file"
printf '\nSaved files:\n- Report: %s\n- JSON: %s\n- Raw: %s\n' "$report_file" "$json_file" "$raw_file"
