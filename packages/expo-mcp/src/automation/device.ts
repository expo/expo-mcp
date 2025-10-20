import { $, within } from 'zx';

export interface AndroidDevice {
  deviceId: string;
}

type SimctlRuntime = string;
export interface SimctlDevice {
  dataPath: string;
  name: string;
  state: string;
  udid: string;
}

const EXPO_GO_ANDROID_PACKAGE_NAME = 'host.exp.exponent';
const EXPO_GO_IOS_BUNDLE_IDENTIFIER = 'host.exp.Exponent';

/**
 * Get the booted Android device
 *
 * @throws {Error} If no booted Android devices found
 * @throws {Error} If multiple Android devices are found
 * @returns {AndroidDevice} The booted Android device
 */
export async function getAndroidBootedDeviceAsync(): Promise<AndroidDevice> {
  const { stdout } = await $`adb devices`.nothrow();
  const lines = stdout.split('\n').slice(1);

  const bootedDevices: AndroidDevice[] = [];
  for (const line of lines) {
    const [deviceId, state] = line.split('\t');
    if (state === 'device') {
      bootedDevices.push({ deviceId });
    }
  }

  if (bootedDevices.length === 0) {
    throw new Error('No booted Android devices found');
  } else if (bootedDevices.length > 1) {
    throw new Error('Multiple Android devices are not supported yet');
  }
  return bootedDevices[0];
}

/**
 * Get the Android appId from the project root
 *
 * On Android, we may have a way to get the foreground app's package name.
 * However, to align the behavior with iOS, we keep the same logic as iOS:
 * It is a best-effort to guess the package name:
 * - We first try to use the package name from the project root.
 * - If the app is not installed or `android.package` is not set, we use Expo Go's package name.
 * - If Expo Go is not installed, we throw an error.
 */
export async function getAndroidBundleIdentifierAsync({
  projectRoot,
  deviceId,
}: {
  projectRoot: string;
  deviceId: string;
}): Promise<string> {
  const configId = await within(async () => {
    $.cwd = projectRoot;
    const { stdout } = await $`npx expo config --type public --json`.nothrow();
    const config = JSON.parse(stdout);
    return config.android.package ?? null;
  });
  if (configId != null && (await isAndroidAppInstalledAsync({ appId: configId, deviceId }))) {
    return configId;
  }

  const expoGoId = EXPO_GO_ANDROID_PACKAGE_NAME;
  if (await isAndroidAppInstalledAsync({ appId: expoGoId, deviceId })) {
    return expoGoId;
  }
  throw new Error('No Android package name found');
}

export async function isAndroidAppInstalledAsync({
  appId,
  deviceId,
}: {
  appId: string;
  deviceId: string;
}): Promise<boolean> {
  const { stdout } = await $`adb -s ${deviceId} shell pm list packages`.nothrow();
  const match = stdout.match(new RegExp(`^package:${appId}$`, 'm'));
  return match != null;
}

/**
 * Get the booted simulator device
 *
 * @throws {Error} If no booted simulator devices found
 * @throws {Error} If multiple simulator are found
 * @returns {SimctlDevice} The booted simulator device
 */
export async function getIosBootedSimulatorDeviceAsync(): Promise<SimctlDevice> {
  const { stdout } = await $`xcrun simctl list devices booted --json`;
  const result = JSON.parse(stdout) as { devices: Record<SimctlRuntime, SimctlDevice[]> };

  const bootedDevices: SimctlDevice[] = [];
  for (const [runtime, devices] of Object.entries(result.devices)) {
    if (!runtime.includes('.iOS-')) {
      continue;
    }
    bootedDevices.push(...devices);
  }

  if (bootedDevices.length === 0) {
    throw new Error('No booted simulator devices found');
  } else if (bootedDevices.length > 1) {
    throw new Error('Multiple simulator are not supported yet');
  }
  return bootedDevices[0];
}

/**
 * Get the iOS bundle identifier from the project root
 *
 * We don't have a reliable way to find the foreground app's bundle identifier.
 * It is a best-effort to guess the bundle identifier:
 * - We first try to use the bundle identifier from the project root.
 * - If the app is not installed or `ios.bundleIdentifier` is not set, we use Expo Go's bundle identifier.
 * - If Expo Go is not installed, we throw an error.
 */
export async function getIosBundleIdentifierAsync({
  projectRoot,
  deviceId,
}: {
  projectRoot: string;
  deviceId: string;
}): Promise<string> {
  const configId = await within(async () => {
    $.cwd = projectRoot;
    const { stdout } = await $`npx expo config --type public --json`.nothrow();
    const config = JSON.parse(stdout);
    return config.ios.bundleIdentifier ?? null;
  });
  if (configId != null && (await isIosAppInstalledAsync({ appId: configId, deviceId }))) {
    return configId;
  }

  const expoGoId = EXPO_GO_IOS_BUNDLE_IDENTIFIER;
  if (await isIosAppInstalledAsync({ appId: expoGoId, deviceId })) {
    return expoGoId;
  }
  throw new Error('No iOS bundle identifier found');
}

export async function isIosAppInstalledAsync({
  appId,
  deviceId,
}: {
  appId: string;
  deviceId: string;
}): Promise<boolean> {
  try {
    await $`xcrun simctl get_app_container ${deviceId} ${appId}`.quiet();
    return true;
  } catch {}
  return false;
}
