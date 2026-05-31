#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROW_RE = re.compile(
    r"^(?P<method>\S+)\s+(?P<class>\S+)\s+(?P<cc>\d+)\s+(?P<coverage>N/A|\d+(?:\.\d+)?%)\s+(?P<crap>N/A|\d+(?:\.\d+)?)$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a viewer-friendly crap4java report")
    parser.add_argument("--input", required=True, help="Raw crap4java output file")
    parser.add_argument("--project-root", required=True, help="Scanned project root")
    parser.add_argument("--report-file", required=True, help="Markdown report output path")
    parser.add_argument("--raw-file", required=True, help="Saved raw output path")
    parser.add_argument("--json-file", required=True, help="JSON summary output path")
    parser.add_argument("--top", type=int, default=10, help="Number of worst offenders to include")
    parser.add_argument("--medium", type=float, default=10.0, help="Medium-risk threshold")
    parser.add_argument("--high", type=float, default=20.0, help="High-risk threshold")
    parser.add_argument("--critical", type=float, default=30.0, help="Critical-risk threshold")
    parser.add_argument("--scan-arg", action="append", default=[], help="Argument forwarded to crap4java")
    return parser.parse_args()


def parse_rows(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        match = ROW_RE.match(line.rstrip())
        if not match:
            continue

        coverage_text = match.group("coverage")
        crap_text = match.group("crap")
        row = {
            "method": match.group("method"),
            "class": match.group("class"),
            "cc": int(match.group("cc")),
            "coverage": None if coverage_text == "N/A" else float(coverage_text[:-1]),
            "crap": None if crap_text == "N/A" else float(crap_text),
        }
        rows.append(row)
    return rows


def fmt_number(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "N/A"
    return f"{value:.{digits}f}"


def fmt_percent(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "N/A"
    return f"{value:.{digits}f}%"


def fmt_share(count: int, total: int) -> str:
    if total <= 0:
        return "0.0%"
    return f"{(count / total) * 100:.1f}%"


def escape_md(text: str) -> str:
    return text.replace("|", "\\|")


def scan_selection(scan_args: list[str]) -> str:
    if "--changed" in scan_args:
        return "changed Java files under src/"
    if scan_args:
        return "targeted paths: " + ", ".join(scan_args)
    return "full project scan under src/"


def build_summary(rows: list[dict[str, Any]], medium: float, high: float, critical: float) -> dict[str, Any]:
    scored_rows = [row for row in rows if row["crap"] is not None]
    coverage_rows = [row for row in rows if row["coverage"] is not None]
    low_coverage_rows = [row for row in coverage_rows if row["coverage"] < 50.0]

    crap_values = [row["crap"] for row in scored_rows]
    coverage_values = [row["coverage"] for row in coverage_rows]
    cc_values = [row["cc"] for row in rows]

    stats = {
        "totalMethods": len(rows),
        "scoredMethods": len(scored_rows),
        "methodsWithCoverage": len(coverage_rows),
        "methodsMissingCoverage": len(rows) - len(coverage_rows),
        "averageCrap": None if not crap_values else round(statistics.fmean(crap_values), 2),
        "medianCrap": None if not crap_values else round(statistics.median(crap_values), 2),
        "maxCrap": None if not crap_values else round(max(crap_values), 2),
        "averageCoverage": None if not coverage_values else round(statistics.fmean(coverage_values), 2),
        "averageCc": None if not cc_values else round(statistics.fmean(cc_values), 2),
        "lowCoverageUnder50": len(low_coverage_rows),
    }

    critical_rows = [row for row in scored_rows if row["crap"] >= critical]
    high_rows = [row for row in scored_rows if high <= row["crap"] < critical]
    medium_rows = [row for row in scored_rows if medium <= row["crap"] < high]
    low_rows = [row for row in scored_rows if row["crap"] < medium]
    unknown_rows = [row for row in rows if row["crap"] is None]

    buckets = [
        {
            "name": "Critical",
            "rule": f"CRAP >= {critical:g}",
            "count": len(critical_rows),
        },
        {
            "name": "High",
            "rule": f"{high:g} <= CRAP < {critical:g}",
            "count": len(high_rows),
        },
        {
            "name": "Medium",
            "rule": f"{medium:g} <= CRAP < {high:g}",
            "count": len(medium_rows),
        },
        {
            "name": "Low",
            "rule": f"CRAP < {medium:g}",
            "count": len(low_rows),
        },
        {
            "name": "Unknown",
            "rule": "CRAP = N/A",
            "count": len(unknown_rows),
        },
    ]

    return {
        "stats": stats,
        "buckets": buckets,
    }


def top_offenders(rows: list[dict[str, Any]], top_n: int) -> list[dict[str, Any]]:
    sortable = [row for row in rows if row["crap"] is not None]
    sortable.sort(
        key=lambda row: (
            -(row["crap"] or 0.0),
            -row["cc"],
            101.0 if row["coverage"] is None else row["coverage"],
            row["class"],
            row["method"],
        )
    )
    return sortable[:top_n]


def render_markdown(
    *,
    project_root: str,
    report_file: str,
    raw_file: str,
    json_file: str,
    scan_args: list[str],
    thresholds: dict[str, float],
    rows: list[dict[str, Any]],
    summary: dict[str, Any],
    offenders: list[dict[str, Any]],
    raw_text: str,
    top_limit: int,
) -> str:
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    stats = summary["stats"]
    buckets = summary["buckets"]

    lines: list[str] = []
    lines.append("# CRAP Summary Report")
    lines.append("")
    lines.append(f"- Generated: `{generated_at}`")
    lines.append(f"- Project root: `{project_root}`")
    lines.append(f"- Scan selection: {scan_selection(scan_args)}")
    lines.append(f"- Thresholds: medium >= `{thresholds['medium']:g}`, high >= `{thresholds['high']:g}`, critical >= `{thresholds['critical']:g}`")
    lines.append(f"- Markdown report: `{report_file}`")
    lines.append(f"- JSON summary: `{json_file}`")
    lines.append(f"- Raw scanner output: `{raw_file}`")
    lines.append("")
    lines.append("## Overall stats")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("| --- | ---: |")
    lines.append(f"| Parsed methods | {stats['totalMethods']} |")
    lines.append(f"| Methods with numeric CRAP | {stats['scoredMethods']} |")
    lines.append(f"| Methods with coverage | {stats['methodsWithCoverage']} |")
    lines.append(f"| Methods missing coverage | {stats['methodsMissingCoverage']} |")
    lines.append(f"| Average CRAP | {fmt_number(stats['averageCrap'])} |")
    lines.append(f"| Median CRAP | {fmt_number(stats['medianCrap'])} |")
    lines.append(f"| Max CRAP | {fmt_number(stats['maxCrap'])} |")
    lines.append(f"| Average CC | {fmt_number(stats['averageCc'])} |")
    lines.append(f"| Average coverage | {fmt_percent(stats['averageCoverage'])} |")
    lines.append(f"| Methods with coverage < 50% | {stats['lowCoverageUnder50']} |")
    lines.append("")
    lines.append("## Threshold summary")
    lines.append("")
    lines.append("| Bucket | Rule | Count | Share of parsed methods |")
    lines.append("| --- | --- | ---: | ---: |")
    for bucket in buckets:
        lines.append(
            f"| {bucket['name']} | `{bucket['rule']}` | {bucket['count']} | {fmt_share(bucket['count'], stats['totalMethods'])} |"
        )
    lines.append("")
    lines.append(f"## Top {top_limit} worst offenders")
    lines.append("")
    if offenders:
        lines.append("| Rank | CRAP | CC | Cov% | Method | Class |")
        lines.append("| ---: | ---: | ---: | ---: | --- | --- |")
        for index, row in enumerate(offenders, start=1):
            coverage = fmt_percent(row["coverage"])
            lines.append(
                f"| {index} | {fmt_number(row['crap'])} | {row['cc']} | {coverage} | {escape_md(row['method'])} | {escape_md(row['class'])} |"
            )
    else:
        lines.append("No numeric CRAP rows were parsed from the scanner output.")
    lines.append("")

    if not rows:
        lines.append("## Raw scan output")
        lines.append("")
        lines.append("```text")
        lines.append(raw_text.strip() or "(empty output)")
        lines.append("```")
        lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append("- `Unknown` means the scanner reported `N/A` for CRAP, usually because coverage data was unavailable for that row.")
    lines.append("- Lower coverage combined with higher CC tends to make CRAP rise quickly, so prioritize rows that combine all three signals.")
    lines.append("- Open the raw scanner output if you need the complete unfiltered table.")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    args = parse_args()

    if args.top < 1:
        raise SystemExit("--top must be >= 1")
    if not (args.medium < args.high < args.critical):
        raise SystemExit("thresholds must satisfy medium < high < critical")

    raw_path = Path(args.input)
    raw_text = raw_path.read_text(encoding="utf-8")
    rows = parse_rows(raw_text)

    thresholds = {
        "medium": args.medium,
        "high": args.high,
        "critical": args.critical,
    }
    summary = build_summary(rows, args.medium, args.high, args.critical)
    offenders = top_offenders(rows, args.top)

    payload = {
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "projectRoot": args.project_root,
        "scanArgs": args.scan_arg,
        "selection": scan_selection(args.scan_arg),
        "thresholds": thresholds,
        "stats": summary["stats"],
        "buckets": summary["buckets"],
        "topOffenders": offenders,
        "records": rows,
        "reportFile": args.report_file,
        "jsonFile": args.json_file,
        "rawFile": args.raw_file,
    }

    json_path = Path(args.json_file)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    markdown = render_markdown(
        project_root=args.project_root,
        report_file=args.report_file,
        raw_file=args.raw_file,
        json_file=args.json_file,
        scan_args=args.scan_arg,
        thresholds=thresholds,
        rows=rows,
        summary=summary,
        offenders=offenders,
        raw_text=raw_text,
        top_limit=args.top,
    )
    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
