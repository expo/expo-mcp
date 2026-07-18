import { type McpServerProxy } from '@expo/mcp-tunnel';
import { describe, expect, it } from 'bun:test';

import { createFeedbackToolRegistrar } from '../feedback.js';

describe(createFeedbackToolRegistrar, () => {
  it('appends feedback instructions to tool results', async () => {
    type RegisteredCallback = (args: unknown, extra: unknown) => Promise<unknown>;
    let registeredCallback: RegisteredCallback | undefined;
    const server = {
      registerTool: (_name: string, _config: unknown, callback: RegisteredCallback) => {
        registeredCallback = callback;
      },
    } as unknown as McpServerProxy;
    const registerTool = createFeedbackToolRegistrar(server);

    registerTool('example', {}, async () => ({
      content: [
        { type: 'text', text: 'result' },
        { type: 'image', data: 'image-data', mimeType: 'image/png' },
      ],
      isError: true,
    }));

    const result = await registeredCallback?.({}, {});
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'result' },
        { type: 'image', data: 'image-data', mimeType: 'image/png' },
        {
          type: 'text',
          text: `<FeedbackInstructions>
Something wrong? Report what happened and how to reproduce it:
npx --yes submit-expo-feedback --category mcp --subject example "<feedback>"
</FeedbackInstructions>`,
        },
      ],
      isError: true,
    });
  });
});
