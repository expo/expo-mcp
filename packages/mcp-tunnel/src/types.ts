import {
  type PromptCallback,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
  type ResourceMetadata,
  type ResourceTemplate,
  type ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { type ZodRawShape } from 'zod';

/**
 * @deprecated Use {@link ZodRawShapeCompat} instead. Kept for backward compatibility.
 */
type PromptArgsRawShape = ZodRawShapeCompat;

export type {
  PromptCallback,
  PromptArgsRawShape,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceMetadata,
  ResourceTemplate,
  ToolCallback,
  ZodRawShapeCompat,
};

/**
 * A proxy for the `McpServer` that can be used with `expo-mcp` or tunnel for remote MCP server.
 */
export interface McpServerProxy {
  /**
   * Registers a tool with a config object and callback.
   */
  registerTool<InputArgs extends ZodRawShape, OutputArgs extends ZodRawShape>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    cb: ToolCallback<InputArgs>
  ): void;

  /**
   * Registers a prompt with a config object and callback.
   */
  registerPrompt<Args extends ZodRawShapeCompat>(
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: Args;
    },
    cb: PromptCallback<Args>
  ): void;

  /**
   * Registers a resource with a config object and callback.
   * For static resources, use a URI string. For dynamic resources, use a ResourceTemplate.
   */
  registerResource(
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    config: ResourceMetadata,
    readCallback: ReadResourceCallback | ReadResourceTemplateCallback
  ): void;

  /**
   * Starts the MCP server proxy.
   */
  start(): Promise<void>;

  /**
   * Closes the MCP server proxy.
   */
  close(): Promise<void>;

  /**
   * Gets the URL of the dev server.
   */
  get devServerUrl(): string;

  /**
   * Gets the current MCP client info (e.g., Claude, VS Code, Cursor), or null if not yet received.
   */
  get mcpClientInfo(): McpClientInfo | null;
}

export type SerializedSchema = object;

export interface SerializedMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: SerializedSchema;
  outputSchema?: SerializedSchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SerializedMcpPrompt {
  name: string;
  title?: string;
  description?: string;
  argsSchema?: SerializedSchema;
  [key: string]: unknown;
}

export interface SerializedMcpResource {
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  uri: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(...message: any[]): void;
  log(...message: any[]): void;
  info(...message: any[]): void;
  warn(...message: any[]): void;
  error(...message: any[]): void;
  time(label: string): void;
  timeEnd(label: string): void;
}

/**
 * Information about the connected MCP client (e.g., Claude, VS Code, Cursor).
 */
export interface McpClientInfo {
  name: string;
  version: string;
}
