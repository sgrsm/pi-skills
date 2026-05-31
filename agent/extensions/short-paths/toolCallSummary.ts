import { homedir } from "node:os"
import { Box, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"

type ToolArgs = Record<string, unknown> | undefined

type SummaryParts = {
  prefix: string
  rawPath?: string
  suffix?: string
  styledFallback?: string
  stylePath?: (value: string) => string
  formatPath?: (rawPath: string, maxWidth: number) => string
}

type SmartSummaryBox = Box & {
  summaryLine?: SmartSummaryLine
}

type RenderableComponent = {
  render: (width: number) => string[]
  invalidate: () => void
  handleInput?: (data: string) => void
  wantsKeyRelease?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getStringArg(args: ToolArgs, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === "string" ? value : undefined
}

function getNumberArg(args: ToolArgs, key: string): number | undefined {
  const value = args?.[key]
  return typeof value === "number" ? value : undefined
}

function compactValue(value: string, max = 80): string {
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (singleLine.length <= max) return singleLine
  return `${singleLine.slice(0, Math.max(1, max - 1))}…`
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

function formatReadRange(offset?: number, limit?: number): string | undefined {
  if (offset === undefined && limit === undefined) return undefined
  const startLine = offset ?? 1
  const endLine = limit !== undefined ? startLine + limit - 1 : undefined
  return `:${startLine}${endLine !== undefined ? `-${endLine}` : ""}`
}

function stripAtPrefix(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/")
}

function replaceHomeWithTilde(path: string): string {
  const normalizedPath = normalizePathSeparators(path)
  const normalizedHome = normalizePathSeparators(homedir())

  if (normalizedPath === normalizedHome) return "~"
  if (normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`
  }

  return normalizedPath
}

function displayPath(rawPath: string): string {
  return replaceHomeWithTilde(stripAtPrefix(rawPath))
}

type ParsedPath = {
  anchor: string
  parents: string[]
  base: string
}

function formatDisplayPath(anchor: string, segments: string[]): string {
  const body = segments.join("/")

  if (anchor === "/") return body ? `/${body}` : "/"
  if (!anchor) return body
  return body ? `${anchor}/${body}` : anchor
}

function parseDisplayPath(input: string): ParsedPath {
  let path = input
  let anchor = ""

  if (path === "/" || path === "~" || /^[A-Za-z]:$/.test(path)) {
    return { anchor: path, parents: [], base: "" }
  }

  if (path.startsWith("~/")) {
    anchor = "~"
    path = path.slice(2)
  } else if (/^[A-Za-z]:\//.test(path)) {
    anchor = path.slice(0, 2)
    path = path.slice(3)
  } else if (path.startsWith("/")) {
    anchor = "/"
    path = path.replace(/^\/+/, "")
  }

  const hadTrailingSlash = path.length > 0 && path.endsWith("/")
  if (hadTrailingSlash) {
    path = path.slice(0, -1)
  }

  const segments = path ? path.split("/").filter(Boolean) : []
  if (segments.length === 0) {
    return { anchor, parents: [], base: hadTrailingSlash ? "/" : "" }
  }

  const base = hadTrailingSlash ? `${segments[segments.length - 1]}/` : segments[segments.length - 1]!
  return {
    anchor,
    parents: segments.slice(0, -1),
    base,
  }
}

function compactParentSegment(segment: string): string {
  if (segment.length <= 4) return segment

  const delimiter = segment.match(/[-_.]/)?.[0]
  if (delimiter) {
    const first = segment.split(delimiter).find(Boolean) ?? segment
    if (first.length >= 4) return `${first}${delimiter}`
  }

  if (segment.startsWith(".")) {
    return segment.slice(0, Math.min(2, segment.length))
  }

  return segment.slice(0, 1)
}

function minimalParentSegment(segment: string): string {
  if (segment.length <= 2) return segment
  if (segment.startsWith(".")) return segment.slice(0, Math.min(2, segment.length))
  return segment.slice(0, 1)
}

function leftTruncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (visibleWidth(text) <= maxWidth) return text
  if (maxWidth <= 1) return "…"

  const chars = Array.from(text)
  let tail = ""

  for (let index = chars.length - 1; index >= 0; index--) {
    const candidate = `${chars[index]}${tail}`
    if (visibleWidth(`…${candidate}`) > maxWidth) break
    tail = candidate
  }

  return tail ? `…${tail}` : "…"
}

function expandParentsToWidth(anchor: string, originalParents: string[], currentParents: string[], base: string, maxWidth: number): string {
  let best = [...currentParents]

  for (let index = 0; index < originalParents.length; index++) {
    if (best[index] === originalParents[index]) continue

    const next = [...best]
    next[index] = originalParents[index]!

    const candidate = formatDisplayPath(anchor, [...next, base])
    if (visibleWidth(candidate) <= maxWidth) {
      best = next
    }
  }

  return formatDisplayPath(anchor, [...best, base])
}

function fitTailWithEllipsis(
  anchor: string,
  parents: string[],
  base: string,
  maxWidth: number,
  shortenParent: (segment: string) => string,
): string | undefined {
  let tail: string[] = []

  for (let index = parents.length - 1; index >= 0; index--) {
    const nextTail = [shortenParent(parents[index]!), ...tail]
    const candidate = formatDisplayPath(anchor, ["…", ...nextTail, base])
    if (visibleWidth(candidate) <= maxWidth) {
      tail = nextTail
    }
  }

  const candidate = formatDisplayPath(anchor, ["…", ...tail, base])
  if (visibleWidth(candidate) <= maxWidth) return candidate
  return undefined
}

export function smartShortenPath(rawPath: string, maxWidth: number): string {
  const normalized = displayPath(rawPath)

  if (maxWidth <= 0) return ""
  if (visibleWidth(normalized) <= maxWidth) return normalized

  const { anchor, parents, base } = parseDisplayPath(normalized)
  if (!base) return leftTruncateToWidth(normalized, maxWidth)
  if (parents.length === 0) return leftTruncateToWidth(base, maxWidth)

  const compactParents = parents.map(compactParentSegment)
  const compactCandidate = formatDisplayPath(anchor, [...compactParents, base])
  if (visibleWidth(compactCandidate) <= maxWidth) {
    return expandParentsToWidth(anchor, parents, compactParents, base, maxWidth)
  }

  const degradedParents = [...compactParents]
  for (let index = 0; index < degradedParents.length; index++) {
    degradedParents[index] = minimalParentSegment(parents[index]!)
    const candidate = formatDisplayPath(anchor, [...degradedParents, base])
    if (visibleWidth(candidate) <= maxWidth) {
      return expandParentsToWidth(anchor, parents, degradedParents, base, maxWidth)
    }
  }

  const compactTail = fitTailWithEllipsis(anchor, parents, base, maxWidth, compactParentSegment)
  if (compactTail) return compactTail

  const minimalTail = fitTailWithEllipsis(anchor, parents, base, maxWidth, minimalParentSegment)
  if (minimalTail) return minimalTail

  const ellipsisBase = formatDisplayPath(anchor, ["…", base])
  if (visibleWidth(ellipsisBase) <= maxWidth) return ellipsisBase

  return leftTruncateToWidth(base, maxWidth)
}

class SmartSummaryLine {
  private parts: SummaryParts = {
    prefix: "",
    suffix: "",
    styledFallback: "",
    stylePath: (value: string) => value,
    formatPath: (rawPath: string) => displayPath(rawPath),
  }

  setParts(parts: SummaryParts): void {
    this.parts = {
      prefix: parts.prefix,
      rawPath: parts.rawPath,
      suffix: parts.suffix ?? "",
      styledFallback: parts.styledFallback ?? "",
      stylePath: parts.stylePath ?? ((value: string) => value),
      formatPath: parts.formatPath ?? ((rawPath: string) => displayPath(rawPath)),
    }
  }

  render(width: number): string[] {
    if (width <= 0) return [""]

    const prefix = this.parts.prefix
    const suffix = this.parts.suffix ?? ""

    let body = this.parts.styledFallback ?? ""
    if (this.parts.rawPath) {
      const availableForPath = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix))
      const formatPath = this.parts.formatPath ?? ((rawPath: string) => displayPath(rawPath))
      body = (this.parts.stylePath ?? ((value: string) => value))(formatPath(this.parts.rawPath, availableForPath))
    }

    return [truncateToWidth(`${prefix}${body}${suffix}`, width, "…")]
  }

  invalidate(): void {
    // No cached render state.
  }
}

function stripTerminalMarkup(text: string): string {
  return text
    .replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
}

class SmartVisibleCallWrapper {
  inner?: RenderableComponent
  private summaryLine = new SmartSummaryLine()
  private replaceHeader = true

  setInner(inner: RenderableComponent | undefined): void {
    this.inner = inner
  }

  setParts(parts: SummaryParts): void {
    this.summaryLine.setParts(parts)
  }

  setReplaceHeader(replaceHeader: boolean): void {
    this.replaceHeader = replaceHeader
  }

  render(width: number): string[] {
    const summary = this.summaryLine.render(width)[0] ?? ""
    const innerLines = this.inner?.render(width) ?? []
    if (!this.replaceHeader) return innerLines.length > 0 ? innerLines : [summary]
    if (innerLines.length === 0) return [summary]

    let sawNonEmpty = false
    for (let index = 0; index < innerLines.length; index++) {
      const plain = stripTerminalMarkup(innerLines[index] ?? "").trim()
      if (!sawNonEmpty) {
        if (plain.length === 0) continue
        sawNonEmpty = true
        continue
      }

      if (plain.length === 0) {
        return [summary, ...innerLines.slice(index)]
      }
    }

    return [summary]
  }

  handleInput(data: string): void {
    this.inner?.handleInput?.(data)
  }

  get wantsKeyRelease(): boolean {
    return this.inner?.wantsKeyRelease ?? false
  }

  invalidate(): void {
    this.inner?.invalidate?.()
    this.summaryLine.invalidate()
  }
}

function getSelfShellBg(theme: any, isPartial: boolean, isError: boolean): (text: string) => string {
  if (isPartial) return (text: string) => theme.bg("toolPendingBg", text)
  if (isError) return (text: string) => theme.bg("toolErrorBg", text)
  return (text: string) => theme.bg("toolSuccessBg", text)
}

function buildSummaryParts(toolName: string, args: ToolArgs, theme: any, useSmartPaths = true): SummaryParts {
  const rawPath = getStringArg(args, "file_path") ?? getStringArg(args, "path")
  const pathStyle = (value: string) => theme.fg("accent", value)
  const fallback = theme.fg("toolOutput", "...")
  const formatPath = useSmartPaths
    ? smartShortenPath
    : (path: string, _maxWidth: number) => displayPath(path)

  switch (toolName) {
    case "read": {
      let prefix = theme.fg("toolTitle", theme.bold("read")) + " "
      const range = formatReadRange(getNumberArg(args, "offset"), getNumberArg(args, "limit"))
      return {
        prefix,
        rawPath,
        styledFallback: fallback,
        suffix: range ? theme.fg("warning", range) : "",
        stylePath: pathStyle,
        formatPath,
      }
    }

    case "bash": {
      let prefix = theme.fg("toolTitle", theme.bold("$"))
      const command = getStringArg(args, "command")
      if (command) {
        const summary = compactValue(command.split("\n")[0] ?? command, 80)
        prefix += ` ${theme.fg("accent", summary)}`
      }

      const timeout = getNumberArg(args, "timeout")
      const suffix = timeout !== undefined ? theme.fg("muted", ` (timeout ${timeout}s)`) : ""
      return { prefix, suffix }
    }

    case "edit": {
      let suffix = ""
      const edits = Array.isArray(args?.edits)
        ? args.edits.filter((edit) => isRecord(edit)).length
        : typeof args?.oldText === "string" && typeof args?.newText === "string"
          ? 1
          : undefined
      if (edits !== undefined) {
        suffix = theme.fg("muted", ` (${edits} ${pluralize(edits, "edit")})`)
      }
      return {
        prefix: theme.fg("toolTitle", theme.bold("edit")) + " ",
        rawPath,
        styledFallback: fallback,
        suffix,
        stylePath: pathStyle,
        formatPath,
      }
    }

    case "write": {
      let suffix = ""
      const content = getStringArg(args, "content")
      if (content !== undefined) {
        const lineCount = content.length === 0 ? 0 : content.split("\n").length
        const byteCount = Buffer.byteLength(content, "utf8")
        suffix = theme.fg(
          "muted",
          ` (${lineCount} ${pluralize(lineCount, "line")}, ${byteCount} bytes)`,
        )
      }
      return {
        prefix: theme.fg("toolTitle", theme.bold("write")) + " ",
        rawPath,
        styledFallback: fallback,
        suffix,
        stylePath: pathStyle,
        formatPath,
      }
    }

    case "grep": {
      let prefix = theme.fg("toolTitle", theme.bold("grep"))
      const pattern = getStringArg(args, "pattern")
      if (pattern) prefix += ` ${theme.fg("accent", `/${compactValue(pattern, 60)}/`)}`
      prefix += theme.fg("toolOutput", " in ")

      let suffix = ""
      const glob = getStringArg(args, "glob")
      if (glob) suffix += theme.fg("toolOutput", ` (${compactValue(glob, 50)})`)
      const limit = getNumberArg(args, "limit")
      if (limit !== undefined) suffix += theme.fg("toolOutput", ` limit ${limit}`)

      return {
        prefix,
        rawPath: rawPath || ".",
        suffix,
        stylePath: pathStyle,
        formatPath,
      }
    }

    case "find": {
      let prefix = theme.fg("toolTitle", theme.bold("find"))
      const pattern = getStringArg(args, "pattern")
      if (pattern) prefix += ` ${theme.fg("accent", compactValue(pattern, 60))}`
      prefix += theme.fg("toolOutput", " in ")

      const limit = getNumberArg(args, "limit")
      const suffix = limit !== undefined ? theme.fg("toolOutput", ` (limit ${limit})`) : ""

      return {
        prefix,
        rawPath: rawPath || ".",
        suffix,
        stylePath: pathStyle,
        formatPath,
      }
    }

    case "ls": {
      const limit = getNumberArg(args, "limit")
      return {
        prefix: theme.fg("toolTitle", theme.bold("ls")) + " ",
        rawPath: rawPath || ".",
        suffix: limit !== undefined ? theme.fg("toolOutput", ` (limit ${limit})`) : "",
        stylePath: pathStyle,
        formatPath,
      }
    }

    default:
      return { prefix: theme.fg("toolTitle", theme.bold(toolName)) }
  }
}

function getLineComponent(lastComponent: unknown, parts: SummaryParts): SmartSummaryLine {
  const component = lastComponent instanceof SmartSummaryLine ? lastComponent : new SmartSummaryLine()
  component.setParts(parts)
  return component
}

export function renderSmartToolCall(
  toolName: string,
  renderShell: "default" | "self" | undefined,
  args: unknown,
  theme: any,
  context: any,
  useSmartPaths = true,
) {
  const parts = buildSummaryParts(toolName, isRecord(args) ? args : undefined, theme, useSmartPaths)

  if (renderShell === "self") {
    const bg = getSelfShellBg(theme, !!context.isPartial, !!context.isError)
    const box = context.lastComponent instanceof Box ? (context.lastComponent as SmartSummaryBox) : new Box(1, 1, bg)
    box.setBgFn(bg)
    box.clear()

    const line = getLineComponent(box.summaryLine, parts)
    box.summaryLine = line
    box.addChild(line)
    return box
  }

  return getLineComponent(context.lastComponent, parts)
}

export function renderSmartVisibleToolCall(
  toolName: string,
  args: unknown,
  theme: any,
  context: any,
  renderCall?: (args: any, theme: any, context: any) => RenderableComponent,
  fallbackLabel?: string,
  useSmartPaths = true,
) {
  const wrapper = context.lastComponent instanceof SmartVisibleCallWrapper
    ? context.lastComponent
    : new SmartVisibleCallWrapper()

  const innerContext = {
    ...context,
    lastComponent: wrapper.inner,
  }

  const inner = renderCall
    ? renderCall(args, theme, innerContext)
    : new Text(theme.fg("toolTitle", theme.bold(fallbackLabel ?? toolName)), 0, 0)

  wrapper.setInner(inner)
  wrapper.setReplaceHeader(useSmartPaths)
  wrapper.setParts(buildSummaryParts(toolName, isRecord(args) ? args : undefined, theme, useSmartPaths))
  return wrapper
}
