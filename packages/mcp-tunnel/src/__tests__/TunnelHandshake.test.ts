import { describe, expect, it } from 'bun:test';

import {
  handshakeDevServerUrl,
  parseTunnelClientHandshake,
  resolveTunnelClientHandshake,
} from '../TunnelHandshake.js';

describe('parseTunnelClientHandshake', () => {
  it('parses a dev-server handshake', () => {
    expect(
      parseTunnelClientHandshake({
        kind: 'dev-server',
        projectRoot: '/app',
        devServerUrl: 'http://localhost:8081',
      })
    ).toEqual({ kind: 'dev-server', projectRoot: '/app', devServerUrl: 'http://localhost:8081' });
  });

  it('parses an orbit handshake', () => {
    expect(parseTunnelClientHandshake({ kind: 'orbit', machineId: 'm1' })).toEqual({
      kind: 'orbit',
      machineId: 'm1',
    });
  });

  it('treats a legacy (no kind) payload as dev-server', () => {
    expect(
      parseTunnelClientHandshake({ projectRoot: '/app', devServerUrl: 'http://localhost:8081' })
    ).toEqual({ kind: 'dev-server', projectRoot: '/app', devServerUrl: 'http://localhost:8081' });
  });

  it('rejects an invalid dev server URL', () => {
    expect(() =>
      parseTunnelClientHandshake({ kind: 'dev-server', projectRoot: '/app', devServerUrl: 'nope' })
    ).toThrow();
  });
});

describe('resolveTunnelClientHandshake', () => {
  it('prefers an explicit handshake descriptor', () => {
    expect(
      resolveTunnelClientHandshake({
        handshake: { kind: 'orbit', machineId: 'm1' },
        projectRoot: '/app',
        devServerUrl: 'http://localhost:8081',
      })
    ).toEqual({ kind: 'orbit', machineId: 'm1' });
  });

  it('builds a dev-server handshake from legacy fields', () => {
    expect(
      resolveTunnelClientHandshake({ projectRoot: '/app', devServerUrl: 'http://localhost:8081' })
    ).toEqual({ kind: 'dev-server', projectRoot: '/app', devServerUrl: 'http://localhost:8081' });
  });

  it('throws when neither form is supplied', () => {
    expect(() => resolveTunnelClientHandshake({})).toThrow();
  });
});

describe('handshakeDevServerUrl', () => {
  it('returns the dev server URL for a dev-server client', () => {
    expect(
      handshakeDevServerUrl({
        kind: 'dev-server',
        projectRoot: '/app',
        devServerUrl: 'http://localhost:8081',
      })
    ).toBe('http://localhost:8081');
  });

  it('returns an empty string for an orbit client', () => {
    expect(handshakeDevServerUrl({ kind: 'orbit', machineId: 'm1' })).toBe('');
  });
});
