import assert from "node:assert/strict";
import test from "node:test";
import { splitShellCommands } from "./shell.ts";

test("ordinary shell classification separates newlines and existing control operators", () => {
	const expected = [["printf", "ready"], ["touch", "/outside/out.txt"]];
	for (const separator of ["\n", ";", "&&", "||", "|", "&", "&&\n", "\n\n"]) {
		assert.deepEqual(splitShellCommands(`\n printf ready ${separator} touch /outside/out.txt\n`), expected, separator);
	}
});

test("quoted or escaped separators and newlines stay in words, including empty quoted words", () => {
	assert.deepEqual(splitShellCommands('printf ";" "&&" "\n" \'\n\' "" \\;'), [
		["printf", ";", "&&", "\n", "\n", "", ";"],
	]);
});

test("line continuations disappear unquoted or double-quoted but stay literal in single quotes", () => {
	assert.deepEqual(splitShellCommands('to\\\nuch /outside/a\\\nb "/outside/c\\\nd" \'/outside/e\\\nf\''), [
		["touch", "/outside/ab", "/outside/cd", "/outside/e\\\nf"],
	]);
	assert.deepEqual(splitShellCommands('touch \\\n /outside/out.txt'), [["touch", "/outside/out.txt"]]);
	assert.deepEqual(splitShellCommands('printf "a\\qb" "a\\\"b" \'a\\qb\''), [["printf", "a\\qb", 'a"b', "a\\qb"]]);
});

test("comments end at newlines while quoted, escaped, and within-word hashes stay literal", () => {
	assert.deepEqual(splitShellCommands("printf hi#tag '#quoted' \\#escaped # /outside/not-an-operand\n# comment\ntouch /outside/out.txt"), [
		["printf", "hi#tag", "#quoted", "#escaped"], ["touch", "/outside/out.txt"],
	]);
});

test("here-document bodies are data, without hiding commands after their delimiters", () => {
	for (const inputRedirections of [false, true]) {
		for (const header of ["cat <<EOF", "cat <<'EOF'", 'cat <<"EOF"', "cat<<EOF", "cat \\<<<EOF"]) {
			const commands = splitShellCommands(`${header}\nrm /outside/data-only\nEOF\ntouch /outside/real.txt`, { inputRedirections });
			assert.equal(commands.length, 2, header);
			assert.deepEqual(commands[1], ["touch", "/outside/real.txt"]);
		}
		const commands = splitShellCommands("cat <<-FIRST <<'END MARKER'\n\tnpm install data-only\n\tFIRST\ngit reset --hard\nEND MARKER\ntouch /outside/real.txt", { inputRedirections });
		assert.equal(commands.length, 2);
		assert.deepEqual(commands[1], ["touch", "/outside/real.txt"]);
		assert.equal(splitShellCommands("cat <<EOF\nrm /outside/data-only", { inputRedirections }).length, 1);
		assert.deepEqual(splitShellCommands("cat <<<word\ntouch /outside/real.txt", { inputRedirections })[1], ["touch", "/outside/real.txt"]);
	}
});

test("shared shell classification retains each analyzer's redirection tokenization", () => {
	assert.deepEqual(splitShellCommands("printf hi>/outside/out >>/outside/append &>/outside/all &>>/outside/all-append"), [
		["printf", "hi", ">", "/outside/out", ">>", "/outside/append", "&>", "/outside/all", "&>>", "/outside/all-append"],
	]);
	assert.deepEqual(splitShellCommands("git reset<input <<here <<<word"), [["git", "reset", "<", "input", "<<", "here", "<<<", "word"]]);
	assert.deepEqual(splitShellCommands("touch /outside/out<input", { inputRedirections: false }), [["touch", "/outside/out<input"]]);
});
