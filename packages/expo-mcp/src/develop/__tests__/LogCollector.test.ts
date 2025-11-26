import { describe, expect, it } from 'bun:test';

import type { LogCollector, TransformedLogRecord } from '../LogCollector.js';

const createCollector = (): LogCollector => ({
  name: 'test-collector',
  get metadata(): Record<string, unknown> {
    return {};
  },
  async collectAsync(): Promise<string> {
    return 'first\nsecond';
  },
  async collectRawRecordsAsync(): Promise<TransformedLogRecord[]> {
    return [
      {
        source: 'test-collector',
        timestamp: 1,
        level: 'info',
        message: 'first',
        data: '[info] first',
      },
      {
        source: 'test-collector',
        timestamp: 2,
        level: 'info',
        message: 'second',
        data: '[info] second',
      },
    ];
  },
});

describe('LogCollector contract', () => {
  it('should return formatted messages', async () => {
    const collector = createCollector();
    const message = await collector.collectAsync();
    expect(message).toBe('first\nsecond');
  });

  it('should return raw log records', async () => {
    const collector = createCollector();
    const records = await collector.collectRawRecordsAsync();
    expect(records).toEqual([
      {
        source: 'test-collector',
        timestamp: 1,
        level: 'info',
        message: 'first',
        data: '[info] first',
      },
      {
        source: 'test-collector',
        timestamp: 2,
        level: 'info',
        message: 'second',
        data: '[info] second',
      },
    ]);
  });
});
