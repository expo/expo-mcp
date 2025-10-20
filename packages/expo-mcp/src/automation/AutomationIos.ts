import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $, within } from 'zx';

import {
  type AutomationConstructorParamsBase,
  type AutomationResult,
  type IAutomation,
} from './Automation.types.js';

type EnvType = Record<string, string>;

interface ElementProperties {
  accessibility_id: string;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  element_type: number;
  identifier: string;
  label: string;
  title: string;
  value: any;
  placeholder: any;
  exists: boolean;
  is_hittable: boolean;
  is_enabled: boolean;
  is_selected: boolean;
  has_focus: boolean;
  normalized_slider_position: any;
  horizontal_size_class: number;
  vertical_size_class: number;
}

export class AutomationIos implements IAutomation {
  private readonly appId: string;
  private readonly deviceId: string;
  private readonly verbose: boolean;
  private readonly driverPath: string;

  constructor({
    appId,
    deviceId,
    verbose,
    driverPath,
  }: AutomationConstructorParamsBase & { driverPath?: string }) {
    this.appId = appId;
    this.deviceId = deviceId;
    this.verbose = verbose ?? false;
    this.driverPath =
      driverPath ??
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../assets/ios-automation-driver'
      );
  }

  tapAsync({
    x,
    y,
  }: {
    x: number;
    y: number;
  }): Promise<AutomationResult<{ x: number; y: number }>> {
    return this.withXCTestRun(() => ({
      ACTION: 'tapByCoordinates',
      X: String(x),
      Y: String(y),
    }));
  }

  async takeFullScreenshotAsync({ outputPath }: { outputPath: string }): Promise<string> {
    const {
      data: { screenshot },
    } = await this.withXCTestRun(() => ({
      ACTION: 'takeFullScreenshot',
    }));

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.cp(screenshot, outputPath, { force: true });
    await fs.promises.rm(screenshot, { force: true });
    return outputPath;
  }

  findViewByTestIDAsync(testID: string): Promise<AutomationResult<ElementProperties>> {
    return this.withXCTestRun(() => ({
      ACTION: 'findElementByAxId',
      AXID: testID,
    }));
  }

  tapByTestIDAsync(
    testID: string
  ): Promise<AutomationResult<{ accessibility_id: string; tapped: boolean }>> {
    return this.withXCTestRun(() => ({
      ACTION: 'tapByAxId',
      AXID: testID,
    }));
  }

  async taksScreenshotByTestIDAsync({
    testID,
    outputPath,
  }: {
    testID: string;
    outputPath: string;
  }): Promise<string> {
    const {
      data: { screenshot },
    } = await this.withXCTestRun(() => ({
      ACTION: 'takeScreenshotByAxId',
      AXID: testID,
    }));

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.cp(screenshot, outputPath, { force: true });
    await fs.promises.rm(screenshot, { force: true });
    return outputPath;
  }

  private async withXCTestRun<TData extends Record<string, any>>(
    fnAddEnv: () => EnvType
  ): Promise<AutomationResult<TData>> {
    return await within(async () => {
      const { driverPath, xctestrunFile } = await this.validateDriverAsync();
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'expo-mcp-automation-ios-'));

      $.verbose = this.verbose;
      try {
        $.env.TEST_RUNNER_TARGET_BUNDLE_ID = this.appId;
        // At maximum 2 seconds to wait for finding elements
        $.env.TEST_RUNNER_WAIT_TIMEOUT = String(2.0);

        const envs = fnAddEnv();
        for (const [key, value] of Object.entries(envs)) {
          $.env[`TEST_RUNNER_${key}`] = value;
        }

        const { stdout, stderr } = await this.runXCTestAsync({
          driverPath,
          xctestrunFile,
          tmpDir,
        });
        const output = stdout + stderr;
        const jsonOutput = this.extractJsonFromOutput(output);
        const result = JSON.parse(jsonOutput) as AutomationResult<TData>;
        if (this.verbose) {
          result.verboseOutput = output;
        }
        return result;
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true });
      }
    });
  }

  private async validateDriverAsync(): Promise<{
    driverPath: string;
    xctestrunFile: string;
  }> {
    const driverPath = this.driverPath;

    if (!(await getFileStatAsync(driverPath))?.isDirectory()) {
      throw new Error(`iOS Automation Driver not found: ${driverPath}`);
    }

    const xctestrunFile = path.join(driverPath, 'main.xctestrun');
    if (!(await getFileStatAsync(xctestrunFile))?.isFile()) {
      throw new Error(`main.xctestrun not found in iOS Automation Driver: ${driverPath}.`);
    }

    return { driverPath, xctestrunFile };
  }

  private extractJsonFromOutput(output: string): string {
    const lines = output.split('\n');
    let capturing = false;
    const jsonLines: string[] = [];

    for (const line of lines) {
      if (line === '######JSON_START######') {
        capturing = true;
        continue;
      }
      if (line === '######JSON_END######') {
        capturing = false;
        break;
      }
      if (capturing) {
        jsonLines.push(line);
      }
    }

    return jsonLines.join('\n').trim();
  }

  private async runXCTestAsync({
    xctestrunFile,
    tmpDir,
  }: {
    driverPath: string;
    xctestrunFile: string;
    tmpDir: string;
  }): Promise<{ stdout: string; stderr: string }> {
    const destination = `platform=iOS Simulator,id=${this.deviceId}`;
    let proc =
      $`xcodebuild test-without-building -xctestrun ${xctestrunFile} -destination ${destination} -derivedDataPath ${tmpDir} -only-testing:AutomationUITests/AutomationUITests/testAutomationActions -parallel-testing-enabled NO -verbose`.nothrow();
    if (!this.verbose) {
      proc = proc.quiet();
    }
    const procResult = await proc;

    return { stdout: procResult.stdout, stderr: procResult.stderr };
  }
}

async function getFileStatAsync(filePath: string): Promise<fs.Stats | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat;
  } catch {
    return null;
  }
}
