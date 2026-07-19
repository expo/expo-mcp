import { type McpServerProxy } from '@expo/mcp-tunnel';

import { McpServerWithFeedback } from './mcp/feedback.js';
import { addMcpPrompts } from './mcp/prompts.js';
import { addMcpTools } from './mcp/tools.js';

/**
 * Adds MCP capabilities to the server.
 * @param server - The MCP server to add capabilities to.
 * @param projectRoot - The project root directory.
 */
export function addMcpCapabilities(server: McpServerProxy, projectRoot: string) {
  const serverWithFeedback = new McpServerWithFeedback(server);
  addMcpTools(serverWithFeedback, projectRoot);
  addMcpPrompts(serverWithFeedback, projectRoot);
}
