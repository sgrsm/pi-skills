import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createMcpConnector } from "../mcp-bridge/mcpConnector.js";

export default async function ideaMcpExtension(pi: ExtensionAPI) {
	await createMcpConnector(pi, {
		connectorName: "idea",
		extensionName: "idea-mcp",
		displayName: "IDEA MCP",
		toggleCommandName: "idea-mcp",
		toolPrefix: "idea_",
		configUrl: new URL("./config.json", import.meta.url),
		clientName: "pi-idea-mcp",
		clientVersion: "1.0.0",
		envPrefix: "PI_IDEA_MCP",
	});
}
