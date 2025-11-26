import { describe, expect, it } from 'bun:test';

import { AndroidLogCollector } from '../AndroidLogCollector.js';
import type { LogCollector, LogRecord } from '../LogCollector.js';
import { CompositeLogCollector, createLogCollector } from '../LogCollectorFactory.js';

describe(createLogCollector, () => {
  it('should return a concrete collector when only one config is provided', () => {
    const collector = createLogCollector({
      android: { appId: 'com.example.app' },
    });
    expect(collector).toBeInstanceOf(AndroidLogCollector);
  });

  it('should return a composite collector when multiple configs are provided', () => {
    const collector = createLogCollector({
      android: { appId: 'com.example.app' },
      iosSimulator: { bundleIdentifier: 'com.example.app' },
    });
    expect(collector).toBeInstanceOf(CompositeLogCollector);
  });

  it('should return a concrete collector with filter when only one config is provided', () => {
    const collector = createLogCollector({
      android: { appId: 'com.example.app' },
      filterRegexp: /error/,
    });
    expect(collector).toBeInstanceOf(AndroidLogCollector);
  });

  it('should return a concrete collector with logLevel when only one config is provided', () => {
    const collector = createLogCollector({
      android: { appId: 'com.example.app' },
      logLevel: 'error',
    });
    expect(collector).toBeInstanceOf(AndroidLogCollector);
  });
});

describe(CompositeLogCollector, () => {
  const createStubCollector = (
    name: string,
    messages: string[],
    records: LogRecord[]
  ): LogCollector => ({
    name,
    get metadata(): Record<string, unknown> {
      return {
        'meta-name': name,
      };
    },
    collectAsync: async () => messages.join('\n'),
    collectRawRecordsAsync: async () =>
      records.map((record) => ({ ...record, data: `[${record.level}] ${record.message}` })),
  });

  it('should merge results from underlying collectors', async () => {
    const collector = new CompositeLogCollector([
      createStubCollector(
        'one',
        ['alpha'],
        [{ source: 'one', timestamp: 1, level: 'info', message: 'alpha' }]
      ),
      createStubCollector(
        'two',
        ['beta'],
        [{ source: 'two', timestamp: 2, level: 'info', message: 'beta' }]
      ),
    ]);

    const message = await collector.collectAsync();
    expect(message).toBe(`\
## collector: one
### metadata: {"meta-name":"one"}

alpha
--
## collector: two
### metadata: {"meta-name":"two"}

beta`);

    const records = await collector.collectRawRecordsAsync();
    expect(records).toEqual([
      { source: 'one', timestamp: 1, level: 'info', message: 'alpha', data: '[info] alpha' },
      { source: 'two', timestamp: 2, level: 'info', message: 'beta', data: '[info] beta' },
    ]);
  });
});
