/**
 * The MCP runtime bridge plugin system.
 *
 * Any package can register message handlers that will be routed through
 * the ExpoMCPDevTools WebSocket bridge. This allows packages like
 * expo-semantic-ai to extend the MCP server's capabilities from inside
 * the running app without expo-mcp needing to know about them.
 *
 * Handlers include metadata (title, description, inputSchema as JSON Schema)
 * so the server side can dynamically register corresponding MCP tools.
 *
 * Usage from any package:
 *
 *   const bridge = globalThis.__EXPO_MCP_BRIDGE__;
 *   bridge.registerHandler({
 *     messageType: "get_actions",
 *     title: "Get available actions",
 *     description: "List all AI actions on the current screen",
 *     handler: async () => registry.getActions(),
 *   }, "my-package");
 */

export type MessageHandler = (payload: any) => any | Promise<any>;

export interface HandlerConfig {
  messageType: string;
  handler: MessageHandler;
  /** Title shown in MCP tool listing */
  title?: string;
  /** Description shown in MCP tool listing */
  description?: string;
  /** JSON Schema for the handler's input parameters */
  inputSchema?: Record<string, any>;
}

interface RegisteredHandler extends HandlerConfig {
  source: string;
}

export interface HandlerInfo {
  messageType: string;
  source: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

class MCPBridge {
  private handlers = new Map<string, RegisteredHandler>();
  private listeners = new Set<() => void>();

  /**
   * Register a handler with metadata for MCP tool discovery.
   * Returns an unregister function.
   */
  registerHandler(
    config: HandlerConfig,
    source = "unknown",
  ): () => void {
    const { messageType } = config;

    if (this.handlers.has(messageType)) {
      const existing = this.handlers.get(messageType)!;
      console.warn(
        `[expo-mcp] Handler for '${messageType}' replaced (was: ${existing.source}, now: ${source})`,
      );
    }

    this.handlers.set(messageType, { ...config, source });
    this.notifyListeners();

    return () => {
      const current = this.handlers.get(messageType);
      if (current?.handler === config.handler) {
        this.handlers.delete(messageType);
        this.notifyListeners();
      }
    };
  }

  /**
   * Register multiple handlers at once.
   * Returns a single unregister function that removes all of them.
   */
  registerHandlers(
    handlers: HandlerConfig[],
    source = "unknown",
  ): () => void {
    const unregisters = handlers.map((config) =>
      this.registerHandler(config, source),
    );

    return () => {
      for (const unregister of unregisters) {
        unregister();
      }
    };
  }

  /**
   * Get the handler function for a message type.
   * Used internally by ExpoMCPDevTools to route messages.
   */
  getHandler(messageType: string): MessageHandler | undefined {
    return this.handlers.get(messageType)?.handler;
  }

  /**
   * Get all registered message types.
   * Used internally by ExpoMCPDevTools to set up listeners.
   */
  getMessageTypes(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Get metadata for all registered handlers.
   * Used by the server side to dynamically create MCP tools.
   */
  getHandlerInfos(): HandlerInfo[] {
    return [...this.handlers.values()].map(
      ({ messageType, source, title, description, inputSchema }) => ({
        messageType,
        source,
        title,
        description,
        inputSchema,
      }),
    );
  }

  /**
   * Subscribe to handler registration changes.
   * ExpoMCPDevTools uses this to re-subscribe when new handlers are added.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// Singleton on a global so external packages can find the bridge
// without needing to resolve expo-mcp/runtime as a module import.
// Same pattern as __REACT_DEVTOOLS_GLOBAL_HOOK__.
const GLOBAL_KEY = "__EXPO_MCP_BRIDGE__";

export const mcpBridge: MCPBridge =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new MCPBridge());
