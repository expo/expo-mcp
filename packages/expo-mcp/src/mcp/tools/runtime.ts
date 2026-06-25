import { type McpServerProxy } from "@expo/mcp-tunnel";
import { z } from "zod";

import { RuntimeClient } from "../../develop/RuntimeClient.js";

// Mirrors HandlerInfo from runtime/bridge.ts (wire protocol type).
// Can't import directly since runtime/ is React Native code excluded from the server build.
interface HandlerInfo {
  messageType: string;
  source: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

/**
 * Discover handlers registered on the runtime bridge and dynamically
 * create MCP tools for each one. This means any package that registers
 * handlers on the bridge (expo-mcp builtins, expo-semantic-ai, etc.)
 * automatically gets corresponding MCP tools — no hardcoding needed.
 *
 * Waits for the app to send a "bridge_ready" message before discovering,
 * so there's no race condition with component mounting.
 */
export async function discoverAndRegisterRuntimeTools(
  server: McpServerProxy,
  runtimeClient: RuntimeClient,
): Promise<void> {
  if (!runtimeClient.isConnected) return;

  // Wait for the app to signal it's ready
  await runtimeClient.waitForReady();

  try {
    const { handlers } = await runtimeClient.request<{
      handlers: HandlerInfo[];
    }>("get_registered_handlers");

    for (const handler of handlers) {
      const toolName = `runtime:${handler.source}:${handler.messageType}`;
      const inputSchema = jsonSchemaToZod(handler.inputSchema);

      server.registerTool(
        toolName,
        {
          title: handler.title ?? handler.messageType,
          description:
            handler.description ??
            `Runtime bridge handler: ${handler.messageType} (from ${handler.source})`,
          inputSchema,
        },
        async (params) => {
          const result = await runtimeClient.request(
            handler.messageType,
            params,
          );
          return {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
            ],
          };
        },
      );
    }

    console.error(
      `[expo-mcp] Registered ${handlers.length} runtime tools from bridge`,
    );

    // Notify clients that new tools are available so they re-fetch tools/list
    server.sendToolListChanged();
  } catch (err: any) {
    console.error(
      "[expo-mcp] Failed to discover runtime handlers:",
      err.message,
    );
  }
}

/**
 * Convert a JSON Schema object to a Zod schema shape for MCP tool registration.
 */
function jsonSchemaToZod(
  schema?: Record<string, any>,
): Record<string, z.ZodTypeAny> | undefined {
  if (!schema?.properties) return undefined;

  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set<string>(schema.required ?? []);

  for (const [key, prop] of Object.entries<any>(schema.properties)) {
    let field: z.ZodTypeAny;

    switch (prop.type) {
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "object":
        field = z.record(z.any());
        break;
      case "array":
        field = z.array(z.any());
        break;
      case "string":
      default:
        if (prop.enum) {
          field = z.enum(prop.enum as [string, ...string[]]);
        } else {
          field = z.string();
        }
        break;
    }

    if (prop.description) {
      field = field.describe(prop.description);
    }

    if (!required.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return shape;
}
