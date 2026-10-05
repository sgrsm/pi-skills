export interface ShellClassificationOptions {
	/** File mutation analysis historically recognizes output redirections only. */
	inputRedirections?: boolean;
}

/** Best-effort lexical command boundaries for ordinary guards, not a Bash interpreter. */
export function splitShellCommands(command: string, options: ShellClassificationOptions = {}): string[][] {
	const inputRedirections = options.inputRedirections ?? true;
	const commands: string[][] = [];
	const hereDocuments: HereDocument[] = [];
	let tokens: string[] = [];
	let current = "";
	let wordStarted = false;
	let quote: "'" | '"' | undefined;

	const flushWord = () => {
		if (!wordStarted) return;
		tokens.push(current);
		current = "";
		wordStarted = false;
	};
	const flushCommand = () => {
		flushWord();
		if (tokens.length > 0) commands.push(tokens);
		tokens = [];
	};

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		const next = command[index + 1];

		if (quote === "'") {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}

		if (char === "\\" && next !== undefined) {
			// Bash removes continuations before forming words, except in single quotes.
			if (next === "\n") {
				index += 1;
				continue;
			}
			if (!quote || next === "$" || next === "`" || next === '"' || next === "\\") {
				current += next;
				wordStarted = true;
				index += 1;
				continue;
			}
		}

		if (quote === '"') {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			wordStarted = true;
			continue;
		}

		if (char === "#" && !wordStarted) {
			// Leave the terminating newline for ordinary command-boundary handling.
			while (index + 1 < command.length && command[index + 1] !== "\n") index += 1;
			continue;
		}

		if (char === "\n" || char === ";") {
			flushCommand();
			if (char === "\n" && hereDocuments.length > 0) {
				index = skipHereDocumentBodies(command, index + 1, hereDocuments) - 1;
				hereDocuments.length = 0;
			}
			continue;
		}

		if (/\s/.test(char)) {
			flushWord();
			continue;
		}

		if (char === "&" && next === ">") {
			flushWord();
			const append = command[index + 2] === ">";
			tokens.push(append ? "&>>" : "&>");
			index += append ? 2 : 1;
			continue;
		}

		if (char === "|" || char === "&") {
			flushCommand();
			if (next === char) index += 1;
			continue;
		}

		// Track here-documents even when preserving file analysis's input tokens.
		if (char === "<" && next === "<") {
			const hereString = command[index + 2] === "<";
			if (!hereString) {
				const hereDocument = readHereDocumentDelimiter(command, index + 2);
				if (hereDocument) hereDocuments.push(hereDocument);
			}
			if (!inputRedirections) {
				current += hereString ? "<<<" : "<<";
				wordStarted = true;
				index += hereString ? 2 : 1;
				continue;
			}
		}

		if (char === ">" || (inputRedirections && char === "<")) {
			flushWord();
			let operator = char;
			const maxLength = inputRedirections ? 3 : 2;
			while (operator.length < maxLength && command[index + 1] === char) {
				operator += char;
				index += 1;
			}
			tokens.push(operator);
			continue;
		}

		current += char;
		wordStarted = true;
	}

	flushCommand();
	return commands;
}

type HereDocument = { delimiter: string; stripTabs: boolean };

function readHereDocumentDelimiter(command: string, start: number): HereDocument | undefined {
	const stripTabs = command[start] === "-";
	let index = start + (stripTabs ? 1 : 0);
	while (command[index] === " " || command[index] === "\t") index += 1;
	if (command[index] === "#") return undefined;
	let delimiter = "";
	let wordStarted = false;
	let quote: "'" | '"' | undefined;
	for (; index < command.length; index += 1) {
		const char = command[index];
		const next = command[index + 1];
		if (quote === "'") {
			if (char === quote) quote = undefined;
			else delimiter += char;
			continue;
		}
		if (char === "\\" && next !== undefined) {
			if (next === "\n") { index += 1; continue; }
			if (!quote || next === "$" || next === "`" || next === '"' || next === "\\") {
				delimiter += next;
				wordStarted = true;
				index += 1;
				continue;
			}
		}
		if (quote === '"') {
			if (char === quote) quote = undefined;
			else delimiter += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			wordStarted = true;
			continue;
		}
		if (/[\s;&|<>()]/.test(char)) break;
		delimiter += char;
		wordStarted = true;
	}
	return wordStarted && !quote ? { delimiter, stripTabs } : undefined;
}

function skipHereDocumentBodies(command: string, start: number, hereDocuments: HereDocument[]): number {
	let index = start;
	for (const { delimiter, stripTabs } of hereDocuments) {
		while (index < command.length) {
			const newline = command.indexOf("\n", index);
			const end = newline < 0 ? command.length : newline;
			const line = command.slice(index, end);
			index = newline < 0 ? command.length : newline + 1;
			if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
		}
	}
	return index;
}
