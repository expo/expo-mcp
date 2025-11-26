import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { CdpLogCollector } from '../CdpLogCollector.js';

describe('CdpLogCollector transformLogRecord', () => {
  const collector = new CdpLogCollector({ metroUrl: 'http://localhost:8081' });

  it('should format console messages with arguments', () => {
    const record = {
      source: 'cdp',
      type: 'console',
      level: 'LOG',
      timestamp: 0,
      args: [
        { type: 'string', value: 'Hello' },
        { type: 'object', value: { foo: 'bar' } },
      ],
    };

    const result = (collector as any).transformLogRecord(record);
    expect(result).toEqual({
      ...record,
      data: '[log] Hello {"foo":"bar"}',
    });
  });

  it('should filter known noisy log entries', () => {
    const record = {
      source: 'cdp',
      type: 'log',
      level: 'info',
      timestamp: 0,
      message:
        '\x1B[48;2;253;247;231m\x1B[30m\x1B[1mNOTE: \x1B[22mYou are using an unsupported debugging client.',
    };

    const result = (collector as any).transformLogRecord(record);
    expect(result).toBeNull();
  });
});

describe('CdpLogCollector collectRawRecordsAsync', () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('should return an empty array when the CDP client fails to connect', async () => {
    globalThis.fetch = mock(() => ({
      ok: true,
      json: async () => [],
    })) as unknown as typeof fetch;

    const collector = new CdpLogCollector({
      metroUrl: 'http://localhost:8081',
    });

    await expect(collector.collectRawRecordsAsync()).resolves.toEqual([]);
  });
});
