import { type McpServerProxy } from '@expo/mcp-tunnel';

import { isExpoRouterProject } from '../project.js';

export const PROJECT_CONTEXT_RESOURCE_URI = 'expo://project-context';

/**
 * Exposes stable project context that clients can read without invoking a tool.
 */
export function addMcpResources(server: McpServerProxy, projectRoot: string) {
  server.registerResource(
    'expo_project_context',
    PROJECT_CONTEXT_RESOURCE_URI,
    {
      title: 'Expo project context',
      description:
        'Basic context for the Expo project connected to this MCP server, including its root, development server, and router setup.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: PROJECT_CONTEXT_RESOURCE_URI,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              projectRoot,
              devServerUrl: server.devServerUrl,
              usesExpoRouter: isExpoRouterProject(projectRoot),
              documentationIndex: 'https://docs.expo.dev/llms.txt',
            },
            null,
            2
          ),
        },
      ],
    })
  );
}
