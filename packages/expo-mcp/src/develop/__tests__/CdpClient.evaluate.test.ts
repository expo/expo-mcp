import { describe, expect, it } from 'bun:test';
import type WebSocketImpl from 'ws';

import { MockWebSocket } from './MockWebSocket.js';
import { evaluateJsFromCdpAsync } from '../CdpClient.js';

describe(evaluateJsFromCdpAsync, () => {
  it('should resolve string results from CDP', async () => {
    const factory = (url: string) =>
      new MockWebSocket(url, (request, socket) => {
        socket.emit(
          'message',
          JSON.stringify({
            id: request.id,
            result: { result: { type: 'string', value: 'ok' } },
          })
        );
      }) as unknown as WebSocketImpl;

    const result = await evaluateJsFromCdpAsync('ws://debugger', '1+1', 2000, {
      createWebSocket: factory,
    });

    expect(result).toBe('ok');
  });

  it('should resolve undefined when result is non-string', async () => {
    const factory = (url: string) =>
      new MockWebSocket(url, (request, socket) => {
        socket.emit(
          'message',
          JSON.stringify({
            id: request.id,
            result: { result: { type: 'number', value: 42 } },
          })
        );
      }) as unknown as WebSocketImpl;

    const result = await evaluateJsFromCdpAsync('ws://debugger', '2+2', 2000, {
      createWebSocket: factory,
    });

    expect(result).toBeUndefined();
  });
});
