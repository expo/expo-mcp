import { AndroidLogCollector, type AndroidLogCollectorOptions } from './AndroidLogCollector.js';
import { CdpLogCollector, type CdpLogCollectorConfig } from './CdpLogCollector.js';
import {
  IosSimulatorLogCollector,
  type IosSimulatorLogCollectorOptions,
} from './IosSimulatorLogCollector.js';
import { type LogCollector, type TransformedLogRecord } from './LogCollector.js';

export interface LogCollectorFactoryConfig {
  cdp?: CdpLogCollectorConfig;
  android?: AndroidLogCollectorOptions;
  iosSimulator?: IosSimulatorLogCollectorOptions;
  filterRegexp?: RegExp;
  logLevel?: string;
}

export class CompositeLogCollector implements LogCollector {
  public readonly name = 'composite-log';

  constructor(private readonly collectors: LogCollector[]) {}

  get metadata(): Record<string, unknown> {
    return Object.fromEntries(
      this.collectors.map((collector) => [collector.name, collector.metadata])
    );
  }

  async collectAsync(): Promise<string> {
    const results: string[] = [];
    for (const collector of this.collectors) {
      const logs = await collector.collectAsync();
      results.push(`\
## collector: ${collector.name}
### metadata: ${JSON.stringify(collector.metadata)}

${logs}`);
    }
    return results.join('\n--\n');
  }

  async collectRawRecordsAsync(): Promise<TransformedLogRecord[]> {
    if (this.collectors.length === 0) {
      return [];
    }

    const results = await Promise.all(
      this.collectors.map((collector) => collector.collectRawRecordsAsync())
    );
    return results.flat();
  }
}

export function createLogCollector(config: LogCollectorFactoryConfig): LogCollector {
  const collectors: LogCollector[] = [];

  if (config.cdp) {
    collectors.push(
      new CdpLogCollector({
        ...config.cdp,
        filterRegexp: config.filterRegexp,
        logLevel: config.logLevel,
      })
    );
  }

  if (config.android) {
    collectors.push(
      new AndroidLogCollector({
        ...config.android,
        filterRegexp: config.filterRegexp,
        logLevel: config.logLevel,
      })
    );
  }

  if (config.iosSimulator) {
    collectors.push(
      new IosSimulatorLogCollector({
        ...config.iosSimulator,
        filterRegexp: config.filterRegexp,
        logLevel: config.logLevel,
      })
    );
  }

  if (collectors.length === 1) {
    return collectors[0];
  }

  return new CompositeLogCollector(collectors);
}
