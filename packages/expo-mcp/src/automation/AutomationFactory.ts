import os from 'node:os';

import { type IAutomation } from './Automation.types.js';
import { AutomationAndroid } from './AutomationAndroid.js';
import { AutomationIos } from './AutomationIos.js';
import {
  getAndroidBootedDeviceAsync,
  getAndroidBundleIdentifierAsync,
  getIosBootedSimulatorDeviceAsync,
  getIosBundleIdentifierAsync,
} from './device.js';

export class AutomationFactory {
  /**
   * Create an [AutomationAndroid] or [AutomationIos] instance for the given platform
   */
  static create(
    platform: 'android' | 'ios',
    params: { appId: string; deviceId: string; verbose?: boolean }
  ): IAutomation {
    return platform === 'android' ? new AutomationAndroid(params) : new AutomationIos(params);
  }

  /**
   * Get the appId for the given platform
   */
  static getAppIdAsync({
    platform,
    projectRoot,
    deviceId,
  }: {
    platform: 'android' | 'ios';
    projectRoot: string;
    deviceId: string;
  }): Promise<string> {
    return platform === 'android'
      ? getAndroidBundleIdentifierAsync({ projectRoot, deviceId })
      : getIosBundleIdentifierAsync({ projectRoot, deviceId });
  }

  /**
   * Get the booted device id for the given platform
   */
  static async getBootedDeviceIdAsync(platform: 'android' | 'ios'): Promise<string> {
    return platform === 'android'
      ? (await getAndroidBootedDeviceAsync()).deviceId
      : (await getIosBootedSimulatorDeviceAsync()).udid;
  }

  /**
   * Guess the current platform based on the operating system and running devices
   */
  static async guessCurrentPlatformAsync(): Promise<'android' | 'ios'> {
    if (os.platform() !== 'darwin') {
      return 'android';
    }
    try {
      await getIosBootedSimulatorDeviceAsync();
    } catch {
      return 'android';
    }
    try {
      await getAndroidBootedDeviceAsync();
    } catch {
      return 'ios';
    }
    throw new Error(
      'No platform found, make sure you have a device booted and specify the platform for AI'
    );
  }
}
