// Child process for clarify-host.test.ts. Do not import this file from other modules.
//
// Drives Pi's actual InteractiveMode through its public root export with a fake `Terminal`, an
// offline in-memory AgentSessionRuntime and the real Clarify extension. Only public package exports
// are used (no `dist/` or private subpath imports, no private members): the live `TUI`, theme and
// keybindings reach us through the public `ctx.ui.custom()` factory arguments, and the clarify tool
// is run through `AgentSession.getToolDefinition()` with the host-supplied extension context.
// Results go to stdout as one JSON line; failures are recorded per scenario, never thrown past it.
import {
	createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, InteractiveMode,
	SessionManager, SettingsManager, VERSION, type ExtensionAPI, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen, TuiMainScreen, visibleWidth, type Component, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import clarifyExtension from "../clarify/index.ts";

// Debug aid: CLARIFY_HOST_TRACE=1 prints scenario/assertion progress to stderr.
type Facts = Record<string, unknown>;
const mode = (process.argv[2] ?? "fullscreen") as "fullscreen" | "regular";
const results: Array<{ name: string; ok: boolean; facts?: Facts; error?: string }> = [];
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
let renderNow = () => {};
/** Wait (bounded, polling event-loop turns) for an observable condition instead of sleeping a fixed time. */
const until = async (condition: () => boolean, label: string, timeoutMs = 3_000) => {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await turn();
		renderNow();
	}
};
/** Let already-resolved promise continuations and queued renders run; used where no condition can be observed. */
const drain = async () => { for (let i = 0; i < 3; i++) await turn(); renderNow(); };
const mouseModes = /\x1b\[\?100[0236][hl]/g;

const size = { columns: 80, rows: 24 };
const writes: string[] = [];
let sendInput: (data: string) => void = () => { throw new Error("terminal not started"); };
let sendResize: () => void = () => {};
const terminal: Terminal = {
	get columns() { return size.columns; }, get rows() { return size.rows; }, kittyProtocolActive: false,
	start(onInput, onResize) { sendInput = onInput; sendResize = onResize; },
	stop() {}, async drainInput() {}, write(data) { writes.push(data); }, moveBy() {},
	hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {},
	clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
};

let hostApi: ExtensionAPI | undefined;
let ctx: ExtensionContext | undefined;
const sessionManager = SessionManager.inMemory();
const createRuntime = async (options: { cwd: string; agentDir: string; sessionManager: SessionManager; sessionStartEvent?: never }) => {
	const services = await createAgentSessionServices({
		cwd: options.cwd, agentDir: options.agentDir, settingsManager: SettingsManager.inMemory(),
		resourceLoaderOptions: {
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [
				(pi: ExtensionAPI) => clarifyExtension(pi, { loadModeState: () => ({ enabled: true }) }),
				(pi: ExtensionAPI) => {
					hostApi = pi;
					pi.registerMessageRenderer("d2-probe", (message) => new Text(String(message.content), 0, 0));
					pi.on("session_start", (_event, context) => { ctx = context; });
				},
			],
		},
	});
	return { ...(await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, sessionStartEvent: options.sessionStartEvent })), services, diagnostics: services.diagnostics };
};

const runtime = await createAgentSessionRuntime(createRuntime as never, {
	cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR!, sessionManager,
});
const interactive = new InteractiveMode(runtime, { terminal, tuiMode: mode, initialThemeSetting: "dark" });
await interactive.init();
await until(() => ctx !== undefined && hostApi !== undefined, "the extension context to be bound by init()");
if (!ctx || !hostApi) throw new Error("extension context was not bound by InteractiveMode.init()");
const hostCtx = ctx;

// Obtain the live TUI through the public custom() factory; completing synchronously never mounts it.
const tui: TUI = await new Promise<TUI>((resolve) => {
	void hostCtx.ui.custom<void>((liveTui, _theme, _keybindings, done) => {
		resolve(liveTui);
		done();
		return { render: () => [], invalidate() {} };
	});
});
if (!(tui instanceof TuiAltScreen || tui instanceof TuiMainScreen)) throw new Error("unexpected renderer class");
const renderer: TuiAltScreen | TuiMainScreen = tui;
const alt = tui instanceof TuiAltScreen ? tui : undefined;
renderNow = () => renderer.renderNow();
const screenText = () => (alt ? alt.getScreenLines().map(stripVTControlCharacters) : []);
const flat = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ");
// Terminal input is dispatched synchronously by the renderer; draining only lets promise continuations run.
const press = async (data: string) => { sendInput(data); renderNow(); await drain(); };
const resize = async (columns: number, rows: number) => { size.columns = columns; size.rows = rows; sendResize(); renderNow(); await drain(); };

// A scrollable transcript so leaks of wheel input into it are observable on screen.
for (let i = 1; i <= 120; i++) hostApi.sendMessage({ customType: "d2-probe", content: `Transcript probe line ${String(i).padStart(3, "0")}`, display: true });
await until(() => alt === undefined || /Transcript probe line 120/.test(flat(screenText())), "the transcript probe messages to render");

const longQuestion = Array.from({ length: 40 }, (_, i) => `Context line ${String(i + 1).padStart(2, "0")}`).join("\n");
const options = [{ label: "First", description: "First description with 界 and emoji 😀. ".repeat(12) }, { label: "Second", description: "Second description" }];
const tool = runtime.session.getToolDefinition("clarify");
if (!tool) throw new Error("clarify tool not registered");
const toolContext = (): Record<string, unknown> => ({ ...hostCtx, tools: [], executeTool: async () => { throw new Error("no nested execution"); } });
type Answer = { details: { answerType: string; selectedIndex?: number; answer?: string | null } };
const live = new Set<AbortController>();
const ask = (controller: AbortController, question = longQuestion, opts: Array<{ label: string; description?: string }> = options, allowCustom = false): Promise<Answer> =>
	(live.add(controller), tool.execute("host-probe", { question, options: opts, allowCustom, customPrompt: "line one\nline two" }, controller.signal, undefined, toolContext() as never) as Promise<Answer>);
const contextStart = () => {
	const match = /Context (\d+)-\d+\/40/.exec(flat(screenText()));
	return match ? Number(match[1]) : undefined;
};
const transcriptRows = (lines = screenText()) => lines.filter((line) => /Transcript probe line/.test(line)).map((line) => line.trim()).join("|");
const mouseWrites = () => writes.join("").match(mouseModes) ?? [];
const focused = () => renderer.getFocusedComponent();
const baselineFocus = focused();
// Selecting text must never reach the real clipboard from this probe: only the on-screen highlight is observed.
alt?.setCopyOnSelect(false);
const searchKey = "\x1b[102;6u"; // tui.altScreen.search (default binding)
const sgr = (button: number, x: number, y: number, release = false) => `\x1b[<${button};${x};${y}${release ? "m" : "M"}`;
const cursorRe = /\x1b\[(\d+);(\d+)H\x1b\[\?25[hl]/g;
/** Zero-based hardware cursor cell of the most recent frame that positioned it. */
const cursor = (): { row: number; col: number } | undefined => {
	for (let i = writes.length - 1; i >= 0; i--) {
		const match = [...writes[i]!.matchAll(cursorRe)].at(-1);
		if (match) return { row: Number(match[1]) - 1, col: Number(match[2]) - 1 };
	}
	return undefined;
};
/** Text the host highlighted as selected on the composited screen (reverse-video runs). */
const highlighted = () => (alt?.getScreenLines() ?? []).flatMap((line) => [...line.matchAll(/\x1b\[7m([\s\S]*?)\x1b\[27m/g)].map((match) => stripVTControlCharacters(match[1]!).trim())).filter(Boolean);
/** Start a clarify call and wait until a dialog took focus from `previous` (the selector, or the editor). */
const open = async (controller: AbortController, question = longQuestion, opts: Array<{ label: string; description?: string }> = options, allowCustom = false) => {
	const previous = focused();
	const result = ask(controller, question, opts, allowCustom);
	await until(() => focused() !== previous, "the dialog to install and take focus");
	return { result, previous };
};
/** From an open selector (custom choice last), pick "Custom instructions" and wait for the answer editor. */
const chooseCustom = async (downs: number) => {
	const previous = focused();
	for (let i = 0; i < downs; i++) await press("\x1b[B");
	await press("\r");
	await until(() => focused() !== previous, "the answer editor to install and take focus");
};

async function scenario(name: string, run: () => Promise<Facts | void>) {
	if (process.env.CLARIFY_HOST_TRACE) console.error(`scenario: ${name}`);
	try {
		let timer: NodeJS.Timeout | undefined;
		const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("scenario timed out")), 8_000); });
		const facts = await Promise.race([run(), deadline]).finally(() => clearTimeout(timer));
		results.push({ name, ok: true, facts: facts ?? undefined });
	} catch (error) {
		results.push({ name, ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
	} finally {
		for (const controller of live) controller.abort(); // a failed scenario must not leak its dialog into the next
		live.clear();
		await drain();
		for (let i = 0; i < 3 && focused() !== baselineFocus; i++) await press("\x1b"); // close any search/overlay left by a failed scenario
		await resize(80, 24);
		const stale = alt !== undefined && / Clarify |Custom instructions/.test(flat(screenText()));
		if (process.env.CLARIFY_HOST_TRACE) console.error(`  leftover Clarify on screen: ${stale}`);
		if (stale) results.push({ name: `${name}: no stale overlay afterwards`, ok: false, error: "a Clarify overlay is still mounted after the scenario settled" });
	}
}
const expect = (condition: unknown, message: string) => {
	if (process.env.CLARIFY_HOST_TRACE) console.error(`  ${condition ? "ok" : "FAIL"}: ${message}`);
	if (!condition) throw new Error(message);
};


// Selector scenarios share one host: repeated interactions are part of the matrix.
await scenario("selection restores focus, editor text and leaves mouse modes alone", async () => {
	hostCtx.ui.setEditorText("draft text");
	const before = mouseWrites().length;
	const { result } = await open(new AbortController());
	expect(/navigate/.test(flat(screenText())) || mode === "regular", "help visible");
	await press("\x1b[B");
	await press("\r");
	const answer = await result; await drain();
	expect(answer.details.answerType === "option" && answer.details.selectedIndex === 2, `unexpected answer ${JSON.stringify(answer.details)}`);
	expect(focused() === baselineFocus, "focus restored to the editor");
	expect(hostCtx.ui.getEditorText() === "draft text", "editor text preserved");
	expect(mouseWrites().length === before, "no mouse-mode toggles written by the interaction");
	return { editorText: hostCtx.ui.getEditorText() };
});

if (mode === "fullscreen") {
	for (const [name, key, initial, direction] of [
		["PageDown", "\x1b[6~", "\x1b[H", 1], ["PageUp", "\x1b[5~", "\x1b[F", -1], ["Home", "\x1b[H", "\x1b[F", -1],
		["End", "\x1b[F", "\x1b[H", 1], ["wheel", "\x1b[<65;10;10M", "\x1b[H", 1],
	] as const) {
		await scenario(`${name} scrolls the question and not the transcript`, async () => {
			const transcriptBeforeOpen = transcriptRows();
			expect(transcriptBeforeOpen.length > 0, "transcript rows visible before the dialog opens");
			const { result } = await open(new AbortController());
			await press(initial);
			const questionBefore = contextStart();
			await press(key);
			const questionAfter = contextStart();
			expect(questionBefore !== undefined && questionAfter !== undefined && direction * (questionAfter - questionBefore) > 0, `question did not move: ${questionBefore} -> ${questionAfter}`);
			await press("\x1b"); await result; await drain();
			// The dialog covers the transcript while open, so compare the rows before open and after close.
			expect(transcriptRows() === transcriptBeforeOpen, "the dialog input scrolled the transcript underneath");
			return { questionBefore, questionAfter };
		});
	}

	await scenario("wheel over the dialog, including at both boundaries, never scrolls the transcript", async () => {
		const transcriptBeforeOpen = transcriptRows();
		expect(transcriptBeforeOpen.length > 0, "transcript rows visible before the dialog opens");
		const { result } = await open(new AbortController());
		for (let i = 0; i < 40; i++) await press("\x1b[<64;40;12M"); // wheel up at the top boundary
		expect(contextStart() === 1, "question at its top");
		await press("\x1b[F");
		const bottom = contextStart();
		for (let i = 0; i < 40; i++) await press("\x1b[<65;40;12M"); // wheel down at the bottom boundary
		expect(contextStart() === bottom, "question stays at its bottom");
		await press("\x1b"); await result; await drain();
		expect(transcriptRows() === transcriptBeforeOpen, "boundary wheel input leaked to the transcript");
		// Control: with no dialog the same wheel input does scroll the transcript.
		await press("\x1b[<64;40;12M");
		expect(transcriptRows() !== transcriptBeforeOpen, "control: wheel scrolls the transcript when no dialog is open");
	});

	await scenario("resizes re-budget the real overlay and stay inside the terminal", async () => {
		const { result } = await open(new AbortController());
		const sizes: Array<[number, number]> = [[80, 24], [80, 12], [40, 12], [30, 8], [20, 5], [80, 3], [80, 24]];
		const observed: Facts = {};
		for (const [columns, rows] of sizes) {
			await resize(columns, rows);
			const lines = screenText();
			expect(lines.length === rows, `${columns}x${rows}: composed screen has ${lines.length} rows`);
			const widest = Math.max(...lines.map((line) => visibleWidth(line)));
			expect(widest <= columns, `${columns}x${rows}: widest composed line is ${widest} columns`);
			expect(columns < 8 || /→/.test(flat(lines)), `${columns}x${rows}: selected option visible`);
			// Footer: the navigation help is the dialog's trailing content (it may wrap, and a border may follow) and is only shed on very short screens.
			const occupied = lines.filter((line) => line.trim());
			const helpAt = occupied.findIndex((line) => /navigate/.test(line));
			if (rows >= 5) expect(helpAt >= 0 && occupied.length - helpAt <= 5, `${columns}x${rows}: help footer closes the dialog: ${JSON.stringify(occupied.slice(-6))}`);
			observed[`${columns}x${rows}`] = helpAt < 0 ? "no help" : occupied.length - helpAt;
		}
		expect(/Esc cancel/.test(flat(screenText())), "full help (Esc cancel) visible again after growing back");
		await press("\x1b"); await result;
		return observed;
	});

	await scenario("abort with transcript search above removes only the clarify overlay", async () => {
		const controller = new AbortController();
		const { result, previous } = await open(controller);
		const selectorFocus = focused();
		await press(searchKey);
		const searchFocus = focused();
		expect(searchFocus !== selectorFocus && searchFocus !== baselineFocus && searchFocus !== previous, "search must be above the selector");
		controller.abort();
		expect((await result).details.answerType === "cancelled", "cancelled result");
		await drain();
		expect(focused() === searchFocus, "search keeps focus after the owned overlay is removed");
		await press("\x1b"); // close search
		expect(focused() === baselineFocus, "focus returns to the editor after search closes");
		expect(!/Context line \d+-\d+\/40/.test(flat(screenText())), "no stale clarify overlay left mounted");
	});

	await scenario("search opened first: the selector isolates focus and scroll, and Escape restores the search", async () => {
		const transcriptBefore = transcriptRows();
		await press(searchKey);
		const searchFocus = focused();
		expect(searchFocus !== baselineFocus, "search is open");
		const searchRows = transcriptRows();
		const { result } = await open(new AbortController());
		expect(focused() !== searchFocus, "the newly installed selector takes focus from the search");
		await press("\x1b[H");
		const start = contextStart();
		await press("\x1b[6~");
		expect(start !== undefined && contextStart()! > start, "PageDown reaches the dialog");
		const afterKey = contextStart();
		await press("\x1b[<65;40;12M");
		expect(contextStart()! > afterKey!, "wheel reaches the dialog");
		await press("\x1b[F");
		for (let i = 0; i < 20; i++) await press("\x1b[<65;40;12M"); // bottom boundary
		await press("\x1b");
		expect((await result).details.answerType === "cancelled", "cancelled");
		await drain();
		expect(focused() === searchFocus, "Escape removed only the selector and restored the search");
		expect(transcriptRows() === searchRows, "keys and wheel never moved the transcript beneath the dialog");
		await press("\x1b");
		expect(focused() === baselineFocus, "closing search restores the editor");
		expect(transcriptBefore.length > 0, "transcript probe was visible");
	});

	await scenario("dragging over the selector selects the dialog text, not the transcript beneath it", async () => {
		const { result } = await open(new AbortController(), "Short question about selection", [{ label: "Only" }]);
		const text = screenText();
		const row = text.findIndex((line) => line.includes("Short question about selection"));
		expect(row >= 0 && text.some((line) => /Transcript probe line/.test(line)), "dialog rows and transcript rows are both on screen");
		const col = text[row]!.indexOf("Short");
		await press(sgr(0, col + 1, row + 1));
		await press(sgr(32, col + 14, row + 1));
		await press(sgr(0, col + 14, row + 1, true));
		expect(alt!.hasActiveSelection(), "the host started a text selection");
		const selected = highlighted();
		expect(selected.length === 1 && selected[0]!.startsWith("Short question"), `selection covers the dialog text: ${JSON.stringify(selected)}`);
		expect(!selected.some((line) => /Transcript/.test(line)), "no transcript text selected");
		alt!.resetTextSelection();
		await press("\x1b");
		expect((await result).details.answerType === "cancelled", "the gesture did not complete the dialog; Escape did");
	});
}

await scenario("queued cancellation and FIFO ordering", async () => {
	const first = new AbortController(); const second = new AbortController();
	const { result: firstResult } = await open(first);
	const queued = ask(second);
	await drain();
	second.abort();
	expect((await queued).details.answerType === "cancelled", "queued call cancelled");
	expect(focused() !== baselineFocus, "the displayed selector is still focused");
	const selectorFocus = focused();
	const third = ask(new AbortController());
	await press("\r");
	expect((await firstResult).details.answerType === "option", "first exchange completes first");
	await until(() => focused() !== baselineFocus && focused() !== selectorFocus, "the next queued selector to install");
	await press("\x1b");
	expect((await third).details.answerType === "cancelled", "third escaped");
	await drain();
	expect(focused() === baselineFocus, "focus restored at the end");
});

await scenario("pre-install abort preserves an unrelated overlay below", async () => {
	const unrelated: Component = { render: () => ["Unrelated overlay"], invalidate() {} };
	const handle = tui.showOverlay(unrelated, { anchor: "top-left", width: 20 });
	renderNow();
	const controller = new AbortController();
	const wrapped = { ...hostCtx.ui, custom: ((factory: never, opts: never) => (hostCtx.ui.custom as (f: unknown, o: unknown) => unknown)((liveTui: TUI, theme: unknown, keys: unknown, done: unknown) => {
		const component = (factory as (...args: unknown[]) => Component)(liveTui, theme, keys, done);
		controller.abort(); // after factory return, before host installation
		return component;
	}, opts)) as never };
	const context = { ...toolContext(), ui: wrapped };
	const answer = await (tool.execute("pre-install", { question: "Q?", options: [{ label: "A" }], allowCustom: false }, controller.signal, undefined, context as never) as Promise<Answer>);
	await drain();
	expect(answer.details.answerType === "cancelled", "cancelled");
	expect(handle.getBounds() !== undefined, "unrelated overlay survived");
	expect(focused() === unrelated, "unrelated overlay kept focus");
	handle.hide(); renderNow();
	expect(focused() === baselineFocus, "focus returns to the editor");
});

await scenario("custom answer exchange: overlay selector, then overlay editor, then result", async () => {
	const { result } = await open(new AbortController(), "Pick", [{ label: "First" }], true);
	await chooseCustom(1);
	expect(focused() !== baselineFocus, "the custom-answer editor took over");
	await press("\x1b[200~ pasted\x1b[201~");
	await press("\r"); // submit prefill plus the pasted text
	const answer = await result; await drain();
	expect(answer.details.answerType === "custom" && answer.details.answer === "line one\nline two pasted", `custom answer ${JSON.stringify(answer.details)}`);
	expect(focused() === baselineFocus, "focus restored after the custom answer");
});

await scenario("custom answer: Escape cancels the editor overlay and restores the main editor", async () => {
	hostCtx.ui.setEditorText("keep me");
	const { result } = await open(new AbortController(), "Pick", [{ label: "First" }], true);
	await chooseCustom(1);
	await press("\x1b");
	expect((await result).details.answerType === "cancelled", "cancelled");
	await drain();
	expect(focused() === baselineFocus, "the main editor is focused again");
	expect(hostCtx.ui.getEditorText() === "keep me", "main editor text untouched");
});

if (mode === "fullscreen") {
	await scenario("custom-answer editor abort with search above keeps the search focused", async () => {
		const controller = new AbortController();
		const { result } = await open(controller, "Pick", [{ label: "First" }], true);
		await chooseCustom(1);
		const editorDialogFocus = focused();
		expect(/Custom instructions/.test(flat(screenText())), "the answer editor is displayed");
		await press(searchKey);
		const searchFocus = focused();
		expect(searchFocus !== editorDialogFocus && searchFocus !== baselineFocus, "search is above the editor dialog");
		controller.abort();
		expect((await result).details.answerType === "cancelled", "cancelled");
		await drain();
		expect(focused() === searchFocus, "no stale focus: search keeps the keyboard after the editor is removed");
		expect(!/Custom instructions/.test(flat(screenText())), "only the editor overlay was removed; none is left mounted");
		await press("\x1b");
		expect(focused() === baselineFocus, "closing search restores the main editor");
	});

	await scenario("search opened first: the whole custom-answer exchange ends back on the search", async () => {
		await press(searchKey);
		const searchFocus = focused();
		const focusTrail: unknown[] = [];
		const setFocus = renderer.setFocus.bind(renderer);
		renderer.setFocus = (component) => { focusTrail.push(component); setFocus(component); };
		try {
			const { result } = await open(new AbortController(), "Pick", [{ label: "First" }], true);
			await chooseCustom(1);
			await press("\r");
			expect((await result).details.answerType === "custom", "custom answer completed");
			await drain();
			expect(!focusTrail.includes(baselineFocus), "the main editor never took focus during the exchange");
			expect(focused() === searchFocus, "focus returned to the search that was open before the exchange");
		} finally { renderer.setFocus = setFocus; }
		await press("\x1b");
		expect(focused() === baselineFocus, "closing search restores the editor");
	});

	await scenario("answer editor overlay: bounds, hardware cursor, footer and paste at real terminal sizes", async () => {
		const { result } = await open(new AbortController(), longQuestion, [{ label: "First" }], true);
		await chooseCustom(1);
		await press("\x1b[200~ pasted\x1b[201~");
		const observed: Facts = {};
		const sizes: Array<[number, number]> = [[80, 24], [80, 14], [40, 10], [30, 8], [20, 5], [12, 4], [8, 3], [80, 24]];
		for (const [columns, rows] of sizes) {
			await resize(columns, rows);
			const lines = screenText();
			expect(lines.length === rows, `${columns}x${rows}: composed screen has ${lines.length} rows`);
			expect(Math.max(...lines.map((line) => visibleWidth(line))) <= columns, `${columns}x${rows}: no line wider than the terminal`);
			const position = cursor();
			expect(position !== undefined && position.row >= 0 && position.row < rows && position.col <= columns, `${columns}x${rows}: hardware cursor ${JSON.stringify(position)} inside the screen`);
			expect(columns < 12 || /pasted/.test(lines[position!.row]!), `${columns}x${rows}: the cursor row shows the text being edited: ${JSON.stringify(lines[position!.row])}`);
			if (rows >= 14 && columns >= 40) {
				expect(/Custom instructions/.test(flat(lines)), `${columns}x${rows}: title visible`);
				expect(/enter submit/i.test(flat(lines)), `${columns}x${rows}: submit footer visible`);
			}
			observed[`${columns}x${rows}`] = JSON.stringify(position);
		}
		await press("\r");
		const answer = await result;
		expect(answer.details.answerType === "custom" && answer.details.answer === "line one\nline two pasted", `answer ${JSON.stringify(answer.details)}`);
		return observed;
	});

	await scenario("answer editor overlay: wheel over it never scrolls the transcript", async () => {
		const transcriptBefore = transcriptRows();
		const { result } = await open(new AbortController(), "Short", [{ label: "First" }], true);
		await chooseCustom(1);
		for (let i = 0; i < 10; i++) { await press("\x1b[<64;40;12M"); await press("\x1b[<65;40;12M"); }
		await press("\x1b");
		expect((await result).details.answerType === "cancelled", "cancelled");
		await drain();
		expect(transcriptRows() === transcriptBefore, "wheel over the answer editor leaked to the transcript");
	});
}

await scenario("session reload/shutdown cancels displayed and queued interactions", async () => {
	const { result: displayed } = await open(new AbortController());
	const queued = ask(new AbortController());
	await drain();
	await runtime.session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
	expect((await displayed).details.answerType === "cancelled" && (await queued).details.answerType === "cancelled", "both cancelled");
	await drain();
	expect(focused() === baselineFocus, "focus restored");
	expect(!/Context line \d+-\d+\/40/.test(flat(screenText())) || mode === "regular", "no stale overlay");
});

const mouseDuringRun = mouseWrites().length;
try { await interactive.stop?.(); } catch { /* best effort */ }
try { await runtime.dispose(); } catch { /* best effort */ }
console.log(JSON.stringify({ version: VERSION, mode, mouseWrites: mouseDuringRun, results }));
process.exit(0);
