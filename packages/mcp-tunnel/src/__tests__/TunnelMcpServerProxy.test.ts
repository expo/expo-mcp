import { describe, expect, it, mock } from 'bun:test';
import { z } from 'zod';

import { TunnelMcpServerProxy } from '../TunnelMcpServerProxy.js';
import { WS_METHOD_MCP_PROMPTS_GET, WS_METHOD_MCP_TOOLS_CALL } from '../constants.js';
import { MockWebSocket } from './MockWebSocket.js';

class TunnelSocket extends MockWebSocket {
  static latest?: TunnelSocket;
  onSend: (message: any) => void = () => {};

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    super(url, options);
    TunnelSocket.latest = this;
  }

  receive(message: unknown) {
    this['trigger']('message', Buffer.from(JSON.stringify(message)));
  }

  override send(data: string) {
    this.onSend(JSON.parse(data));
  }
}

mock.module('ws', () => ({ default: TunnelSocket }));

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

  describe('incoming requests', () => {
    const createTunnelledProxy = async () => {
      const proxy = createProxy();
      await proxy.start();
      const socket = TunnelSocket.latest!;
      let nextId = 1;
      const request = (method: string, params: Record<string, unknown>) => {
        const id = nextId++;
        return new Promise<any>((resolve) => {
          socket.onSend = (message) => message.id === id && resolve(message);
          socket.receive({ jsonrpc: '2.0', id, method, params });
        });
      };
      return {
        proxy,
        callTool: (name: string, args?: Record<string, unknown>) =>
          request(WS_METHOD_MCP_TOOLS_CALL, { name, arguments: args }),
        getPrompt: (name: string, args?: Record<string, unknown>) =>
          request(WS_METHOD_MCP_PROMPTS_GET, { name, arguments: args }),
      };
    };

    const collectLogsShape = {
      projectRoot: z.string(),
      sources: z
        .array(z.enum(['native_android', 'native_ios', 'js_console']))
        .min(1)
        .default(['js_console']),
      durationMs: z.number().min(0).max(10000).default(2000),
    };

    it('applies input schema defaults before calling a tool', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      const received: unknown[] = [];
      proxy.registerTool('collect_logs', { inputSchema: collectLogsShape }, async (args: any) => {
        received.push(args);
        return { content: [] };
      });

      const response = await callTool('collect_logs', { projectRoot: '/x' });

      expect(response.error).toBeUndefined();
      expect(received).toEqual([{ projectRoot: '/x', sources: ['js_console'], durationMs: 2000 }]);
    });

    it('drops arguments that the input schema does not declare', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      const received: unknown[] = [];
      proxy.registerTool('collect_logs', { inputSchema: collectLogsShape }, async (args: any) => {
        received.push(args);
        return { content: [] };
      });

      await callTool('collect_logs', { projectRoot: '/x', unexpected: true });

      expect(received).toEqual([{ projectRoot: '/x', sources: ['js_console'], durationMs: 2000 }]);
    });

    it('returns a tool error result without calling the tool when arguments are invalid', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      let calls = 0;
      proxy.registerTool('collect_logs', { inputSchema: collectLogsShape }, async () => {
        calls++;
        return { content: [] };
      });

      const response = await callTool('collect_logs', { projectRoot: '/x', durationMs: 99999 });

      expect(response.error).toBeUndefined();
      expect(response.result.isError).toBe(true);
      expect(calls).toBe(0);
    });

    it('calls a tool that has no input schema with the arguments as sent', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      const received: unknown[] = [];
      proxy.registerTool('ping', {}, async (args: any) => {
        received.push(args);
        return { content: [] };
      });

      await callTool('ping', { anything: 1 });

      expect(received).toEqual([{ anything: 1 }]);
    });

    it('stops validating a tool that is re-registered without an input schema', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      const received: unknown[] = [];
      const callback = async (args: any) => {
        received.push(args);
        return { content: [] };
      };
      proxy.registerTool('collect_logs', { inputSchema: collectLogsShape }, callback);
      proxy.registerTool('collect_logs', {}, callback);

      const response = await callTool('collect_logs', { durationMs: 99999 });

      expect(response.result.isError).toBeUndefined();
      expect(received).toEqual([{ durationMs: 99999 }]);
    });

    it('rejects invalid prompt arguments with JSON-RPC error -32602 without calling the prompt', async () => {
      const { proxy, getPrompt } = await createTunnelledProxy();
      let calls = 0;
      proxy.registerPrompt(
        'summarize',
        { argsSchema: { style: z.enum(['short', 'long']) } },
        async () => {
          calls++;
          return { messages: [] };
        }
      );

      const response = await getPrompt('summarize', { style: 'medium' });

      expect(response.error.code).toBe(-32602);
      expect(response.result).toBeUndefined();
      expect(calls).toBe(0);
    });

    it('applies args schema defaults before calling a prompt', async () => {
      const { proxy, getPrompt } = await createTunnelledProxy();
      const received: unknown[] = [];
      proxy.registerPrompt(
        'summarize',
        { argsSchema: { topic: z.string().default('general') } },
        async (args: any) => {
          received.push(args);
          return { messages: [] };
        }
      );

      const response = await getPrompt('summarize', {});

      expect(response.error).toBeUndefined();
      expect(received).toEqual([{ topic: 'general' }]);
    });

    it('does not treat a numeric code on a thrown error as a JSON-RPC error code', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      proxy.registerTool('boom', {}, async () => {
        throw Object.assign(new Error('exit'), { code: 1 });
      });

      const response = await callTool('boom', {});

      expect(response.error.code).toBe(-32603);
    });

    it('keeps the earlier registration working when a re-registration cannot be serialized', async () => {
      const { proxy, callTool } = await createTunnelledProxy();
      const received: unknown[] = [];
      proxy.registerTool('collect_logs', { inputSchema: collectLogsShape }, async (args: any) => {
        received.push(args);
        return { content: [] };
      });

      expect(() =>
        proxy.registerTool(
          'collect_logs',
          { inputSchema: { projectRoot: z.string() }, outputSchema: { d: z.date() } },
          async () => ({ content: [] })
        )
      ).toThrow();
      await callTool('collect_logs', { projectRoot: '/x' });

      expect(received).toEqual([{ projectRoot: '/x', sources: ['js_console'], durationMs: 2000 }]);
    });
  });
});
