import { type McpServerProxy } from '@expo/mcp-tunnel';
import { describe, expect, it, mock } from 'bun:test';

import { PROJECT_CONTEXT_RESOURCE_URI, addMcpResources } from '../resources.js';

describe(addMcpResources, () => {
  it('registers readable JSON context for the connected project', async () => {
    const registerResource = mock();
    const server = {
      devServerUrl: 'http://localhost:8081',
      registerResource,
    } as unknown as McpServerProxy;

    addMcpResources(server, '/app');

    expect(registerResource).toHaveBeenCalledTimes(1);
    const [name, uri, metadata, read] = registerResource.mock.calls[0];
    expect(name).toBe('expo_project_context');
    expect(uri).toBe(PROJECT_CONTEXT_RESOURCE_URI);
    expect(metadata).toMatchObject({ mimeType: 'application/json' });

    const result = await read();
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: PROJECT_CONTEXT_RESOURCE_URI,
      mimeType: 'application/json',
    });
    expect(JSON.parse(result.contents[0].text)).toMatchObject({
      projectRoot: '/app',
      devServerUrl: 'http://localhost:8081',
      usesExpoRouter: false,
      documentationIndex: 'https://docs.expo.dev/llms.txt',
    });
  });
});
