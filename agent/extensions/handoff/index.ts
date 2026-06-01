import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import { complete } from "@earendil-works/pi-ai"
import { CustomEditor, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent"
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent"

const HANDOFF_DIR = join(homedir(), ".pi", "handoff")
const HANDOFF_FILE_PATTERN = /^(\d{8}-\d{6})(?:-(.+))?\.md$/i
const MAX_FALLBACK_EXCERPT_CHARS = 6000
const MAX_RELEVANT_FILES = 12
const CONTINUE_WARNING_WIDGET_KEY = "handoff-continue-warning"

const HANDOFF_SUMMARY_SYSTEM_PROMPT = `You create compact but high-signal handoff summaries for Pi coding-agent sessions.

Your goal is to help a brand-new agent session continue seamlessly.

Return EXACTLY this structure and nothing else:
<title>...</title>
<body>
## Goal
- ...

## Relevant Files
- path/to/file.ext — short note

## Constraints & Preferences
- ...

## Progress
### Done
- ...

### In Progress
- ...

### Blocked
- ...

## Key Decisions
- ...

## Critical Context
- ...

## Open Questions
- ...

## Suggested Next Steps
1. ...
</body>

Rules:
- Keep it concise but sufficient to continue work without the old conversation.
- Keep Relevant Files lean; include only files materially needed to continue, usually 3-10 files.
- Format each relevant file bullet exactly as: - path/to/file.ext — 2-5 words
- If no relevant files are known, include a single bullet: - None noted.
- Do not include a top-level # heading inside <body>.
- If a section has little information, include a short bullet like "- None noted." instead of omitting the section.
- Preserve important constraints, decisions, partial progress, blockers, and next actions.
- Do not answer the original task. Only summarize and prepare the handoff.`

type NotificationType = "info" | "warning" | "error"

type HandoffDoc = {
	path: string
	fileName: string
	title: string
	slug: string
	createdAt: string
	cwd?: string
	sessionFile?: string
	sessionName?: string
	content?: string
}

type FileOps = {
	readFiles: string[]
	modifiedFiles: string[]
}

type SummarizeResult = {
	title?: string
	body: string
	conversationText: string
	fileOps: FileOps
	usedFallback: boolean
	errorMessage?: string
}

type Frontmatter = Record<string, string>

type SelectCapableContext = {
	hasUI: boolean
	ui: {
		notify(message: string, type?: NotificationType): void
		select(title: string, items: string[]): Promise<string | undefined>
	}
}

type EditorLike = {
	render(width: number): string[]
	handleInput(data: string): void
	invalidate(): void
	getText(): string
	setText(text: string): void
	onSubmit?: (text: string) => void
	onChange?: (text: string) => void
	addToHistory?(text: string): void
	insertTextAtCursor?(text: string): void
	getExpandedText?(): string
	setAutocompleteProvider?(provider: unknown): void
	borderColor?: (str: string) => string
	setPaddingX?(padding: number): void
	setAutocompleteMaxVisible?(maxVisible: number): void
	focused?: boolean
	wantsKeyRelease?: boolean
	actionHandlers?: Map<string, () => void>
	onEscape?: () => void
	onCtrlD?: () => void
	onPasteImage?: () => void
	onExtensionShortcut?: (data: string) => boolean
	onAction?(action: string, handler: () => void): void
}

class ContinueWarningEditor {
	private readonly base: EditorLike
	private readonly originalOnSubmit?: (text: string) => void
	private readonly originalOnChange?: (text: string) => void
	private readonly fallbackActionHandlers = new Map<string, () => void>()
	private outerOnSubmit?: (text: string) => void
	private outerOnChange?: (text: string) => void

	constructor(base: EditorLike, updateWarning: (text: string) => void) {
		this.base = base
		this.originalOnSubmit = base.onSubmit
		this.originalOnChange = base.onChange

		base.onSubmit = (text) => {
			this.originalOnSubmit?.(text)
			this.outerOnSubmit?.(text)
		}
		base.onChange = (text) => {
			updateWarning(text)
			this.originalOnChange?.(text)
			this.outerOnChange?.(text)
		}
		updateWarning(base.getText())
	}

	get wantsKeyRelease(): boolean | undefined {
		return this.base.wantsKeyRelease
	}

	get actionHandlers(): Map<string, () => void> {
		return this.base.actionHandlers ?? this.fallbackActionHandlers
	}

	get onEscape(): (() => void) | undefined {
		return this.base.onEscape
	}

	set onEscape(handler: (() => void) | undefined) {
		this.base.onEscape = handler
	}

	get onCtrlD(): (() => void) | undefined {
		return this.base.onCtrlD
	}

	set onCtrlD(handler: (() => void) | undefined) {
		this.base.onCtrlD = handler
	}

	get onPasteImage(): (() => void) | undefined {
		return this.base.onPasteImage
	}

	set onPasteImage(handler: (() => void) | undefined) {
		this.base.onPasteImage = handler
	}

	get onExtensionShortcut(): ((data: string) => boolean) | undefined {
		return this.base.onExtensionShortcut
	}

	set onExtensionShortcut(handler: ((data: string) => boolean) | undefined) {
		this.base.onExtensionShortcut = handler
	}

	get focused(): boolean {
		return this.base.focused ?? false
	}

	set focused(value: boolean) {
		this.base.focused = value
	}

	get onSubmit(): ((text: string) => void) | undefined {
		return this.outerOnSubmit
	}

	set onSubmit(handler: ((text: string) => void) | undefined) {
		this.outerOnSubmit = handler
	}

	get onChange(): ((text: string) => void) | undefined {
		return this.outerOnChange
	}

	set onChange(handler: ((text: string) => void) | undefined) {
		this.outerOnChange = handler
	}

	get borderColor(): ((str: string) => string) | undefined {
		return this.base.borderColor
	}

	set borderColor(handler: ((str: string) => string) | undefined) {
		this.base.borderColor = handler
	}

	onAction(action: string, handler: () => void): void {
		if (this.base.onAction) {
			this.base.onAction(action, handler)
			return
		}
		this.actionHandlers.set(action, handler)
	}

	render(width: number): string[] {
		return this.base.render(width)
	}

	handleInput(data: string): void {
		this.base.handleInput(data)
	}

	invalidate(): void {
		this.base.invalidate()
	}

	getText(): string {
		return this.base.getText()
	}

	setText(text: string): void {
		this.base.setText(text)
	}

	addToHistory(text: string): void {
		this.base.addToHistory?.(text)
	}

	insertTextAtCursor(text: string): void {
		this.base.insertTextAtCursor?.(text)
	}

	getExpandedText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText()
	}

	setAutocompleteProvider(provider: unknown): void {
		this.base.setAutocompleteProvider?.(provider)
	}

	setPaddingX(padding: number): void {
		this.base.setPaddingX?.(padding)
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.base.setAutocompleteMaxVisible?.(maxVisible)
	}
}

function formatHandoffLabel(doc: HandoffDoc): string {
	return `${doc.title} — ${doc.fileName}`
}

function filterHandoffDocs(docs: HandoffDoc[], query: string | undefined): HandoffDoc[] {
	const normalizedQuery = normalizeInlineText(query)?.toLowerCase()
	if (!normalizedQuery) return docs

	const slugQuery = slugifyTitle(normalizedQuery)
	return docs.filter((doc) => {
		const title = doc.title.toLowerCase()
		const slug = doc.slug.toLowerCase()
		const fileName = doc.fileName.toLowerCase()
		return (
			title.includes(normalizedQuery) ||
			slug.includes(slugQuery) ||
			fileName.includes(normalizedQuery)
		)
	})
}

function notify(
	ctx: { hasUI: boolean; ui: { notify(message: string, type?: NotificationType): void } },
	message: string,
	type: NotificationType = "info",
): void {
	if (ctx.hasUI) ctx.ui.notify(message, type)
	else console.log(message)
}

function normalizeInlineText(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined
	const normalized = value.replace(/\s+/g, " ").trim()
	return normalized.length > 0 ? normalized : undefined
}

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message.replace(/\s+/g, " ").trim()
	}
	if (typeof error === "string" && error.trim()) {
		return error.replace(/\s+/g, " ").trim()
	}
	return "Unknown error"
}

function slugifyTitle(title: string): string {
	const normalized = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")

	return normalized || "handoff"
}

function prettifySlug(slug: string): string {
	const spaced = slug.replace(/-/g, " ").trim()
	if (!spaced) return "Session handoff"
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatTimestamp(date = new Date()): { stamp: string; iso: string } {
	const pad = (value: number) => String(value).padStart(2, "0")
	const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
	return { stamp, iso: date.toISOString() }
}

function parseStampToIso(stamp: string): string | undefined {
	const match = stamp.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
	if (!match) return undefined

	const [, year, month, day, hour, minute, second] = match
	return new Date(
		Date.UTC(
			Number.parseInt(year ?? "0", 10),
			Number.parseInt(month ?? "1", 10) - 1,
			Number.parseInt(day ?? "1", 10),
			Number.parseInt(hour ?? "0", 10),
			Number.parseInt(minute ?? "0", 10),
			Number.parseInt(second ?? "0", 10),
		),
	).toISOString()
}

function quoteFrontmatter(value: string): string {
	return JSON.stringify(value)
}

function shortenHome(path: string): string {
	const home = homedir()
	if (path === home) return "~"
	if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
	return path
}

function parseHandoffFilename(fileName: string): { stamp: string; slug: string } | undefined {
	const match = fileName.match(HANDOFF_FILE_PATTERN)
	if (!match) return undefined
	const stamp = match[1]
	const slug = match[2] ?? "handoff"
	if (!stamp) return undefined
	return { stamp, slug }
}

function parseFrontmatter(content: string): Frontmatter {
	if (!content.startsWith("---\n")) return {}
	const endIndex = content.indexOf("\n---\n", 4)
	if (endIndex < 0) return {}

	const block = content.slice(4, endIndex)
	const lines = block.split("\n")
	const result: Frontmatter = {}

	for (const line of lines) {
		const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
		if (!match) continue
		const key = match[1]
		const rawValue = (match[2] ?? "").trim()
		if (!key) continue
		if (rawValue.length === 0) {
			result[key] = ""
			continue
		}
		if (rawValue.startsWith("\"") && rawValue.endsWith("\"")) {
			try {
				const parsed = JSON.parse(rawValue)
				result[key] = typeof parsed === "string" ? parsed : rawValue
				continue
			} catch {
				// fall through to raw value
			}
		}
		result[key] = rawValue
	}

	return result
}

function extractTextParts(content: unknown): string[] {
	if (typeof content === "string") return [content]
	if (!Array.isArray(content)) return []

	const textParts: string[] = []
	for (const part of content) {
		if (!part || typeof part !== "object") continue
		const block = part as { type?: string; text?: string }
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text)
		}
	}
	return textParts
}

function inferTitleFromMessages(messages: AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (!message || message.role !== "user") continue
		const text = normalizeInlineText(extractTextParts(message.content).join(" "))
		if (!text) continue
		return text.length > 72 ? `${text.slice(0, 69).trim()}...` : text
	}

	return undefined
}

function extractTaggedBlock(text: string, tag: string): string | undefined {
	const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))
	const value = match?.[1]
	return typeof value === "string" ? value.trim() : undefined
}

function extractTaggedInline(text: string, tag: string): string | undefined {
	return normalizeInlineText(extractTaggedBlock(text, tag))
}

function normalizeHandoffBody(raw: string): string {
	let body = raw.trim()
	body = body.replace(/^<title>[\s\S]*?<\/title>\s*/i, "")
	body = body.replace(/^<body>\s*/i, "").replace(/\s*<\/body>$/i, "").trim()
	body = body.replace(/^#\s+.+?(?:\n{1,2}|$)/, "").trim()
	return body
}

function collectPathsFromTaggedSection(text: string, tag: string): string[] {
	const matches = [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
	const collected: string[] = []

	for (const match of matches) {
		const block = match[1] ?? ""
		for (const line of block.split(/\r?\n/)) {
			const normalized = normalizeInlineText(line)
			if (!normalized) continue
			collected.push(normalized.replace(/^@/, ""))
		}
	}

	return collected
}

function addPath(target: Set<string>, value: unknown): void {
	if (typeof value !== "string") return
	const normalized = normalizeInlineText(value.replace(/^@/, ""))
	if (!normalized) return
	if (normalized === "." || normalized === "./") return
	target.add(normalized)
}

function extractFileOps(messages: AgentMessage[]): FileOps {
	const readFiles = new Set<string>()
	const modifiedFiles = new Set<string>()

	for (const message of messages) {
		if (!message) continue

		if (message.role === "compactionSummary" || message.role === "branchSummary") {
			for (const path of collectPathsFromTaggedSection(message.summary, "read-files")) readFiles.add(path)
			for (const path of collectPathsFromTaggedSection(message.summary, "modified-files")) modifiedFiles.add(path)
			continue
		}

		if (message.role !== "assistant" || !Array.isArray(message.content)) continue

		for (const part of message.content) {
			if (!part || typeof part !== "object") continue
			const block = part as { type?: string; name?: string; arguments?: Record<string, unknown> }
			if (block.type !== "toolCall" || typeof block.name !== "string") continue
			const args = block.arguments ?? {}

			switch (block.name) {
				case "read":
					addPath(readFiles, args.path)
					break
				case "edit":
					addPath(modifiedFiles, args.path)
					break
				case "write":
					addPath(modifiedFiles, args.path)
					break
				case "grep":
					addPath(readFiles, args.path)
					break
				default:
					break
			}
		}
	}

	return {
		readFiles: [...readFiles].sort((a, b) => a.localeCompare(b)),
		modifiedFiles: [...modifiedFiles].sort((a, b) => a.localeCompare(b)),
	}
}

function formatPathsForPrompt(paths: string[]): string {
	if (paths.length === 0) return "- none recorded"
	return paths.map((path) => `- ${path}`).join("\n")
}

function buildRelevantFilesSection(fileOps: FileOps): string {
	const modified = new Set(fileOps.modifiedFiles)
	const read = new Set(fileOps.readFiles)
	const lines: string[] = []

	for (const path of fileOps.modifiedFiles) {
		lines.push(`- ${path} — ${read.has(path) ? "read and modified" : "modified in session"}`)
		if (lines.length >= MAX_RELEVANT_FILES) break
	}

	if (lines.length < MAX_RELEVANT_FILES) {
		for (const path of fileOps.readFiles) {
			if (modified.has(path)) continue
			lines.push(`- ${path} — read in session`)
			if (lines.length >= MAX_RELEVANT_FILES) break
		}
	}

	return ["## Relevant Files", ...(lines.length > 0 ? lines : ["- None noted."])].join("\n")
}

function ensureRelevantFilesSection(body: string, fileOps: FileOps): string {
	const trimmed = body.trim()
	if (!trimmed) return buildRelevantFilesSection(fileOps)
	if (/^##\s+Relevant Files\b/im.test(trimmed)) return trimmed

	const relevantFilesSection = buildRelevantFilesSection(fileOps)
	const lines = trimmed.split("\n")
	const goalIndex = lines.findIndex((line) => /^##\s+Goal\b/i.test(line))

	if (goalIndex < 0) {
		return [relevantFilesSection, trimmed].join("\n\n")
	}

	let insertAt = lines.length
	for (let index = goalIndex + 1; index < lines.length; index++) {
		if (/^##\s+/.test(lines[index] ?? "")) {
			insertAt = index
			break
		}
	}

	const before = lines.slice(0, insertAt).join("\n").trimEnd()
	const after = lines.slice(insertAt).join("\n").trimStart()
	return [before, relevantFilesSection, after].filter((section) => section.length > 0).join("\n\n")
}

function buildSummaryUserPrompt(input: {
	requestedTitle?: string
	conversationText: string
	fileOps: FileOps
	cwd: string
	sessionName?: string
	sessionFile?: string
}): string {
	return [
		"Create a Pi session handoff for a brand-new agent session.",
		"",
		input.requestedTitle
			? `Preferred title (use exactly): ${input.requestedTitle}`
			: "Preferred title: none provided. Choose a short descriptive title (2-6 words).",
		`Working directory: ${input.cwd}`,
		`Session name: ${input.sessionName ?? "(none)"}`,
		`Session file: ${input.sessionFile ?? "(ephemeral or unavailable)"}`,
		"",
		"Use the candidate file lists only as hints. In the final handoff, include only materially relevant files under ## Relevant Files, with a 2-5 word description for each.",
		"",
		"Candidate files read:",
		formatPathsForPrompt(input.fileOps.readFiles),
		"",
		"Candidate files modified:",
		formatPathsForPrompt(input.fileOps.modifiedFiles),
		"",
		"<conversation>",
		input.conversationText,
		"</conversation>",
	].join("\n")
}

function buildFallbackBody(conversationText: string, errorMessage: string | undefined, fileOps: FileOps): string {
	const trimmedConversation = conversationText.trim()
	const excerpt =
		trimmedConversation.length > MAX_FALLBACK_EXCERPT_CHARS
			? `…${trimmedConversation.slice(-MAX_FALLBACK_EXCERPT_CHARS)}`
			: trimmedConversation || "(no conversation text available)"

	return [
		"## Goal",
		"- Continue the task from the previous Pi session.",
		"",
		buildRelevantFilesSection(fileOps),
		"",
		"## Constraints & Preferences",
		"- Preserve prior decisions and continue from the current repository state.",
		"",
		"## Progress",
		"### Done",
		"- A handoff document was created for a fresh session.",
		"",
		"### In Progress",
		"- The exact next action should be reconstructed from the recent conversation excerpt and relevant files.",
		"",
		"### Blocked",
		errorMessage ? `- Automatic summary generation failed: ${errorMessage}` : "- None noted.",
		"",
		"## Key Decisions",
		"- Review the relevant files and recent conversation excerpt before making new changes.",
		"",
		"## Critical Context",
		"- Frontmatter stores the original working directory and session metadata.",
		errorMessage ? `- Summary generation issue: ${errorMessage}` : "- No extra issues noted.",
		"",
		"## Open Questions",
		"- Reconstruct the exact next task from the recent conversation excerpt if it is not obvious.",
		"",
		"## Suggested Next Steps",
		"1. Read the files listed under Relevant Files.",
		"2. Review the recent conversation excerpt in this handoff.",
		"3. Confirm the current objective and continue with the next concrete action.",
		"",
		"## Recent Conversation Excerpt",
		"```text",
		excerpt,
		"```",
	].join("\n")
}

function buildHandoffDocument(input: {
	title: string
	slug: string
	createdAt: string
	cwd: string
	sessionFile?: string
	sessionName?: string
	body: string
	fileOps: FileOps
}): string {
	const frontmatterLines = [
		"---",
		`title: ${quoteFrontmatter(input.title)}`,
		`slug: ${quoteFrontmatter(input.slug)}`,
		`createdAt: ${quoteFrontmatter(input.createdAt)}`,
		`cwd: ${quoteFrontmatter(input.cwd)}`,
	]

	if (input.sessionFile) frontmatterLines.push(`sessionFile: ${quoteFrontmatter(input.sessionFile)}`)
	if (input.sessionName) frontmatterLines.push(`sessionName: ${quoteFrontmatter(input.sessionName)}`)
	frontmatterLines.push("---")

	const body = ensureRelevantFilesSection(input.body, input.fileOps)

	return [
		frontmatterLines.join("\n"),
		"",
		`# ${input.title}`,
		"",
		body,
		"",
	].join("\n")
}

function buildContinuePrompt(doc: HandoffDoc, currentCwd: string): string {
	const cwdNotice =
		doc.cwd && doc.cwd !== currentCwd
			? `Important: this handoff was created in ${doc.cwd}, but the current working directory is ${currentCwd}. Call out this mismatch if it matters.`
			: `The current working directory is ${currentCwd}.`

	return [
		"Continue from this Pi handoff document. Treat it as the authoritative prior-session context unless current repository state clearly contradicts it.",
		"",
		`Handoff title: ${doc.title}`,
		`Handoff file: ${doc.path}`,
		doc.sessionFile ? `Original session file: ${doc.sessionFile}` : "Original session file: (not recorded)",
		doc.cwd ? `Original working directory: ${doc.cwd}` : "Original working directory: (not recorded)",
		`Current working directory: ${currentCwd}`,
		cwdNotice,
		"",
		"<handoff>",
		(doc.content ?? "").trim(),
		"</handoff>",
		"",
		"Reply briefly in this shape:",
		`1. First line: \"Continuing ${doc.title}, ready for instructions.\"`,
		"2. Then, if the handoff suggests concrete next steps, add 3-6 short bullets.",
		"3. Otherwise stop after the first line.",
		"Do not restate the full handoff unless I ask.",
	].join("\n")
}

function buildInjectPrompt(doc: HandoffDoc, currentCwd: string): string {
	const cwdNotice =
		doc.cwd && doc.cwd !== currentCwd
			? `Important: this handoff was created in ${doc.cwd}, but the current working directory is ${currentCwd}. Surface any mismatch if it matters.`
			: `The current working directory is ${currentCwd}.`

	return [
		"A Pi handoff document from another session is being injected into the current session as supplemental context.",
		"Preserve the current conversation state already in this session.",
		"Use the injected handoff to enrich or redirect the current work only if it fits.",
		"If the handoff conflicts with current session context or repository state, call out the conflict explicitly instead of silently choosing one.",
		"",
		`Handoff title: ${doc.title}`,
		`Handoff file: ${doc.path}`,
		doc.sessionFile ? `Original session file: ${doc.sessionFile}` : "Original session file: (not recorded)",
		doc.cwd ? `Original working directory: ${doc.cwd}` : "Original working directory: (not recorded)",
		`Current working directory: ${currentCwd}`,
		cwdNotice,
		"",
		"<handoff>",
		(doc.content ?? "").trim(),
		"</handoff>",
		"",
		"Reply briefly in this shape:",
		`1. First line: \"Injected handoff ${doc.title} into current session, ready for instructions.\"`,
		"2. Then add 2-5 short bullets only if there are important overlaps, conflicts, or suggested next steps.",
		"3. Do not restate the full handoff unless I ask.",
	].join("\n")
}

async function writeUniqueHandoff(content: string, slug: string, stamp: string): Promise<{ path: string; fileName: string }> {
	await mkdir(HANDOFF_DIR, { recursive: true })

	for (let attempt = 0; attempt < 100; attempt++) {
		const suffix = attempt === 0 ? "" : `-${attempt + 1}`
		const fileName = `${stamp}-${slug}${suffix}.md`
		const filePath = join(HANDOFF_DIR, fileName)
		try {
			await writeFile(filePath, content, { encoding: "utf8", flag: "wx" })
			return { path: filePath, fileName }
		} catch (error) {
			const maybeCode = typeof error === "object" && error && "code" in error ? String(error.code) : undefined
			if (maybeCode === "EEXIST") continue
			throw error
		}
	}

	throw new Error("Could not allocate a unique handoff file name")
}

async function loadHandoffDoc(filePath: string, includeContent = true): Promise<HandoffDoc | undefined> {
	const fileName = basename(filePath)
	const parsed = parseHandoffFilename(fileName)
	if (!parsed) return undefined

	const content = await readFile(filePath, "utf8")
	const frontmatter = parseFrontmatter(content)
	const slug = normalizeInlineText(frontmatter.slug) ?? parsed.slug
	const title = normalizeInlineText(frontmatter.title) ?? prettifySlug(slug)
	const createdAt = normalizeInlineText(frontmatter.createdAt) ?? parseStampToIso(parsed.stamp) ?? new Date().toISOString()

	return {
		path: filePath,
		fileName,
		slug,
		title,
		createdAt,
		cwd: normalizeInlineText(frontmatter.cwd),
		sessionFile: normalizeInlineText(frontmatter.sessionFile),
		sessionName: normalizeInlineText(frontmatter.sessionName),
		content: includeContent ? content : undefined,
	}
}

async function listHandoffDocs(): Promise<HandoffDoc[]> {
	await mkdir(HANDOFF_DIR, { recursive: true })
	const entries = await readdir(HANDOFF_DIR)
	const docs = await Promise.all(
		entries
			.filter((entry) => HANDOFF_FILE_PATTERN.test(entry))
			.map(async (entry) => loadHandoffDoc(join(HANDOFF_DIR, entry), false)),
	)

	return docs
		.filter((doc): doc is HandoffDoc => doc !== undefined)
		.sort((left, right) => right.fileName.localeCompare(left.fileName))
}

function scoreHandoff(doc: HandoffDoc, query: string): number {
	const normalizedQuery = slugifyTitle(query)
	if (!normalizedQuery) return 0

	const titleKey = slugifyTitle(doc.title)
	if (doc.slug === normalizedQuery) return 100
	if (titleKey === normalizedQuery) return 95
	if (doc.slug.startsWith(normalizedQuery)) return 90
	if (titleKey.startsWith(normalizedQuery)) return 85
	if (doc.slug.includes(normalizedQuery)) return 80
	if (titleKey.includes(normalizedQuery)) return 75
	return 0
}

async function chooseDocWithUi(ctx: SelectCapableContext, docs: HandoffDoc[], title: string): Promise<HandoffDoc | undefined> {
	if (!ctx.hasUI) return docs[0]
	const labels = docs.map((doc) => formatHandoffLabel(doc))
	const selected = await ctx.ui.select(title, labels)
	if (!selected) return undefined
	const index = labels.indexOf(selected)
	return index >= 0 ? docs[index] : undefined
}

async function getContinueArgumentCompletions(prefix: string) {
	const docs = filterHandoffDocs(await listHandoffDocs(), prefix).slice(0, 20)
	if (docs.length === 0) return null

	return docs.map((doc) => ({
		value: doc.slug,
		label: doc.title,
		description: doc.fileName,
	}))
}

async function showHandoffList(ctx: ExtensionCommandContext, query?: string): Promise<void> {
	const docs = filterHandoffDocs(await listHandoffDocs(), query)
	if (docs.length === 0) {
		const normalizedQuery = normalizeInlineText(query)
		if (normalizedQuery) notify(ctx, `No handoffs matching \"${normalizedQuery}\" found in ${shortenHome(HANDOFF_DIR)}`, "warning")
		else notify(ctx, `No handoff documents found in ${shortenHome(HANDOFF_DIR)}`, "warning")
		return
	}

	if (!ctx.hasUI) {
		const lines = docs.slice(0, 20).map((doc, index) => `${index + 1}. ${doc.title} — ${doc.slug} — ${doc.fileName}`)
		console.log(lines.join("\n"))
		return
	}

	const suggestedCommand = hasMeaningfulSessionContext(ctx) ? "inject-handoff" : "continue"
	const limitedDocs = docs.slice(0, 50)
	const labels = limitedDocs.map((doc) => formatHandoffLabel(doc))
	const selected = await ctx.ui.select("Recent handoffs", labels)
	if (!selected) return
	const index = labels.indexOf(selected)
	const doc = index >= 0 ? limitedDocs[index] : undefined
	if (!doc) return
	ctx.ui.setEditorText(`/${suggestedCommand} ${doc.slug}`)
	notify(ctx, `Prefilled editor with /${suggestedCommand} ${doc.slug}`)
}

async function clearAllHandoffDocs(ctx: ExtensionCommandContext): Promise<void> {
	const docs = await listHandoffDocs()
	if (docs.length === 0) {
		notify(ctx, `No handoff documents found in ${shortenHome(HANDOFF_DIR)}`, "warning")
		return
	}

	if (ctx.hasUI) {
		const choice = await ctx.ui.select(
			"Delete all handoffs?",
			[
				"No, keep all handoff docs",
				`Yes, delete ${docs.length} handoff document(s)`,
			],
		)
		if (choice !== `Yes, delete ${docs.length} handoff document(s)`) {
			notify(ctx, "Cancelled handoff clear.", "info")
			return
		}
	}

	await Promise.all(docs.map((doc) => unlink(doc.path)))
	clearInlineHandoffWarning(ctx)
	notify(ctx, `Deleted ${docs.length} handoff document(s) from ${shortenHome(HANDOFF_DIR)}`)
}

async function resolveHandoffDoc(
	query: string | undefined,
	ctx: SelectCapableContext,
	options?: { explicit?: boolean },
): Promise<HandoffDoc | undefined> {
	const docs = await listHandoffDocs()
	const normalizedQuery = normalizeInlineText(query)
	const explicit = options?.explicit === true

	if (docs.length === 0) {
		if (explicit) notify(ctx, `No handoff documents found in ${shortenHome(HANDOFF_DIR)}`, "warning")
		return undefined
	}

	if (!normalizedQuery) {
		const picked = ctx.hasUI ? await chooseDocWithUi(ctx, docs, "Continue from which handoff?") : docs[0]
		return picked ? await loadHandoffDoc(picked.path, true) : undefined
	}

	const exactSlugMatches = docs.filter((doc) => doc.slug === slugifyTitle(normalizedQuery))
	if (exactSlugMatches.length > 0) {
		return loadHandoffDoc(exactSlugMatches[0].path, true)
	}

	const scored = docs
		.map((doc) => ({ doc, score: scoreHandoff(doc, normalizedQuery) }))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => right.score - left.score || right.doc.fileName.localeCompare(left.doc.fileName))

	if (scored.length === 0) {
		if (explicit) notify(ctx, `No handoff matching \"${normalizedQuery}\" found in ${shortenHome(HANDOFF_DIR)}`, "warning")
		return undefined
	}

	if (scored.length === 1 || !ctx.hasUI || (scored[0]?.score ?? 0) > (scored[1]?.score ?? 0)) {
		return loadHandoffDoc(scored[0].doc.path, true)
	}

	const picked = await chooseDocWithUi(
		ctx,
		scored.map((entry) => entry.doc),
		`Continue from which handoff matching \"${normalizedQuery}\"?`,
	)
	return picked ? await loadHandoffDoc(picked.path, true) : undefined
}

async function summarizeCurrentSession(ctx: ExtensionContext, requestedTitle: string | undefined): Promise<SummarizeResult> {
	const sessionContext = ctx.sessionManager.buildSessionContext()
	const messages = sessionContext.messages
	const fileOps = extractFileOps(messages)
	const conversationText = serializeConversation(convertToLlm(messages))

	if (!ctx.model) {
		return {
			title: requestedTitle,
			body: buildFallbackBody(conversationText, "No model selected", fileOps),
			conversationText,
			fileOps,
			usedFallback: true,
			errorMessage: "No model selected",
		}
	}

	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)
		if (!auth.ok) throw new Error(auth.error)

		const userMessage = {
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: buildSummaryUserPrompt({
						requestedTitle,
						conversationText,
						fileOps,
						cwd: ctx.cwd,
						sessionName: ctx.sessionManager.getSessionName(),
						sessionFile: ctx.sessionManager.getSessionFile(),
					}),
				},
			],
			timestamp: Date.now(),
		}

		const response = await complete(
			ctx.model,
			{ systemPrompt: HANDOFF_SUMMARY_SYSTEM_PROMPT, messages: [userMessage] },
			{
				...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
				...(auth.headers ? { headers: auth.headers } : {}),
				...(ctx.signal ? { signal: ctx.signal } : {}),
			},
		)

		const raw = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim()

		const extractedTitle = requestedTitle ?? extractTaggedInline(raw, "title")
		const extractedBody = normalizeHandoffBody(extractTaggedBlock(raw, "body") ?? raw)

		return {
			title: extractedTitle,
			body: extractedBody.length > 0 ? extractedBody : buildFallbackBody(conversationText, "Empty model response", fileOps),
			conversationText,
			fileOps,
			usedFallback: extractedBody.length === 0,
			errorMessage: extractedBody.length === 0 ? "Empty model response" : undefined,
		}
	} catch (error) {
		const errorMessage = normalizeErrorMessage(error)
		return {
			title: requestedTitle,
			body: buildFallbackBody(conversationText, errorMessage, fileOps),
			conversationText,
			fileOps,
			usedFallback: true,
			errorMessage: errorMessage,
		}
	}
}

async function createHandoff(
	ctx: ExtensionContext,
	requestedTitle: string | undefined,
): Promise<{ doc: HandoffDoc; usedFallback: boolean; errorMessage?: string }> {
	const summary = await summarizeCurrentSession(ctx, requestedTitle)
	const inferredTitle =
		requestedTitle ??
		summary.title ??
		ctx.sessionManager.getSessionName() ??
		inferTitleFromMessages(ctx.sessionManager.buildSessionContext().messages) ??
		"Session handoff"
	const title = normalizeInlineText(inferredTitle) ?? "Session handoff"
	const slug = slugifyTitle(title)
	const sessionFile = ctx.sessionManager.getSessionFile()
	const sessionName = ctx.sessionManager.getSessionName()
	const timestamp = formatTimestamp()

	const content = buildHandoffDocument({
		title,
		slug,
		createdAt: timestamp.iso,
		cwd: ctx.cwd,
		sessionFile,
		sessionName,
		body: summary.body,
		fileOps: summary.fileOps,
	})

	const saved = await writeUniqueHandoff(content, slug, timestamp.stamp)
	const createdAt = timestamp.iso
	const doc: HandoffDoc = {
		path: saved.path,
		fileName: saved.fileName,
		title,
		slug,
		createdAt,
		cwd: ctx.cwd,
		sessionFile,
		sessionName,
		content,
	}

	return {
		doc,
		usedFallback: summary.usedFallback,
		errorMessage: summary.errorMessage,
	}
}

function buildSavedMessage(result: { doc: HandoffDoc; usedFallback: boolean; errorMessage?: string }): string {
	const lines = [
		`Saved handoff: ${shortenHome(result.doc.path)}`,
		`Start a fresh session with /new or restart Pi, then run /continue ${result.doc.slug}`,
	]

	if (result.usedFallback && result.errorMessage) {
		lines.push(`Used fallback handoff summary because automatic summarization failed: ${result.errorMessage}`)
	}

	return lines.join("\n")
}

function hasMeaningfulSessionContext(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.buildSessionContext().messages.length > 0
}

function getInlineHandoffWarningLines(ctx: ExtensionContext, text: string): string[] | undefined {
	if (!ctx.hasUI) return undefined
	const trimmed = text.trimStart()

	if (/^\/handoff-clear(?:\s|$)/.test(trimmed)) {
		return [
			ctx.ui.theme.fg("warning", `⚠ /handoff-clear will delete all handoff docs in ${shortenHome(HANDOFF_DIR)}.`),
			ctx.ui.theme.fg("dim", "This cannot be undone. You will be asked to confirm."),
		]
	}

	if (hasMeaningfulSessionContext(ctx) && /^\/continue(?:\s|$)/.test(trimmed)) {
		return [
			ctx.ui.theme.fg("warning", "⚠ /continue is for resuming into an empty or fresh session."),
			ctx.ui.theme.fg("dim", "Use /inject-handoff to merge this handoff into the current session."),
			ctx.ui.theme.fg("dim", "Use /continue-new for a fresh session created automatically."),
		]
	}

	return undefined
}

function clearInlineHandoffWarning(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return
	ctx.ui.setWidget(CONTINUE_WARNING_WIDGET_KEY, undefined)
}

function showInlineHandoffWarning(ctx: ExtensionContext, lines: string[]): void {
	if (!ctx.hasUI) return
	ctx.ui.setWidget(CONTINUE_WARNING_WIDGET_KEY, lines, { placement: "belowEditor" })
}

function updateContinueWarningWidget(ctx: ExtensionContext, text: string): void {
	if (!ctx.hasUI) return
	const lines = getInlineHandoffWarningLines(ctx, text)
	if (!lines) {
		clearInlineHandoffWarning(ctx)
		return
	}

	showInlineHandoffWarning(ctx, lines)
}

function installContinueWarningEditor(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return
	const previous = ctx.ui.getEditorComponent()
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const base = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings)
		return new ContinueWarningEditor(base as EditorLike, (text) => updateContinueWarningWidget(ctx, text))
	})
	updateContinueWarningWidget(ctx, ctx.ui.getEditorText())
}

async function runContinueCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const doc = await resolveHandoffDoc(args, ctx, { explicit: true })
	if (!doc?.content) return

	pi.setSessionName(doc.title)
	const prompt = buildContinuePrompt(doc, ctx.cwd)

	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt)
		return
	}

	pi.sendUserMessage(prompt, { deliverAs: "followUp" })
	notify(ctx, `Queued continuation from ${shortenHome(doc.path)}`)
}

async function runInjectHandoffCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const doc = await resolveHandoffDoc(args, ctx, { explicit: true })
	if (!doc?.content) return

	const prompt = buildInjectPrompt(doc, ctx.cwd)

	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt)
		return
	}

	pi.sendUserMessage(prompt, { deliverAs: "followUp" })
	notify(ctx, `Queued handoff injection from ${shortenHome(doc.path)}`)
}

async function runContinueNewCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle()
	const doc = await resolveHandoffDoc(args, ctx, { explicit: true })
	if (!doc?.content) return

	const parentSession = ctx.sessionManager.getSessionFile()
	const result = await ctx.newSession({
		...(parentSession ? { parentSession } : {}),
		setup: async (sessionManager) => {
			sessionManager.appendSessionInfo(doc.title)
		},
		withSession: async (replacementCtx) => {
			await replacementCtx.sendUserMessage(buildContinuePrompt(doc, replacementCtx.cwd))
		},
	})

	if (result.cancelled) {
		notify(ctx, "Starting a new session was cancelled.", "warning")
	}
}

export default function handoffExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installContinueWarningEditor(ctx)
	})

	pi.on("input", async (event, ctx) => {
		if (event.source !== "extension") {
			clearInlineHandoffWarning(ctx)
		}
		return { action: "continue" as const }
	})

	pi.on("agent_start", async (_event, ctx) => {
		clearInlineHandoffWarning(ctx)
	})

	pi.registerCommand("handoff", {
		description: "Create a handoff document in ~/.pi/handoff for a fresh session",
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			const normalizedArgs = normalizeInlineText(args)

			await ctx.waitForIdle()
			notify(ctx, "Generating handoff summary...")
			try {
				const result = await createHandoff(ctx, normalizedArgs)
				notify(ctx, buildSavedMessage(result))
			} catch (error) {
				notify(ctx, `Failed to create handoff: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})

	pi.registerCommand("handoff-list", {
		description: "List recent handoff documents and prefill the appropriate continue command",
		getArgumentCompletions: getContinueArgumentCompletions,
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			try {
				await showHandoffList(ctx, args)
			} catch (error) {
				notify(ctx, `Failed to list handoffs: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})

	pi.registerCommand("handoff-clear", {
		description: "Delete all handoff documents from ~/.pi/handoff",
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			if (normalizeInlineText(args)) {
				notify(ctx, "Usage: /handoff-clear", "warning")
				return
			}

			try {
				await clearAllHandoffDocs(ctx)
			} catch (error) {
				notify(ctx, `Failed to clear handoffs: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})

	pi.registerCommand("continue", {
		description: "Continue from a handoff document in ~/.pi/handoff",
		getArgumentCompletions: getContinueArgumentCompletions,
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			if (hasMeaningfulSessionContext(ctx)) {
				const lines = getInlineHandoffWarningLines(ctx, "/continue")
				if (lines) showInlineHandoffWarning(ctx, lines)
				else
					notify(
						ctx,
						"Current session is not empty. /continue is for an empty or fresh session. Use /inject-handoff to merge into this session, or /continue-new for a fresh session created automatically.",
						"warning",
					)
				return
			}

			try {
				await runContinueCommand(pi, args, ctx)
			} catch (error) {
				notify(ctx, `Failed to continue from handoff: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})

	pi.registerCommand("inject-handoff", {
		description: "Inject a handoff document into the current session as supplemental context",
		getArgumentCompletions: getContinueArgumentCompletions,
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			try {
				await runInjectHandoffCommand(pi, args, ctx)
			} catch (error) {
				notify(ctx, `Failed to inject handoff: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})

	pi.registerCommand("continue-new", {
		description: "Start a fresh session and continue from a handoff document in ~/.pi/handoff",
		getArgumentCompletions: getContinueArgumentCompletions,
		handler: async (args, ctx) => {
			clearInlineHandoffWarning(ctx)
			try {
				await runContinueNewCommand(args, ctx)
			} catch (error) {
				notify(ctx, `Failed to continue in a new session: ${normalizeErrorMessage(error)}`, "error")
			}
		},
	})
}

export {
	buildContinuePrompt,
	buildHandoffDocument,
	extractFileOps,
	formatTimestamp,
	parseFrontmatter,
	slugifyTitle,
}
