import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import * as zm from 'zod/v4-mini';

import { TunnelMcpServerProxy } from '../TunnelMcpServerProxy.js';

const cases = [
  {
    name: 'Zod 3',
    input: z3
      .object({ command: z3.enum(['inspect', 'run']), enabled: z3.boolean().optional() })
      .strict(),
    output: z3.string(),
    prompt: z3.string().describe('Project name'),
  },
  {
    name: 'Zod 4',
    input: z
      .object({ command: z.enum(['inspect', 'run']), enabled: z.boolean().optional() })
      .strict(),
    output: z.string(),
    prompt: z.string().describe('Project name'),
  },
  {
    name: 'Zod 4 Mini',
    input: zm.strictObject({
      command: zm.enum(['inspect', 'run']),
      enabled: zm.optional(zm.boolean()),
    }),
    output: zm.string(),
    prompt: zm.string(),
  },
];

describe(TunnelMcpServerProxy, () => {
  for (const schema of cases) {
    it(`preserves ${schema.name} tool constraints in tunnel registrations`, () => {
      const proxy = new TunnelMcpServerProxy('ws://localhost:8080', {
        projectRoot: '/app',
        devServerUrl: 'http://localhost:8081',
      });

      proxy.registerTool(
        'inspect',
        { inputSchema: { parameters: schema.input }, outputSchema: { result: schema.output } },
        async () => ({ content: [] })
      );

      expect(proxy.getRegisteredTools().get('inspect')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['parameters'],
        additionalProperties: false,
        properties: {
          parameters: {
            type: 'object',
            required: ['command'],
            additionalProperties: false,
            properties: {
              command: { type: 'string', enum: ['inspect', 'run'] },
              enabled: { type: 'boolean' },
            },
          },
        },
      });
      expect(proxy.getRegisteredTools().get('inspect')?.outputSchema).toMatchObject({
        type: 'object',
        required: ['result'],
        additionalProperties: false,
        properties: { result: { type: 'string' } },
      });
    });

    it(`preserves ${schema.name} prompt arguments in tunnel registrations`, () => {
      const proxy = new TunnelMcpServerProxy('ws://localhost:8080', {
        projectRoot: '/app',
        devServerUrl: 'http://localhost:8081',
      });

      proxy.registerPrompt('project', { argsSchema: { name: schema.prompt } }, async () => ({
        messages: [],
      }));

      expect(proxy.getRegisteredPrompts().get('project')?.argsSchema).toMatchObject({
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: { name: { type: 'string' } },
      });
    });
  }
});
