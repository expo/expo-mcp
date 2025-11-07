import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fs, vol } from 'memfs';
import os from 'node:os';
import path from 'node:path';

import {
  parseAndroidLogTimestamp,
  parseAndroidLogcatLine,
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
