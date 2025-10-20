import { type McpServerProxy } from '@expo/mcp-tunnel';
import { $, within } from 'zx';

import { isExpoRouterProject } from '../project.js';

/**
 * Add MCP prompts to the server.
 */
export function addMcpPrompts(server: McpServerProxy, projectRoot: string) {
  const isRouterProject = isExpoRouterProject(projectRoot);
  if (isRouterProject) {
    server.registerPrompt(
      'expo_router_sitemap',
      {
        title: 'expo_router_sitemap',
        description:
          'Query the all routes of the current expo-router project using `expo-router-sitemap`.',
      },
      async () => {
        const sitemap = await within(async () => {
          $.cwd = projectRoot;
          const { stdout } = await $`npx -y expo-router-sitemap@latest`.nothrow();
          return stdout;
        });
        return { messages: [{ role: 'assistant', content: { type: 'text', text: sitemap } }] };
      }
    );
  }
}
