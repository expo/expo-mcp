import { describe, expect, it, mock, spyOn } from 'bun:test';

import { ReverseTunnelClientTransport } from '../ReverseTunnelClientTransport.js';
import {
  JSON_RPC_VERSION,
  WSTunnelCloseCode,
  WSTunnelCloseMessage,
  WS_METHOD_HANDSHAKE,
} from '../constants.js';
import { MockWebSocket } from './MockWebSocket.js';

mock.module('ws', () => ({
  default: MockWebSocket,
}));

const mockLogger = {
  debug: mock(),
  log: mock(),
  info: mock(),
  warn: mock(),
  error: mock(),
  time: mock(),
  timeEnd: mock(),
};

describe(ReverseTunnelClientTransport, () => {
  it('should send a dev-server handshake for legacy projectRoot/devServerUrl options', async () => {
    const projectRoot = '/app';
    const devServerUrl = 'http://localhost:8081';
    const transport = new ReverseTunnelClientTransport('ws://localhost:8080', {
      projectRoot,
      devServerUrl,
      logger: mockLogger,
    });

    const sendSpy = spyOn(transport, 'send').mockResolvedValue(undefined);

    await transport.start();

    expect(sendSpy).toHaveBeenCalledWith({
      jsonrpc: JSON_RPC_VERSION,
      method: WS_METHOD_HANDSHAKE,
      params: { kind: 'dev-server', projectRoot, devServerUrl },
    });
  });

  it('should send an orbit handshake when given an orbit descriptor', async () => {
    const transport = new ReverseTunnelClientTransport('ws://localhost:8080', {
      handshake: { kind: 'orbit', machineId: 'machine-123', orbitVersion: '0.1.0' },
      logger: mockLogger,
    });

    const sendSpy = spyOn(transport, 'send').mockResolvedValue(undefined);

    await transport.start();

    expect(sendSpy).toHaveBeenCalledWith({
      jsonrpc: JSON_RPC_VERSION,
      method: WS_METHOD_HANDSHAKE,
      params: { kind: 'orbit', machineId: 'machine-123', orbitVersion: '0.1.0' },
    });
    // Orbit clients are not associated with a dev server.
    expect(transport.devServerUrl).toBe('');
  });

  it('should reconnect by default on disconnection', async () => {
    const projectRoot = '/app';
    const devServerUrl = 'http://localhost:8081';
    const transport = new ReverseTunnelClientTransport('ws://localhost:8080', {
      projectRoot,
      devServerUrl,
      reconnectInterval: 100,
      logger: mockLogger,
    });

    // @ts-expect-error: access private property for testing
    const spyConnect = spyOn(transport, 'connect');
    await transport.start();

    // @ts-expect-error: access private property for testing
    const ws = transport['ws'] as MockWebSocket;
    ws.close();

    // Wait a moment for reconnect logic to trigger
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Initial connect + 1 reconnect
    expect(spyConnect).toHaveBeenCalledTimes(2);
  });

  it('should abort connection on server close 4003', async () => {
    const projectRoot = '/app';
    const devServerUrl = 'http://localhost:8081';
    const transport = new ReverseTunnelClientTransport('ws://localhost:8080', {
      projectRoot,
      devServerUrl,
      reconnectInterval: 100,
      logger: mockLogger,
    });
    const mockOnServerAbort = mock();
    transport.onServerAbort = mockOnServerAbort;

    // @ts-expect-error: access private property for testing
    const spyConnect = spyOn(transport, 'connect');
    await transport.start();

    // @ts-expect-error: access private property for testing
    const ws = transport['ws'] as MockWebSocket;
    ws.close(4003, 'Multiple tunnel clients are not supported yet');

    expect(mockOnServerAbort).toHaveBeenCalledTimes(1);
    expect(mockOnServerAbort).toHaveBeenCalledWith(
      WSTunnelCloseMessage[WSTunnelCloseCode.MULTIPLE_CLIENTS_CONNECTED],
      WSTunnelCloseCode.MULTIPLE_CLIENTS_CONNECTED
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spyConnect).toHaveBeenCalledTimes(1);
  });
});
