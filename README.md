# Expo MCP Monorepo

This monorepo contains MCP local utilities for Expo development.

## Packages

### `expo-mcp`

The main Expo MCP local capabilities provider that provides MCP tools and prompts for Expo development.

It also exposes the `expo://project-context` resource so MCP clients can read the connected project root, development server URL, Expo Router usage, and documentation index without invoking a tool.

### `@expo/mcp-tunnel`

Tunnel functionality for MCP servers that provides WebSocket-based transport for remote MCP connections.

## Development

### Setup

```bash
bun install
```

### Build

```bash
bun run build
```

### Lint

```bash
bun run lint
```
