import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/**
 * Withdraw unavailable tools through the public registration contract, not a
 * subtractive setActiveTools() call that discards unrelated pending restoration.
 * Eligible tools keep their exposure and ordinary extension activation defaults;
 * host CLI allowlists/exclusions still filter the registry on every refresh.
 */
export function registerToolAvailability<TParams extends TSchema, TDetails = unknown, TState = any>(
	pi: ExtensionAPI,
	definition: ToolDefinition<TParams, TDetails, TState>,
	initiallyAvailable: boolean,
): (available: boolean) => void {
	let current: boolean | undefined;
	const setAvailable = (available: boolean): void => {
		if (current === available) return;
		pi.registerTool({
			...definition,
			exposure: available ? (definition.exposure ?? "direct") : "hidden",
			defaultActive: available ? (definition.defaultActive ?? true) : false,
		});
		current = available;
	};
	setAvailable(initiallyAvailable);
	return setAvailable;
}
