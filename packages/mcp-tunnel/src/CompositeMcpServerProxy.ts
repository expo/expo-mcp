import { StdioMcpServerProxy } from './StdioMcpServerProxy.js';
import { TunnelMcpServerProxy } from './TunnelMcpServerProxy.js';
import { McpServerProxy } from './types.js';

/**
 * A MCP server proxy that serves MCP capabilities for both `StdioMcpServerProxy` and `TunnelMcpServerProxy`.
 */
export class CompositeMcpServerProxy implements McpServerProxy {
  private readonly stdioProxy: StdioMcpServerProxy;
  private readonly tunnelProxy: TunnelMcpServerProxy;

  constructor({
    tunnelServerUrl,
    projectRoot,
    devServerUrl,
    stdioMcpServerName,
    stdioMcpServerVersion,
  }: {
    tunnelServerUrl: string;
    projectRoot: string;
    devServerUrl: string;
    stdioMcpServerName?: string;
    stdioMcpServerVersion?: string;
  }) {
    this.stdioProxy = new StdioMcpServerProxy({
      mcpServerName: stdioMcpServerName,
      mcpServerVersion: stdioMcpServerVersion,
    });
    this.tunnelProxy = new TunnelMcpServerProxy(tunnelServerUrl, {
      projectRoot,
      devServerUrl,
    });
  }

  registerTool: McpServerProxy['registerTool'] = (name, config, callback) => {
    this.stdioProxy.registerTool(name, config, callback);
    this.tunnelProxy.registerTool(name, config, callback);
  };

  registerPrompt: McpServerProxy['registerPrompt'] = (name, config, callback) => {
    this.stdioProxy.registerPrompt(name, config, callback);
    this.tunnelProxy.registerPrompt(name, config, callback);
  };

  registerResource: McpServerProxy['registerResource'] = (
    name,
    uriOrTemplate,
    config,
    readCallback
  ) => {
    this.stdioProxy.registerResource(name, uriOrTemplate, config, readCallback);
    this.tunnelProxy.registerResource(name, uriOrTemplate, config, readCallback);
  };

  async start(): Promise<void> {
    await Promise.all([this.stdioProxy.start(), this.tunnelProxy.start()]);
  }

  async close(): Promise<void> {
    await Promise.all([this.stdioProxy.close(), this.tunnelProxy.close()]);
  }
}
