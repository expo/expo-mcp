import { describe, expect, it } from 'bun:test';

import { parseIosSimulatorLogLine } from '../IosSimulatorLogCollector.js';

describe(parseIosSimulatorLogLine, () => {
  it('should parse structured simulator log lines', () => {
    const line =
      '2024-11-08 00:30:57.004 0x1a5d Default UIKit 19068 0x000000 AppName: (Category) [Subsystem] Hello world';
    const parsed = parseIosSimulatorLogLine(line);

    expect(parsed).toEqual({
      timestamp: Date.parse('2024-11-08T00:30:57.004'),
      timestampIso: '2024-11-08 00:30:57.004',
      level: 'Default',
      thread: '0x1a5d',
      activity: 'UIKit',
      pid: 19068,
      ttl: '0x000000',
      process: 'AppName',
      category: 'Category',
      subsystem: 'Subsystem',
      text: 'Hello world',
    });
  });

  it('should return null when the header does not match the expected format', () => {
    expect(parseIosSimulatorLogLine('garbage line')).toBeNull();
  });
});
