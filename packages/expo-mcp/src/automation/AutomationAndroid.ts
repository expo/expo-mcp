import fs from 'node:fs';
import path from 'node:path';
import { parseString } from 'xml2js';
import { $, tmpfile, within } from 'zx';

import { cropImageAsync } from '../imageUtils.js';
import {
  type AutomationConstructorParamsBase,
  type AutomationResult,
  type IAutomation,
} from './Automation.types.js';

interface ElementProperties {
  resource_id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  class: string;
  text: string;
  content_desc: string;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  selected: boolean;
  checkable: boolean;
  checked: boolean;
  package: string;
  exists: boolean;
}

export class AutomationAndroid implements IAutomation {
  private readonly appId: string;
  private readonly deviceId: string;
  private readonly verbose: boolean;

  constructor({ appId, deviceId, verbose }: AutomationConstructorParamsBase) {
    this.appId = appId;
    this.deviceId = deviceId;
    this.verbose = verbose ?? false;
    this.sanityCheckAsync();
  }

  async tapAsync({
    x,
    y,
  }: {
    x: number;
    y: number;
  }): Promise<AutomationResult<{ x: number; y: number }>> {
    const startTime = Date.now();
    try {
      await this.runAdbCommand(['shell', 'input', 'tap', String(x), String(y)]);
      return {
        success: true,
        duration: Date.now() - startTime,
        data: { x, y },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        data: { x, y },
      };
    }
  }

  async takeFullScreenshotAsync({ outputPath }: { outputPath: string }): Promise<string> {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const tempPath = `/sdcard/screenshot_${Date.now()}.png`;
    await this.runAdbCommand(['shell', 'screencap', '-p', tempPath]);
    await this.runAdbCommand(['pull', tempPath, outputPath]);
    await this.runAdbCommand(['shell', 'rm', tempPath]);

    return outputPath;
  }

  async findViewByTestIDAsync(testID: string): Promise<AutomationResult<ElementProperties>> {
    const startTime = Date.now();
    try {
      const xmlViewHierarchy = await this.dumpViewHierarchy();
      const element = await this.findElementByResourceId(xmlViewHierarchy, testID);

      return {
        success: true,
        duration: Date.now() - startTime,
        data: element,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        data: {} as ElementProperties,
      };
    }
  }

  async tapByTestIDAsync(
    testID: string
  ): Promise<AutomationResult<{ resource_id: string; tapped: boolean }>> {
    const startTime = Date.now();
    try {
      const xmlViewHierarchy = await this.dumpViewHierarchy();
      const element = await this.findElementByResourceId(xmlViewHierarchy, testID);

      if (!element.clickable && !element.enabled) {
        return {
          success: false,
          error: `Element with testID "${testID}" is not clickable or enabled`,
          duration: Date.now() - startTime,
          data: { resource_id: testID, tapped: false as boolean },
        };
      }

      const centerX = element.bounds.x + element.bounds.width / 2;
      const centerY = element.bounds.y + element.bounds.height / 2;

      await this.runAdbCommand(['shell', 'input', 'tap', String(centerX), String(centerY)]);

      return {
        success: true,
        duration: Date.now() - startTime,
        data: { resource_id: testID, tapped: true as boolean },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        data: { resource_id: testID, tapped: false as boolean },
      };
    }
  }

  async taksScreenshotByTestIDAsync({
    testID,
    outputPath,
  }: {
    testID: string;
    outputPath: string;
  }): Promise<string> {
    const xmlViewHierarchy = await this.dumpViewHierarchy();
    const element = await this.findElementByResourceId(xmlViewHierarchy, testID);

    const bounds = element.bounds;
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const tempFullScreenshot = `/sdcard/full_screenshot_${Date.now()}.png`;
    await this.runAdbCommand(['shell', 'screencap', '-p', tempFullScreenshot]);

    const tempLocalPath = tmpfile('tmp.png');
    try {
      await this.runAdbCommand(['pull', tempFullScreenshot, tempLocalPath]);
      await this.runAdbCommand(['shell', 'rm', tempFullScreenshot]);

      await cropImageAsync({
        imagePath: tempLocalPath,
        outputPath,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      return outputPath;
    } finally {
      await fs.promises.rm(tempLocalPath, { force: true });
    }
  }

  private async sanityCheckAsync(): Promise<void> {
    try {
      await $`adb version`;
    } catch (error: unknown) {
      throw new Error(`ADB is not installed: ${error}`);
    }
  }

  private runAdbCommand(args: string[]): Promise<string> {
    return within(async () => {
      $.verbose = this.verbose;
      const { stdout } = await $`adb -s ${this.deviceId} ${args}`.nothrow();
      return stdout;
    });
  }

  private async dumpViewHierarchy(): Promise<string> {
    const xmlViewHierarchy = await this.runAdbCommand([
      'exec-out',
      'uiautomator',
      'dump',
      '--compressed',
      '/dev/tty',
    ]);
    return xmlViewHierarchy;
  }

  private async findElementByResourceId(
    xmlViewHierarchy: string,
    resourceId: string
  ): Promise<ElementProperties> {
    return new Promise((resolve, reject) => {
      parseString(xmlViewHierarchy, (err, result) => {
        if (err) {
          reject(new Error(`Failed to parse XML dump: ${err}`));
          return;
        }

        const element = this.searchNodes(result.hierarchy.node, resourceId);
        if (!element) {
          reject(new Error(`Element with testID "${resourceId}" not found`));
          return;
        }

        resolve(element);
      });
    });
  }

  private searchNodes(nodes: any[] | any, resourceId: string): ElementProperties | null {
    if (!nodes) {
      return null;
    }

    const nodeArray = Array.isArray(nodes) ? nodes : [nodes];

    for (const node of nodeArray) {
      if (!node || !node.$) {
        continue;
      }

      const nodeResourceId = node.$['resource-id'];

      if (nodeResourceId === resourceId) {
        return this.parseElementProperties(node);
      }

      if (node.node) {
        const childResult = this.searchNodes(node.node, resourceId);
        if (childResult) return childResult;
      }
    }

    return null;
  }

  private parseElementProperties(node: any): ElementProperties {
    const attrs = node.$ || {};
    const boundsStr = attrs.bounds || '[0,0][0,0]';
    const boundsMatch = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

    let bounds = { x: 0, y: 0, width: 0, height: 0 };
    if (boundsMatch) {
      const [, x1, y1, x2, y2] = boundsMatch.map(Number);
      bounds = {
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      };
    }

    return {
      resource_id: attrs['resource-id'] || '',
      bounds,
      class: attrs.class || '',
      text: attrs.text || '',
      content_desc: attrs['content-desc'] || '',
      clickable: attrs.clickable === 'true',
      enabled: attrs.enabled === 'true',
      focusable: attrs.focusable === 'true',
      focused: attrs.focused === 'true',
      scrollable: attrs.scrollable === 'true',
      selected: attrs.selected === 'true',
      checkable: attrs.checkable === 'true',
      checked: attrs.checked === 'true',
      package: attrs.package || '',
      exists: true,
    };
  }
}
