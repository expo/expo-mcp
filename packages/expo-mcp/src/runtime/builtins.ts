/**
 * Built-in handlers for expo-mcp runtime bridge.
 * These are registered via the same mcpBridge plugin system that
 * external packages use — expo-mcp eats its own dog food.
 *
 * Only includes transport-level capabilities (tree, interaction, routing, dev tools).
 * Semantic features (actions, state) are intentionally left to plugins
 * like expo-semantic-ai to keep expo-mcp unopinionated.
 */
import { mcpBridge } from "./bridge";
import { DevSettings } from "react-native";
import { getAccessibilityTree } from "./tree";
import { typeText, scroll, takeScreenshot } from "./interaction";
import { getScreen, getRoutes, navigate } from "./router";

const SOURCE = "expo-mcp";

export function registerBuiltinHandlers(): () => void {
  return mcpBridge.registerHandlers(
    [
      {
        messageType: "get_tree",
        title: "Get accessibility tree",
        description:
          "Get the accessibility tree of the currently visible screen. Returns element IDs, roles, labels, bounds, testIDs.",
        inputSchema: {
          type: "object",
          properties: {
            maxDepth: {
              type: "number",
              description: "Max tree depth (default: unlimited)",
            },
          },
        },
        handler: (p) => getAccessibilityTree(p),
      },
      {
        messageType: "get_screen",
        title: "Get current screen info",
        description:
          "Get current route, params, and navigation stack from expo-router",
        handler: () => getScreen(),
      },
      {
        messageType: "get_routes",
        title: "Get full route tree",
        description:
          "Get the complete expo-router route tree with available screens",
        handler: () => getRoutes(),
      },
      {
        messageType: "type_text",
        title: "Type text into a field",
        description:
          "Focus a text input by testID and type text into it",
        inputSchema: {
          type: "object",
          properties: {
            testID: { type: "string", description: "React Native testID" },
            text: { type: "string", description: "Text to type" },
            clear: {
              type: "boolean",
              description: "Clear existing text first (default: false)",
            },
            submit: {
              type: "boolean",
              description: "Press return/submit after typing (default: false)",
            },
          },
          required: ["text"],
        },
        handler: (p) => typeText(p),
      },
      {
        messageType: "scroll",
        title: "Scroll a container",
        description: "Scroll a ScrollView/FlatList by testID",
        inputSchema: {
          type: "object",
          properties: {
            testID: { type: "string", description: "React Native testID" },
            direction: {
              type: "string",
              enum: ["up", "down", "left", "right"],
              description: "Scroll direction",
            },
            amount: {
              type: "number",
              description: "Pixels to scroll (default: 500)",
            },
            toEnd: {
              type: "boolean",
              description: "Scroll to end (default: false)",
            },
          },
          required: ["direction"],
        },
        handler: (p) => scroll(p),
      },
      {
        messageType: "navigate",
        title: "Navigate to a route",
        description: "Navigate to an expo-router route",
        inputSchema: {
          type: "object",
          properties: {
            route: {
              type: "string",
              description: "Route path (e.g. /products/abc-123)",
            },
            params: {
              type: "object",
              description: "Route params",
            },
          },
          required: ["route"],
        },
        handler: (p) => navigate(p),
      },
      {
        messageType: "take_screenshot",
        title: "Take screenshot",
        description:
          "Capture a screenshot from inside the app. Works on physical devices.",
        inputSchema: {
          type: "object",
          properties: {
            testID: {
              type: "string",
              description: "testID of specific view to capture (omit for full screen)",
            },
          },
        },
        handler: (p) => takeScreenshot(p),
      },
      {
        messageType: "reload",
        title: "Reload the app",
        description: "Trigger a full reload of the running app",
        handler: () => {
          DevSettings.reload();
          return { success: true };
        },
      },
    ],
    SOURCE,
  );
}
