import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type WebSocketImpl from 'ws';

import { CdpClient } from '../CdpClient.js';

describe(CdpClient, () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('should create a WebSocket using the selected target', async () => {
    const wsUrl = 'ws://debugger';
    const target = {
      id: '1',
      appId: 'app',
      deviceName: 'device',
      description: '',
      type: 'native',
      title: 'title',
      devtoolsFrontendUrl: '/devtools',
      webSocketDebuggerUrl: wsUrl,
    };

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => [target],
    })) as unknown as typeof fetch;

    const selector = async () => target;
    const createdUrls: string[] = [];
    const client = new CdpClient({
      metroUrl: 'http://localhost:8081',
      targetSelector: selector,
      createWebSocket: (url) => {
        createdUrls.push(url);
        return {
          url,
          on() {
            return this;
          },
          send() {},
          close() {},
        } as unknown as WebSocketImpl;
      },
    });

    const socket = await client.createWebSocketAsync();
    expect(createdUrls[0]).toBe(wsUrl);
    expect((socket as any).url).toBe(wsUrl);
  });

  it('should throw when debugger target payload is not an array', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ invalid: true }),
    })) as unknown as typeof fetch;

    const client = new CdpClient({
      metroUrl: 'http://localhost:8081',
      targetSelector: async () => null,
    });

    await expect(client.createWebSocketAsync()).rejects.toThrow(
      /Unexpected debugger targets payload/
    );
  });

  it('should throw when no target is found', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => [],
    })) as unknown as typeof fetch;

    const client = new CdpClient({
      metroUrl: 'http://localhost:8081',
    });

    await expect(client.createWebSocketAsync()).rejects.toThrow(/No target found/);
  });
});
