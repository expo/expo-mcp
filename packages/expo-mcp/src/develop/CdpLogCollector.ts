import createDebug from 'debug';
import type CdpMessageType from 'devtools-protocol';
import { type WebSocket } from 'ws';

import { CdpClient, type CdpClientOptions } from './CdpClient.js';
import {
  type LogCollector,
  type LogCollectorOptions,
  type LogRecord,
  type TransformedLogRecord,
  shouldIncludeRecord,
} from './LogCollector.js';

const debug = createDebug('expo-mcp:develop:CdpLogCollector');

interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

export interface CdpLogRecord extends LogRecord {
  source: 'cdp';
  type: 'console' | 'log';
}

export interface TransformedCdpLogRecord extends TransformedLogRecord {
  source: 'cdp';
  type: 'console' | 'log';
}

const SKIP_MESSAGES = [
  '\x1B[48;2;253;247;231m\x1B[30m\x1B[1mNOTE: \x1B[22mYou are using an unsupported debugging client.',
  '\x1B[48;2;253;247;231m\x1B[30mDebugger integration:',
  /Running "\w+?" with \{.*"rootTag":.*,"initialProps":.*"\}/,
];

export interface CdpLogCollectorOptions extends LogCollectorOptions {
  /**
   * Timeout in milliseconds for WebSocket connection (default: 2000)
   */
  timeoutMs?: number;
}

export interface CdpLogCollectorConfig extends CdpLogCollectorOptions, CdpClientOptions {}

export class CdpLogCollector implements LogCollector {
  public readonly name = 'cdp';
  private clientWebSocketDebuggerUrl?: string;

  constructor(private readonly config: CdpLogCollectorConfig) {}

  get metadata(): Record<string, unknown> {
    return {
      metroUrl: this.config.metroUrl,
      webSocketDebuggerUrl: this.clientWebSocketDebuggerUrl ?? '',
    };
  }

  async collectAsync(): Promise<string> {
    const records = await this.collectRawRecordsAsync();
    return records.map((record) => record.data).join('\n');
  }

  async collectRawRecordsAsync(): Promise<TransformedCdpLogRecord[]> {
    const records = await this.collectRawRecordsImplAsync();
    return records
      .map((record) => this.transformLogRecord(record))
      .filter(
        (record) =>
          record != null &&
          shouldIncludeRecord({
            record,
            logLevel: this.config.logLevel,
            filterRegex: this.config.filterRegexp,
          })
      ) as TransformedCdpLogRecord[];
  }

  private async collectRawRecordsImplAsync(): Promise<CdpLogRecord[]> {
    const { metroUrl, targetSelector, durationMs = 5000, timeoutMs = 2000 } = this.config;

    let ws: WebSocket;
    try {
      const client = new CdpClient({
        metroUrl,
        targetSelector,
      });

      ws = await client.createWebSocketAsync();
      this.clientWebSocketDebuggerUrl = client.getWebSocketDebuggerUrl();
    } catch (error) {
      debug('Failed to connect to CDP target:', error);
      return [];
    }

    const logs: CdpLogRecord[] = [];
    let requestId = 0;
    let timeoutHandle: NodeJS.Timeout;
    let collectionHandle: NodeJS.Timeout;

    return new Promise((resolve, reject) => {
      let settled = false;

      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Connection timeout'));
          ws.close();
        }
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timeoutHandle);

        ws.send(
          JSON.stringify({
            id: ++requestId,
            method: 'Runtime.enable',
          })
        );

        ws.send(
          JSON.stringify({
            id: ++requestId,
            method: 'Log.enable',
          })
        );

        collectionHandle = setTimeout(() => {
          if (!settled) {
            settled = true;

            ws.send(
              JSON.stringify({
                id: ++requestId,
                method: 'Runtime.disable',
              })
            );

            ws.send(
              JSON.stringify({
                id: ++requestId,
                method: 'Log.disable',
              })
            );

            // Give a brief moment for disable commands to send before closing
            setTimeout(() => {
              ws.close();
              resolve(logs);
            }, 100);
          }
        }, durationMs);
      });

      ws.on('error', (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          clearTimeout(collectionHandle);
          reject(e);
          ws.close();
        }
      });

      ws.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          clearTimeout(collectionHandle);
          resolve(logs);
        }
      });

      ws.on('message', (data) => {
        try {
          const message: CdpMessage = JSON.parse(data.toString());

          if (message.method === 'Runtime.consoleAPICalled') {
            const params = (message.params || {}) as CdpMessageType.Runtime.ConsoleAPICalledEvent;
            const { type, args, timestamp } = params;
            logs.push({
              source: 'cdp',
              type: 'console',
              timestamp: timestamp || Date.now(),
              level: type,
              args: args || [],
              metadata: {
                method: 'Runtime.consoleAPICalled',
              },
            });
          }

          if (message.method === 'Log.entryAdded') {
            const params = (message.params || {}) as CdpMessageType.Log.EntryAddedEvent;
            const { entry } = params;
            logs.push({
              source: 'cdp',
              type: 'log',
              timestamp: entry.timestamp || Date.now(),
              level: entry.level,
              message: entry.text,
              metadata: {
                method: 'Log.entryAdded',
                url: entry.url,
              },
            });
          }
        } catch (e) {
          debug('Failed to parse CDP message:', e);
        }
      });
    });
  }

  private transformLogRecord(record: CdpLogRecord): TransformedCdpLogRecord | null {
    const level = record.level ? `[${record.level.toLowerCase()}]` : '[debug]';
    let payload: string | undefined;
    if (record.type === 'console') {
      const args = record.args as CdpMessageType.Runtime.RemoteObject[];
      payload = args
        ?.map((arg) => {
          if (arg.type === 'object') {
            return JSON.stringify(arg.value);
          }
          return arg.value;
        })
        .join(' ');
    } else {
      payload = record.message;
    }

    if (
      SKIP_MESSAGES.some((skipMessage) => {
        if (typeof skipMessage === 'string') {
          return payload?.includes(skipMessage);
        }
        return skipMessage.test(payload ?? '');
      })
    ) {
      return null;
    }

    return {
      ...record,
      data: [level, payload ?? ''].join(' '),
    };
  }
}

export type { CdpClientOptions, CdpTarget, CdpTargetSelector } from './CdpClient.js';
