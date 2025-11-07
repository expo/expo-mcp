import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { $ } from 'zx';

import { type LogCollector, type LogCollectorOptions, type LogRecord } from './LogCollector.js';
import { fileExistsAsync } from '../utils.js';

export interface AndroidLogCollectorOptions extends LogCollectorOptions {
  appId: string;

  /**
   * When true, clears the existing device log buffer via `adb logcat -c` before collection so only new logs appear.
   * @default true
   */
  cleanOldLogs?: boolean;

  /**
   * Custom path to the adb executable.
   */
  adbPath?: string;

  /**
   * Additional arguments inserted after `adb logcat -e <appId>`.
   * Useful to tweak buffers or filters without reimplementing the collector.
   */
  additionalArgs?: string[];
}

export class AndroidLogCollector implements LogCollector {
  public readonly name = 'android-logcat';
  private adbPath: string | null = null;

  constructor(private readonly options: AndroidLogCollectorOptions) {
    if (!options.appId) {
      throw new Error('AndroidLogCollector requires an appId (application identifier).');
    }
  }

  get metadata(): Record<string, unknown> {
    return {
      appId: this.options.appId,
      adbPath: this.adbPath,
    };
  }

  async collectAsync(): Promise<string> {
    const records = await this.collectRawRecordsAsync();
    return records.map((record) => this.transformLogRecord(record)).join('\n');
  }

  async collectRawRecordsAsync(): Promise<LogRecord[]> {
    if (!this.adbPath) {
      this.adbPath = this.options.adbPath ?? (await resolveAdbPathAsync());
    }
    const adbPath = this.adbPath;
    assert(adbPath, 'ADB not found');

    const { appId, durationMs = 5000, additionalArgs = [], cleanOldLogs = true } = this.options;
    if (cleanOldLogs) {
      try {
        await $`${adbPath} logcat -c`.quiet();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to clear adb logcat buffer: ${message}`);
      }
    }
    const pid = await this.resolveAppPidAsync(adbPath, appId);

    const child = $({
      stdio: ['ignore', 'pipe', 'pipe'],
    })`${adbPath} logcat --pid=${pid} ${additionalArgs}`.quiet();
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdout || !stderr) {
      child.kill('SIGTERM');
      throw new Error('Failed to capture adb logcat output streams.');
    }
    // Prevent ProcessPromise rejection when we deliberately terminate logcat.
    child.catch(() => undefined);
    const logs: LogRecord[] = [];

    return new Promise<LogRecord[]>((resolve, reject) => {
      let settled = false;
      let stopRequested = false;
      let killHandle: NodeJS.Timeout | undefined;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const readers: ReturnType<typeof createInterface>[] = [];

      const enqueueLogLine = (line: string, type: 'stdout' | 'stderr') => {
        if (!line) {
          return;
        }
        const parsed = parseAndroidLogcatLine(line);
        const level =
          parsed?.level ?? (type === 'stderr' ? 'error' : ANDROID_LOG_LEVEL_DEFAULT_STDOUT);
        const metadata = parsed
          ? {
              pid: parsed.pid,
              tid: parsed.tid,
              tag: parsed.tag,
              timestampLabel: parsed.timestampLabel,
            }
          : undefined;
        logs.push({
          source: this.name,
          timestamp: parsed?.timestamp ?? Date.now(),
          level,
          message: parsed?.message ?? line,
          raw: line,
          type,
          metadata,
        });
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
              new Error(`Failed to read ${type} output from adb logcat for ${appId}: ${message}`)
            );
          }
        } finally {
          reader.close();
        }
      };

      forwardLines(stdout, (line) => enqueueLogLine(line, 'stdout'), 'stdout');
      forwardLines(stderr, (line) => enqueueLogLine(line, 'stderr'), 'stderr');

      const childProcess = child.child;
      if (!childProcess) {
        settleError(new Error('Failed to acquire adb logcat child process handle.'));
        return;
      }

      childProcess.once('error', (error: Error) => {
        settleError(new Error(`Failed to start adb logcat: ${error.message}`));
      });

      childProcess.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (!stopRequested && code !== 0 && signal === null) {
          return settleError(
            new Error(
              `adb logcat exited with code ${code ?? 'unknown'} before the collection window elapsed.`
            )
          );
        }
        settleSuccess();
      });

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

  private async resolveAppPidAsync(adbPath: string, appId: string): Promise<number> {
    let psOutput: string;
    try {
      const { stdout } = await $`${adbPath} shell ps`.nothrow();
      psOutput = stdout;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to list processes via adb shell ps: ${message}`);
    }

    const lines = psOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      throw new Error('adb shell ps returned no process data.');
    }

    const [headerLine, ...processLines] = lines;
    const headerColumns = headerLine.split(/\s+/);
    const pidIndex = headerColumns.indexOf('PID');
    const nameIndex = headerColumns.indexOf('NAME');
    const commandIndex =
      nameIndex !== -1
        ? nameIndex
        : headerColumns.findIndex((column) => column === 'CMD' || column === 'COMMAND');

    for (const line of processLines) {
      const parts = line.split(/\s+/);
      const processName =
        commandIndex !== -1 && commandIndex < parts.length
          ? parts[commandIndex]
          : parts[parts.length - 1];
      if (processName !== appId) {
        continue;
      }
      const pidToken =
        pidIndex !== -1 && pidIndex < parts.length ? parts[pidIndex] : (parts[1] ?? parts[0]);
      const pid = Number.parseInt(pidToken, 10);
      if (Number.isNaN(pid)) {
        continue;
      }
      return pid;
    }

    throw new Error(`No running process found for package "${appId}".`);
  }

  private transformLogRecord(record: LogRecord): string {
    const level = record.level ? `[${record.level.toLowerCase()}]` : '[debug]';
    const payload = record.message;
    return [level, payload].join(' ');
  }
}

const ANDROID_LOG_LEVEL_MAP: Record<string, string> = {
  V: 'verbose',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  F: 'fatal',
  A: 'assert',
};

const ANDROID_LOG_LEVEL_DEFAULT_STDOUT = 'info';

export interface ParsedAndroidLogcatLine {
  timestamp: number;
  timestampLabel: string;
  level?: string;
  pid?: number;
  tid?: number;
  tag?: string;
  message?: string;
}

export function parseAndroidLogcatLine(line: string): ParsedAndroidLogcatLine | null {
  const match =
    /^(?<month>\d{2})-(?<day>\d{2})\s+(?<time>\d{2}:\d{2}:\d{2}\.\d{3})\s+(?<pid>\d+)\s+(?<tid>\d+)\s+(?<level>[VDIWEFA])\s+(?<tag>[^:]+)\s*:\s*(?<message>.*)$/.exec(
      line
    );
  if (!match?.groups) {
    return null;
  }

  const { month, day, time, pid, tid, level, tag, message } = match.groups;
  const normalizedLevel = level ? (ANDROID_LOG_LEVEL_MAP[level] ?? level.toLowerCase()) : undefined;
  return {
    timestamp: parseAndroidLogTimestamp(month, day, time),
    timestampLabel: `${month}-${day} ${time}`,
    level: normalizedLevel,
    pid: pid ? Number.parseInt(pid, 10) : undefined,
    tid: tid ? Number.parseInt(tid, 10) : undefined,
    tag: tag?.trim(),
    message: message?.trim(),
  };
}

export function parseAndroidLogTimestamp(month: string, day: string, time: string): number {
  const now = new Date();
  const year = now.getFullYear();
  const iso = `${year}-${month}-${day}T${time}`;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? now.getTime() : value;
}

export async function resolveAdbPathAsync(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.ANDROID_HOME) {
    candidates.push(process.env.ANDROID_HOME);
  }
  if (process.env.ANDROID_SDK_ROOT) {
    candidates.push(process.env.ANDROID_SDK_ROOT);
  }

  // Default SDK locations
  // https://github.com/expo/expo/blob/b5438687963a115da17144c2925164e2c742bd37/packages/%40expo/cli/src/start/platforms/android/AndroidSdk.ts#L6-L15
  if (os.platform() === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'));
  } else if (os.platform() === 'linux') {
    candidates.push(path.join(os.homedir(), 'Android', 'sdk'));
  } else if (os.platform() === 'win32') {
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'));
  }

  for (const candidate of candidates) {
    const adbPath = path.join(candidate, 'platform-tools', 'adb');
    if (await fileExistsAsync(adbPath)) {
      return adbPath;
    }
  }

  return null;
}
