import { type McpServerProxy } from '@expo/mcp-tunnel';
import fs from 'node:fs';
import { z } from 'zod';
import { tmpfile } from 'zx';

import type { IAutomation } from '../../automation/Automation.types.js';
import { AutomationFactory } from '../../automation/AutomationFactory.js';
import { RuntimeClient } from '../../develop/RuntimeClient.js';
import { resizeImageToMaxSizeAsync } from '../../imageUtils.js';

type AutomationContext = {
  automation: IAutomation;
  platform: 'android' | 'ios';
  deviceId: string;
  appId: string;
};

async function getAutomationContext(
  projectRoot: string,
  platformParam?: 'android' | 'ios'
): Promise<AutomationContext> {
  const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
  const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
  const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
  const automation = AutomationFactory.create(platform, { appId, deviceId });
  return { automation, platform, deviceId, appId };
}

function findInTree(elements: any[], testID: string): any | null {
  for (const el of elements) {
    if (el.testID === testID) return el;
    if (el.children) {
      const found = findInTree(el.children, testID);
      if (found) return found;
    }
  }
  return null;
}

export function addAutomationTools(
  server: McpServerProxy,
  projectRoot: string,
  runtimeClient: RuntimeClient
) {
  server.registerTool(
    'automation_tap',
    {
      title: 'Tap on device',
      description:
        'Tap on the device at the given coordinates (x, y) or by react-native testID. Provide either (x AND y) or testID. Works on simulators and physical devices.',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        x: z.number().optional().describe('X coordinate for tap (required if testID not provided)'),
        y: z.number().optional().describe('Y coordinate for tap (required if testID not provided)'),
        testID: z
          .string()
          .optional()
          .describe('React Native testID of the view to tap (alternative to x,y coordinates)'),
      },
    },
    async ({ projectRoot, platform, x, y, testID }) => {
      try {
        if (testID) {
          const { automation } = await getAutomationContext(projectRoot, platform);
          const result = await automation.tapByTestIDAsync(testID);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } else if (x !== undefined && y !== undefined) {
          const { automation } = await getAutomationContext(projectRoot, platform);
          const result = await automation.tapAsync({ x, y });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
      } catch (simulatorError) {
        // Fallback: runtime bridge — tap via fiber instance onPress
        if (runtimeClient.isConnected && testID) {
          const result = await runtimeClient.request('tap', { testID });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        throw simulatorError;
      }
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Must provide either testID or both x and y coordinates',
          },
        ],
        isError: true,
      };
    }
  );

  server.registerTool(
    'automation_take_screenshot',
    {
      title: 'Take screenshot of the app',
      description:
        'Take screenshot of the full app or a specific view by react-native testID. Works on simulators and physical devices.',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        testID: z
          .string()
          .optional()
          .describe(
            'React Native testID of the view to screenshot (if not provided, takes full screen)'
          ),
      },
    },
    async ({ projectRoot, platform, testID }) => {
      // Try simulator-based approach first (captures full native UI including status bar)
      try {
        const { automation } = await getAutomationContext(projectRoot, platform);
        const outputPath = `${tmpfile()}.png`;
        try {
          if (testID) {
            await automation.taksScreenshotByTestIDAsync({ testID, outputPath });
          } else {
            await automation.takeFullScreenshotAsync({ outputPath });
          }
          const { buffer } = await resizeImageToMaxSizeAsync(outputPath);
          return {
            content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' }],
          };
        } finally {
          await fs.promises.rm(outputPath, { force: true });
        }
      } catch (simulatorError) {
        // Fallback: runtime bridge (works on physical devices)
        if (runtimeClient.isConnected) {
          const result = await runtimeClient.request('take_screenshot', { testID });
          return {
            content: [{ type: 'image', data: result.base64, mimeType: 'image/png' }],
          };
        }
        throw new Error(
          `Screenshot failed: simulator not available (${simulatorError}), ` +
            `and runtime bridge not connected. Add <ExpoMCPDevTools /> to your layout.`
        );
      }
    }
  );

  server.registerTool(
    'automation_find_view',
    {
      title: 'Find view properties',
      description:
        'Find view and dump its properties. Works on simulators and physical devices.',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        testID: z.string().describe('React Native testID of the view to inspect'),
      },
    },
    async ({ projectRoot, platform, testID }) => {
      // Try simulator first
      try {
        const { automation } = await getAutomationContext(projectRoot, platform);
        const result = await automation.findViewByTestIDAsync(testID);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (simulatorError) {
        // Fallback: runtime bridge — search fiber tree
        if (runtimeClient.isConnected) {
          const tree = await runtimeClient.request('get_tree');
          const found = findInTree(tree.elements, testID);
          if (found) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true, data: found }) }],
            };
          }
        }
        throw simulatorError;
      }
    }
  );
}
