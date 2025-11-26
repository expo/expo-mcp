import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { $ } from 'zx';

import {
  type LogCollector,
  type LogCollectorOptions,
  type LogRecord,
  type TransformedLogRecord,
  shouldIncludeRecord,
} from './LogCollector.js';
import { streamProcessOutput } from './processUtils.js';
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
    return records.map((record) => record.data).join('\n');
  }

  async collectRawRecordsAsync(): Promise<TransformedLogRecord[]> {
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
    const pid = await resolveAppPidFromAdbAsync(adbPath, appId);

    const child = $({
      stdio: ['ignore', 'pipe', 'pipe'],
    })`${adbPath} logcat --pid=${pid} ${additionalArgs}`.quiet();

    const logs: LogRecord[] = [];

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

    await streamProcessOutput(child, {
      durationMs,
      onStdoutLine: (line) => enqueueLogLine(line, 'stdout'),
      onStderrLine: (line) => enqueueLogLine(line, 'stderr'),
      processName: 'adb logcat',
    });

    return logs
      .map((record) => this.transformLogRecord(record))
      .filter((record) =>
        shouldIncludeRecord({
          record,
          logLevel: this.options.logLevel,
          filterRegex: this.options.filterRegexp,
        })
      );
  }

  private transformLogRecord(record: LogRecord): TransformedLogRecord {
    const level = record.level ? `[${record.level.toLowerCase()}]` : '[debug]';
    const payload = record.message;
    const data = [level, payload].join(' ');
    return {
      ...record,
      data,
    };
  }
}

export function parseAppPidFromAdbPs(psOutput: string, appId: string): number {
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

export async function resolveAppPidFromAdbAsync(adbPath: string, appId: string): Promise<number> {
  let psOutput: string;
  try {
    const { stdout } = await $`${adbPath} shell ps`.nothrow();
    psOutput = stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to list processes via adb shell ps: ${message}`);
  }

  return parseAppPidFromAdbPs(psOutput, appId);
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
