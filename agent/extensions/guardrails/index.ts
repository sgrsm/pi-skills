import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	PermissionStore,
	analyzeBashMutation,
	buildFileMutationRequest,
	type GuardOperation,
	type PermissionGrant,
	type PermissionRequest,
} from "./permissions.ts";

const STATUS_KEY = "3-guardrails";
const PERMISSION_CHOICES = ["Allow once", "Allow for current session", "Deny", "Custom instructions"];

export default function (pi: ExtensionAPI) {
	const permissions = new PermissionStore();

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx, permissions);
	});

	pi.on("session_shutdown", () => {
		permissions.clear();
	});

	pi.registerCommand("guardrails", {
		description: "Show or clear current outside-cwd permission grants",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "clear") {
				permissions.clear();
				updateStatus(ctx, permissions);
				ctx.ui.notify("Guardrail session permissions cleared.", "info");
				return;
			}

			const grants = permissions.list();
			if (grants.length === 0) {
				ctx.ui.notify("No active guardrail session permissions.", "info");
				return;
			}

			const choice = ctx.hasUI
				? await ctx.ui.select(formatGrants(grants), ["Keep", "Clear all"])
				: undefined;
			if (choice === "Clear all") {
				permissions.clear();
				updateStatus(ctx, permissions);
				ctx.ui.notify("Guardrail session permissions cleared.", "info");
			}
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		const request = requestForToolCall(event, ctx.cwd);
		if (!request) return undefined;

		if (permissions.hasGrant(request)) return undefined;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `${request.summary} requires permission, but this Pi mode has no interactive UI. ${formatTargetScopes(request)}`,
			};
		}

		const choice = await ctx.ui.select(formatPermissionPrompt(request, ctx.cwd), PERMISSION_CHOICES);

		if (choice === "Allow once") {
			ctx.ui.notify("Allowed guarded action once.", "info");
			return undefined;
		}

		if (choice === "Allow for current session") {
			permissions.addSessionGrant(request);
			updateStatus(ctx, permissions);
			ctx.ui.notify("Allowed guarded action for the listed target scope(s) this session.", "info");
			return undefined;
		}

		if (choice === "Custom instructions") {
			const instructions = await ctx.ui.editor(
				"Custom guardrail instructions",
				`The guarded action was not allowed yet. Tell Pi how to proceed instead.\n\nRequested action:\n${formatRequestSummary(request)}\n\nInstructions:\n`,
			);
			const trimmed = instructions?.trim();
			if (trimmed) {
				return { block: true, reason: `Blocked by user. Custom instructions: ${trimmed}` };
			}
			return { block: true, reason: `Blocked by user after choosing custom instructions. ${formatTargetScopes(request)}` };
		}

		return { block: true, reason: `Blocked by user. ${formatTargetScopes(request)}` };
	});
}

function requestForToolCall(event: { toolName: string; input: unknown }, cwd: string): PermissionRequest | undefined {
	const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};

	if (event.toolName === "write" || event.toolName === "edit") {
		const path = input.path;
		return typeof path === "string" ? buildFileMutationRequest(event.toolName, path, cwd) : undefined;
	}

	if (event.toolName === "bash") {
		const command = input.command;
		return typeof command === "string" ? analyzeBashMutation(command, cwd) : undefined;
	}

	return undefined;
}

function updateStatus(
	ctx: { hasUI: boolean; ui: { setStatus(key: string, value: string | undefined): void } },
	permissions: PermissionStore,
): void {
	if (!ctx.hasUI) return;
	const count = permissions.list().length;
	ctx.ui.setStatus(STATUS_KEY, count > 0 ? `guardrails: ${count} grant${count === 1 ? "" : "s"}` : undefined);
}

function formatPermissionPrompt(request: PermissionRequest, cwd: string): string {
	return [
		"Pi wants to perform a guarded mutating action outside the current working directory.",
		"",
		`Working directory: ${cwd}`,
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		...(request.command ? ["", "Command:", indent(truncate(request.command, 1600), "  ")] : []),
		"",
		"Permission target scope(s):",
		...request.targets.flatMap((target) => [
			`- ${operationLabel(target.operation)}: ${target.path}`,
			`  session scope: ${target.scopeDir} and nested paths only`,
			`  reason: ${target.reason}`,
		]),
		"",
		"Choose how to proceed:",
	].join("\n");
}

function formatRequestSummary(request: PermissionRequest): string {
	return [
		`Tool: ${request.toolName}`,
		`Action: ${request.summary}`,
		...(request.command ? [`Command: ${truncate(request.command, 800)}`] : []),
		formatTargetScopes(request),
	].join("\n");
}

function formatTargetScopes(request: PermissionRequest): string {
	return `Target scope(s): ${request.targets
		.map((target) => `${operationLabel(target.operation)} ${target.scopeDir}`)
		.join(", ")}`;
}

function formatGrants(grants: PermissionGrant[]): string {
	return [
		"Active guardrail session permissions:",
		"",
		...grants.map(
			(grant) =>
				`- ${operationLabel(grant.operation)}: ${grant.scopeDir} and nested paths only (granted ${new Date(
					grant.grantedAt,
				).toLocaleTimeString()})`,
		),
		"",
		"Choose an action:",
	].join("\n");
}

function operationLabel(operation: GuardOperation): string {
	switch (operation) {
		case "write":
			return "write";
		case "edit":
			return "edit";
		case "delete":
			return "delete";
		case "bash-mutate":
			return "bash mutation";
	}
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function indent(value: string, prefix: string): string {
	return value
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}
