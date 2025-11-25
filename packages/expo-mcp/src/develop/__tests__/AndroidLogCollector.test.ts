import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fs, vol } from 'memfs';
import os from 'node:os';
import path from 'node:path';

import {
  parseAndroidLogTimestamp,
  parseAndroidLogcatLine,
  parseAppPidFromAdbPs,
  resolveAdbPathAsync,
} from '../AndroidLogCollector.js';

mock.module('fs', () => ({
  __esModule: true,
  default: fs,
}));

describe(parseAndroidLogcatLine, () => {
  it('should parse structured logcat lines', () => {
    const line = '11-08 00:30:57.004 19068 23346 W HWUI    : Image decoding logging dropped!';
    const parsed = parseAndroidLogcatLine(line);
    const year = new Date().getFullYear();

    expect(parsed).toEqual({
      timestamp: Date.parse(`${year}-11-08T00:30:57.004`),
      timestampLabel: '11-08 00:30:57.004',
      level: 'warn',
      pid: 19068,
      tid: 23346,
      tag: 'HWUI',
      message: 'Image decoding logging dropped!',
    });
  });

  it('should return null for unexpected formats', () => {
    expect(parseAndroidLogcatLine('random noise')).toBeNull();
  });
});

describe(parseAndroidLogTimestamp, () => {
  it('should produce a timestamp using the current year', () => {
    const year = new Date().getFullYear();
    const ts = parseAndroidLogTimestamp('11', '08', '00:30:57.004');
    expect(ts).toEqual(Date.parse(`${year}-11-08T00:30:57.004`));
  });
});

describe(resolveAdbPathAsync, () => {
  const originalAndroidHome = process.env.ANDROID_HOME;
  const originalAndroidSdkRoot = process.env.ANDROID_SDK_ROOT;

  afterEach(() => {
    vol.reset();

    if (originalAndroidHome === undefined) {
      delete process.env.ANDROID_HOME;
    } else {
      process.env.ANDROID_HOME = originalAndroidHome;
    }
    if (originalAndroidSdkRoot === undefined) {
      delete process.env.ANDROID_SDK_ROOT;
    } else {
      process.env.ANDROID_SDK_ROOT = originalAndroidSdkRoot;
    }
  });

  it('should resolve adb from ANDROID_HOME', async () => {
    const sdkDir = path.join(os.homedir(), 'andriod', 'sdk');
    const adbPath = path.join(sdkDir, 'platform-tools', 'adb');
    vol.mkdirSync(path.dirname(adbPath), { recursive: true });
    vol.writeFileSync(adbPath, '');
    process.env.ANDROID_HOME = sdkDir;

    const resolved = await resolveAdbPathAsync();
    expect(resolved).toEqual(adbPath);
  });

  it('should resolve adb from ANDROID_SDK_ROOT', async () => {
    const sdkDir = path.join(os.homedir(), 'andriod', 'sdk');
    const adbPath = path.join(sdkDir, 'platform-tools', 'adb');
    vol.mkdirSync(path.dirname(adbPath), { recursive: true });
    vol.writeFileSync(adbPath, '');
    process.env.ANDROID_SDK_ROOT = sdkDir;

    const resolved = await resolveAdbPathAsync();
    expect(resolved).toEqual(adbPath);
  });

  it('should resolve adb from default SDK location', async () => {
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;
    const ANDROID_DEFAULT_LOCATION: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
      darwin: path.join(os.homedir(), 'Library', 'Android', 'sdk'),
      linux: path.join(os.homedir(), 'Android', 'sdk'),
      win32: path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    };
    const defaultSdkDir = ANDROID_DEFAULT_LOCATION[os.platform()] ?? '';
    const adbPath = path.join(defaultSdkDir, 'platform-tools', 'adb');
    vol.mkdirSync(path.dirname(adbPath), { recursive: true });
    vol.writeFileSync(adbPath, '');

    const resolved = await resolveAdbPathAsync();
    expect(resolved).toEqual(adbPath);
  });

  it('should return null when no candidate SDK location contains adb', async () => {
    delete process.env.ANDROID_HOME;
    delete process.env.ANDROID_SDK_ROOT;

    const resolved = await resolveAdbPathAsync();
    expect(resolved).toBeNull();
  });
});

describe(parseAppPidFromAdbPs, () => {
  it('should parse pid from standard adb shell ps output with NAME column', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
u0_a123      12345   678 1234567 123456 SyS_epoll_wait      0 S com.example.app
u0_a124      54321   678 1234567 123456 SyS_epoll_wait      0 S com.other.app
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.example.app');
    expect(pid).toBe(12345);
  });

  it('should parse pid from adb shell ps output with CMD column', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN  CMD
root             1     0   12345   1234 poll_schedule_timeout  init
u0_a100      23456   678 1234567 123456 SyS_epoll_wait  com.test.app
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.test.app');
    expect(pid).toBe(23456);
  });

  it('should parse pid from adb shell ps output with COMMAND column', () => {
    const psOutput = `\
USER     PID   PPID  VSIZE  RSS   WCHAN    PC        COMMAND
root       1     0     1234   567   poll     00000000  init
u0_a200  98765   678   123456 12345 epoll    00000000  dev.expo.myapp
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'dev.expo.myapp');
    expect(pid).toBe(98765);
  });

  it('should find correct process when multiple processes exist', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
root             1     0    12345   1234 poll_schedule_timeout 0 S init
u0_a100      11111   678 1234567 123456 SyS_epoll_wait      0 S com.app.one
u0_a101      22222   678 1234567 123456 SyS_epoll_wait      0 S com.app.two
u0_a102      33333   678 1234567 123456 SyS_epoll_wait      0 S com.app.three
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.app.two');
    expect(pid).toBe(22222);
  });

  it('should handle process names with dots and underscores', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
u0_a150      45678   678 1234567 123456 SyS_epoll_wait      0 S host.exp.exponent_client
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'host.exp.exponent_client');
    expect(pid).toBe(45678);
  });

  it('should throw error when process is not found', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
u0_a123      12345   678 1234567 123456 SyS_epoll_wait      0 S com.example.app
`;

    expect(() => parseAppPidFromAdbPs(psOutput, 'com.nonexistent.app')).toThrow(
      'No running process found for package "com.nonexistent.app".'
    );
  });

  it('should throw error when ps output is empty', () => {
    const psOutput = '';

    expect(() => parseAppPidFromAdbPs(psOutput, 'com.example.app')).toThrow(
      'adb shell ps returned no process data.'
    );
  });

  it('should throw error when ps output has only whitespace', () => {
    const psOutput = '   \n  \n  ';

    expect(() => parseAppPidFromAdbPs(psOutput, 'com.example.app')).toThrow(
      'adb shell ps returned no process data.'
    );
  });

  it('should handle output with windows-style line endings', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME\r
u0_a123      12345   678 1234567 123456 SyS_epoll_wait      0 S com.example.app\r
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.example.app');
    expect(pid).toBe(12345);
  });

  it('should skip processes with invalid pid values', () => {
    const psOutput = `\
USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME
u0_a123      INVALID   678 1234567 123456 SyS_epoll_wait      0 S com.example.app
u0_a123      99999   678 1234567 123456 SyS_epoll_wait      0 S com.example.app
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.example.app');
    expect(pid).toBe(99999);
  });

  it('should use fallback column detection when NAME column is missing', () => {
    const psOutput = `\
USER     PID   PPID  VSIZE
root       1     0     1234
u0_a100  55555   678   123456  com.fallback.app
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.fallback.app');
    expect(pid).toBe(55555);
  });

  it('should handle compact ps output format', () => {
    const psOutput = `\
PID NAME
12345 com.compact.app
54321 com.other.app
`;

    const pid = parseAppPidFromAdbPs(psOutput, 'com.compact.app');
    expect(pid).toBe(12345);
  });
});
