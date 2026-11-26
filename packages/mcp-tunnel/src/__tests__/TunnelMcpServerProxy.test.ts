import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { TunnelMcpServerProxy } from '../TunnelMcpServerProxy.js';

describe(TunnelMcpServerProxy, () => {
  const createProxy = () =>
    new TunnelMcpServerProxy('ws://127.0.0.1:1', {
      projectRoot: '/app',
      devServerUrl: 'http://127.0.0.1:8081',
    });

  it('serializes tool inputSchema with input semantics so fields with defaults stay optional', () => {
    const proxy = createProxy();

    proxy.registerTool(
      'collect_logs',
      {
        inputSchema: {
          projectRoot: z.string(),
          sources: z.array(z.enum(['js_console', 'native_ios'])).default(['js_console']),
          durationMs: z.number().default(2000),
          optionalFlag: z.boolean().optional(),
        },
        outputSchema: {
          lines: z.array(z.string()).default([]),
        },
      },
      async () => ({ content: [] })
    );

    const tool = proxy.getRegisteredTools().get('collect_logs');
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectRoot'],
      properties: {
        sources: { default: ['js_console'] },
        durationMs: { default: 2000 },
      },
    });
    // Output schemas keep output semantics, where defaulted fields are always present.
    expect(tool?.outputSchema).toMatchObject({
      type: 'object',
      required: ['lines'],
    });
  });

  it('serializes prompt argsSchema with input semantics so arguments with defaults stay optional', () => {
    const proxy = createProxy();

    proxy.registerPrompt(
      'summarize',
      {
        argsSchema: {
          topic: z.string(),
          style: z.string().default('concise'),
          extra: z.string().optional(),
        },
      },
      async () => ({ messages: [] })
    );

    const prompt = proxy.getRegisteredPrompts().get('summarize');
    expect(prompt?.argsSchema).toMatchObject({
      type: 'object',
      required: ['topic'],
      properties: {
        style: { default: 'concise' },
      },
    });
  });
});
