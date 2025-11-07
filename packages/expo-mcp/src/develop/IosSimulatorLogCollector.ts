import { createInterface } from 'node:readline';
import { $ } from 'zx';

import { type LogCollector, type LogCollectorOptions, type LogRecord } from './LogCollector.js';

interface SimulatorAppInfo {
  CFBundleExecutable?: string;
  [key: string]: unknown;
}

interface LogMetadata {
  bundleIdentifier: string;
  executable: string;
  timestamp?: string;
  thread?: string;
  activity?: string;
  pid?: number;
  ttl?: string;
  process?: string;
  category?: string;
  subsystem?: string;
  [key: string]: unknown;
}

type SimulatorApps = Record<string, SimulatorAppInfo>;

const SKIP_MESSAGES = [
  'Filtering the log data using "process == "',
  'Timestamp                       Thread     Type        Activity             PID    TTL',
];

export interface IosSimulatorLogCollectorOptions extends LogCollectorOptions {
  /**
   * The bundle identifier of the iOS app to collect logs from.
   */
  bundleIdentifier: string;

  /**
   * Custom path to the xcrun executable.
   */
  xcrunPath?: string;

  /**
   * Additional arguments appended to the simulator log stream command.
   * The predicate is placed before these arguments, allowing for further filtering.
   */
  additionalArgs?: string[];
}

export class IosSimulatorLogCollector implements LogCollector {
  public readonly name = 'ios-simulator-log';

  constructor(private readonly options: IosSimulatorLogCollectorOptions) {
    if (!options.bundleIdentifier) {
      throw new Error('IosSimulatorLogCollector requires a bundleIdentifier.');
    }
  }

  get metadata(): Record<string, unknown> {
    return {
      bundleIdentifier: this.options.bundleIdentifier,
    };
  }

  async collectAsync(): Promise<string> {
    const records = await this.collectRawRecordsAsync();
    return (
      records.map((record) => this.transformLogRecord(record)).filter(Boolean) as string[]
    ).join('\n');
  }

  async collectRawRecordsAsync(): Promise<LogRecord[]> {
    const {
      bundleIdentifier,
      durationMs = 5000,
      xcrunPath = 'xcrun',
      additionalArgs = [],
    } = this.options;

    const executableName = await this.resolveExecutableNameAsync(xcrunPath, bundleIdentifier);
    const predicate = `(process == "${executableName}")`;
    const args = [
      'simctl',
      'spawn',
      'booted',
      'log',
      'stream',
      '--level',
      'debug',
      '--predicate',
      predicate,
      ...additionalArgs,
    ];

    const child = $({ stdio: ['ignore', 'pipe', 'pipe'] })`${xcrunPath} ${args}`.quiet();
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdout || !stderr) {
      child.kill('SIGTERM');
      throw new Error('Failed to capture iOS simulator log output streams.');
    }
    // Prevent ProcessPromise rejection when we stop the stream ourselves.
    child.catch(() => undefined);

    const logs: LogRecord[] = [];
    const sharedMetadata = { bundleIdentifier, executable: executableName };

    return new Promise<LogRecord[]>((resolve, reject) => {
      let settled = false;
      let stopRequested = false;
      let killHandle: NodeJS.Timeout | undefined;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const readers: ReturnType<typeof createInterface>[] = [];

      const handleStdoutLine = (line: string) => {
        if (!line) {
          return;
        }
        const parsed = parseIosSimulatorLogLine(line);
        const level = parsed?.level ? parsed.level.toLowerCase() : 'debug';
        const metadata: LogMetadata = {
          ...sharedMetadata,
          timestamp: parsed?.timestampIso,
          thread: parsed?.thread,
          activity: parsed?.activity,
          pid: parsed?.pid,
          ttl: parsed?.ttl,
          process: parsed?.process,
          category: parsed?.category,
          subsystem: parsed?.subsystem,
        };
        logs.push({
          source: this.name,
          timestamp: parsed?.timestamp ?? Date.now(),
          level,
          message: parsed?.text ?? line,
          raw: line,
          type: 'stdout',
          metadata,
        });
      };

      const handleStderrLine = (line: string) => {
        if (!line) {
          return;
        }
        const parsed = parseIosSimulatorLogLine(line);
        const level = parsed?.level ? parsed.level.toLowerCase() : 'error';
        const metadata: LogMetadata = {
          ...sharedMetadata,
          timestamp: parsed?.timestampIso,
          thread: parsed?.thread,
          activity: parsed?.activity,
          pid: parsed?.pid,
          ttl: parsed?.ttl,
          process: parsed?.process,
          category: parsed?.category,
          subsystem: parsed?.subsystem,
        };
        logs.push({
          source: this.name,
          timestamp: parsed?.timestamp ?? Date.now(),
          level,
          message: parsed?.text ?? line,
          raw: line,
          type: 'stderr',
          metadata,
        });
      };

      const cleanup = () => {
        for (const reader of readers) {
          reader.close();
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (killHandle) {
          clearTimeout(killHandle);
        }
      };

      const forwardLines = async (
        stream: NodeJS.ReadableStream,
        onLine: (line: string) => void,
        type: 'stdout' | 'stderr'
      ) => {
        const reader = createInterface({ input: stream, crlfDelay: Infinity });
        readers.push(reader);
        try {
          for await (const line of reader) {
            if (settled) {
              break;
            }
            onLine(line);
          }
        } catch (error) {
          if (!settled) {
            const message = error instanceof Error ? error.message : 'Unknown stream read error';
            settleError(
              new Error(
                `Failed to read ${type} output from the iOS simulator log stream: ${message}`
              )
            );
          }
        } finally {
          reader.close();
        }
      };

      const settleSuccess = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(logs);
      };

      const settleError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      forwardLines(stdout, handleStdoutLine, 'stdout');
      forwardLines(stderr, handleStderrLine, 'stderr');

      const childProcess = child.child;
      if (!childProcess) {
        settleError(new Error('Failed to acquire iOS simulator log stream handle.'));
      } else {
        childProcess.once('error', (error: Error) => {
          settleError(new Error(`Failed to start iOS simulator log stream: ${error.message}`));
        });

        childProcess.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
          if (!stopRequested && code !== 0 && signal === null) {
            return settleError(
              new Error(
                `iOS simulator log stream exited with code ${code ?? 'unknown'} before the collection window elapsed.`
              )
            );
          }
          settleSuccess();
        });
      }

      killHandle = setTimeout(() => {
        child.kill('SIGKILL');
      }, durationMs + 1000);
      killHandle?.unref?.();

      timeoutHandle = setTimeout(() => {
        stopRequested = true;
        child.kill('SIGINT');
      }, durationMs);
      timeoutHandle?.unref?.();
    });
  }
  private async resolveExecutableNameAsync(
    xcrunPath: string,
    bundleIdentifier: string
  ): Promise<string> {
    const appInfo = await this.getAppInfoAsync(xcrunPath, bundleIdentifier);
    if (appInfo?.CFBundleExecutable) {
      return appInfo.CFBundleExecutable;
    }

    const listAppsInfo = await this.getListAppsEntryAsync(xcrunPath, bundleIdentifier);
    if (!listAppsInfo) {
      throw new Error(`No simulator app found with bundle identifier "${bundleIdentifier}".`);
    }
    if (listAppsInfo.CFBundleExecutable) {
      return listAppsInfo.CFBundleExecutable;
    }

    throw new Error(`Simulator app "${bundleIdentifier}" does not expose a CFBundleExecutable.`);
  }

  private async getAppInfoAsync(
    xcrunPath: string,
    bundleIdentifier: string
  ): Promise<SimulatorAppInfo | null> {
    try {
      const { stdout } = await $`${xcrunPath} simctl appinfo booted ${bundleIdentifier}`
        .quiet()
        .pipe($`plutil -convert json -o - -`.quiet());
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  private async getListAppsEntryAsync(
    xcrunPath: string,
    bundleIdentifier: string
  ): Promise<SimulatorAppInfo | null> {
    try {
      const { stdout } = await $`${xcrunPath} simctl listapps booted`.quiet();
      let parsed: SimulatorApps;
      try {
        parsed = JSON.parse(stdout) as SimulatorApps;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to parse simulator apps list: ${message}`);
      }
      return parsed[bundleIdentifier] ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to list booted simulator apps: ${message}`);
    }
  }

  private transformLogRecord(record: LogRecord): string | null {
    const level = record.level ? `[${record.level.toLowerCase()}]` : '[debug]';
    const subsystem = record.metadata?.subsystem ?? '';
    const category = record.metadata?.category ?? '';
    const payload = record.message;
    if (SKIP_MESSAGES.some((skipMessage) => payload?.includes(skipMessage))) {
      return null;
    }
    return [level, subsystem, category, payload].filter(Boolean).join(' ');
  }
}

interface ParsedIosLogLine {
  timestamp: number;
  timestampIso: string;
  level?: string;
  thread?: string;
  activity?: string;
  pid?: number;
  ttl?: string;
  process?: string;
  category?: string;
  subsystem?: string;
  text?: string;
}

export function parseIosSimulatorLogLine(line: string): ParsedIosLogLine | null {
  const headerMatch = line.match(
    /^(?<timestamp>\S+\s+\S+)\s+(?<thread>\S+)\s+(?<type>\S+)\s+(?<activity>\S+)\s+(?<pid>\d+)\s+(?<ttl>\S+)\s+(?<body>.*)$/
  );
  if (!headerMatch?.groups) {
    return null;
  }

  const { timestamp, thread, type, activity, pid, ttl, body } = headerMatch.groups;
  const timestampMs = parseIosTimestamp(timestamp);

  const remaining = body.trim();
  let processName: string | undefined;
  let textPart = remaining;

  const processMatch = remaining.match(/^(?<process>[^:]+):\s*(?<rest>.*)$/);
  if (processMatch && processMatch.groups) {
    processName = processMatch.groups.process.trim();
    textPart = processMatch.groups.rest;
  }

  let category: string | undefined;
  let subsystem: string | undefined;
  let finalText = textPart.trim();

  const detailMatch = textPart.match(
    /^(?:\((?<category>[^)]+)\)\s*)?(?:\[(?<subsystem>[^\]]+)\]\s*)?(?<message>.*)$/
  );
  if (detailMatch && detailMatch.groups) {
    if (detailMatch.groups.category) {
      category = detailMatch.groups.category.trim();
    }
    if (detailMatch.groups.subsystem) {
      subsystem = detailMatch.groups.subsystem.trim();
    }
    finalText = detailMatch.groups.message?.trim() ?? finalText;
  }

  return {
    timestamp: Number.isNaN(timestampMs) ? Date.now() : timestampMs,
    timestampIso: timestamp,
    level: type,
    thread,
    activity,
    pid: pid ? Number.parseInt(pid, 10) : undefined,
    ttl,
    process: processName,
    category,
    subsystem,
    text: finalText,
  };
}

function parseIosTimestamp(timestamp: string): number {
  const normalized = timestamp.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const value = Date.parse(normalized);
  return Number.isNaN(value) ? Date.now() : value;
}
