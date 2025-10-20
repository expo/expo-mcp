import {
  McpServer,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { type McpServerProxy } from './types.js';

/**
 * A MCP server proxy that serves MCP capabilities as the stdio server transport.
 */
export class StdioMcpServerProxy implements McpServerProxy {
  private readonly server;
  private readonly transport = new StdioServerTransport();

  constructor({
    mcpServerName = 'Expo MCP Server',
    mcpServerVersion = '1.0.0',
  }: {
    mcpServerName?: string;
    mcpServerVersion?: string;
  }) {
    this.server = new McpServer({
      name: mcpServerName,
      version: mcpServerVersion,
    });
  }

  registerTool: McpServerProxy['registerTool'] = (name, config, callback) => {
    this.server.registerTool(name, config, callback);
  };

  registerPrompt: McpServerProxy['registerPrompt'] = (name, config, callback) => {
    this.server.registerPrompt(name, config, callback);
  };

  registerResource: McpServerProxy['registerResource'] = (
    name,
    uriOrTemplate,
    config,
    readCallback
  ) => {
    if (typeof uriOrTemplate === 'string') {
      this.server.registerResource(
        name,
        uriOrTemplate,
        config,
        readCallback as ReadResourceCallback
      );
    } else {
      this.server.registerResource(
        name,
        uriOrTemplate,
        config,
        readCallback as ReadResourceTemplateCallback
      );
    }
  };

  start(): Promise<void> {
    return this.server.connect(this.transport);
  }

  close(): Promise<void> {
    return this.server.close();
  }
}
