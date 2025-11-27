import { StdioMcpServerProxy } from './StdioMcpServerProxy.js';
import { TunnelMcpServerProxy } from './TunnelMcpServerProxy.js';
import { McpServerProxy } from './types.js';

/**
 * A MCP server proxy that serves MCP capabilities for both `StdioMcpServerProxy` and `TunnelMcpServerProxy`.
 */
export class CompositeMcpServerProxy implements McpServerProxy {
  private readonly _devServerUrl: string;
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
    this._devServerUrl = devServerUrl;
    this.stdioProxy = new StdioMcpServerProxy({
      devServerUrl,
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

  get devServerUrl(): string {
    // To support backward compatibility that mcp-tunnel@~0.1.0 does not pass the devServerUrl to the constructor.
    // We try to get the devServerUrl from the transport.
    // TODO(kudo,20251127): Remove this once mcp-tunnel@~0.1.0 is no longer supported.
    return this._devServerUrl ?? this.tunnelProxy.devServerUrl;
  }
}
