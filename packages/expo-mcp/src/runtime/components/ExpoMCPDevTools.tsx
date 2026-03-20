import React, { useEffect, createContext, useRef, useState } from "react";
import {
  useDevToolsPluginClient,
  type EventSubscription,
} from "expo/devtools";
import { mcpBridge } from "../bridge";
import { registerBuiltinHandlers } from "../builtins";

const PLUGIN_NAME = "expo-mcp-runtime";

/**
 * Context that lets child hooks know the bridge is active.
 * In production builds, this component renders null and the context
 * is never provided, so hooks no-op automatically.
 */
export const MCPBridgeContext = createContext<{ active: boolean }>({
  active: false,
});

export function ExpoMCPDevTools({ children }: { children?: React.ReactNode }) {
  if (!__DEV__) return <>{children}</>;
  return (
    <MCPBridgeContext.Provider value={{ active: true }}>
      <BuiltinRegistration />
      <RuntimeBridge />
      {children}
    </MCPBridgeContext.Provider>
  );
}

/**
 * Registers expo-mcp's built-in handlers (tree, interaction, router)
 * via the bridge plugin system — same mechanism external packages use.
 */
function BuiltinRegistration() {
  useEffect(() => {
    return registerBuiltinHandlers();
  }, []);

  return null;
}

/**
 * Connects to the devtools plugin WebSocket and routes all messages
 * through the mcpBridge handler registry.
 *
 * Handlers are looked up at call time (not capture time) so that
 * when a plugin replaces a handler, the new one is used immediately
 * without needing to re-subscribe.
 */
function RuntimeBridge() {
  const client = useDevToolsPluginClient(PLUGIN_NAME);
  const subscriptionsRef = useRef<EventSubscription[]>([]);
  const [version, setVersion] = useState(0);

  // Re-render when handlers change so we can re-subscribe
  useEffect(() => {
    return mcpBridge.subscribe(() => setVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!client) return;

    // Clean up previous subscriptions
    for (const sub of subscriptionsRef.current) {
      sub?.remove();
    }
    subscriptionsRef.current = [];

    const handlerTypes = mcpBridge.getMessageTypes();
    console.log(
      `[expo-mcp] Runtime bridge connected (${handlerTypes.length} handlers)`,
    );

    // Meta-handler: lets the server discover registered handlers and their metadata
    const metaSub = client.addMessageListener(
      "get_registered_handlers",
      async (data: any) => {
        const requestId = data?.requestId;
        client.sendMessage("response", {
          requestId,
          result: { handlers: mcpBridge.getHandlerInfos() },
        });
      },
    );
    subscriptionsRef.current.push(metaSub);

    for (const messageType of handlerTypes) {
      // Capture messageType but look up handler at call time
      const type = messageType;
      const sub = client.addMessageListener(
        type,
        async (data: any) => {
          const requestId = data?.requestId;
          const handler = mcpBridge.getHandler(type);
          if (!handler) {
            client.sendMessage("response", {
              requestId,
              error: `No handler registered for '${type}'`,
            });
            return;
          }
          try {
            const result = await handler(data ?? {});
            client.sendMessage("response", { requestId, result });
          } catch (error: any) {
            console.warn(
              `[expo-mcp] Handler error for '${type}':`,
              error.message,
            );
            client.sendMessage("response", {
              requestId,
              error: error.message ?? String(error),
            });
          }
        },
      );
      subscriptionsRef.current.push(sub);
    }

    // Signal to the server that all handlers are registered and ready
    client.sendMessage("bridge_ready", {});

    return () => {
      for (const sub of subscriptionsRef.current) {
        sub?.remove();
      }
      subscriptionsRef.current = [];
    };
  }, [client, version]);

  return null;
}
