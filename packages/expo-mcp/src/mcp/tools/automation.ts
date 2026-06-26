import { type McpServerProxy } from '@expo/mcp-tunnel';
import fs from 'node:fs';
import { z } from 'zod';
import { tmpfile } from 'zx';

import { platformInput, projectRootInput } from './schemas.js';
import type { IAutomation } from '../../automation/Automation.types.js';
import { AutomationFactory } from '../../automation/AutomationFactory.js';
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

export function addAutomationTools(server: McpServerProxy, projectRoot: string) {
  server.registerTool(
    'automation_tap',
    {
      title: 'Tap on device',
      description:
        'Tap on the running app at the given screen coordinates (x, y) or on the view with the given React Native testID. Provide either both x and y, or testID. Prefer testID when available, as it is resilient to layout changes.',
      inputSchema: {
        projectRoot: projectRootInput,
        platform: platformInput,
        x: z.number().optional().describe('X coordinate for tap (required if testID not provided)'),
        y: z.number().optional().describe('Y coordinate for tap (required if testID not provided)'),
        testID: z
          .string()
          .optional()
          .describe('React Native testID of the view to tap (alternative to x,y coordinates)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectRoot, platform, x, y, testID }) => {
      if (testID) {
        const { automation } = await getAutomationContext(projectRoot, platform);
        const result = await automation.tapByTestIDAsync(testID);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } else if (x !== undefined && y !== undefined) {
        const { automation } = await getAutomationContext(projectRoot, platform);
        const result = await automation.tapAsync({ x, y });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } else {
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
    }
  );

  server.registerTool(
    'automation_take_screenshot',
    {
      title: 'Take screenshot of the app',
      description:
        'Take a screenshot of the running app — the full screen, or a specific view if a React Native testID is provided. Use this to visually verify the current UI state.',
      inputSchema: {
        projectRoot: projectRootInput,
        platform: platformInput,
        testID: z
          .string()
          .optional()
          .describe(
            'React Native testID of the view to screenshot (if not provided, takes full screen)'
          ),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectRoot, platform, testID }) => {
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
    }
  );

  server.registerTool(
    'automation_find_view',
    {
      title: 'Find view properties',
      description:
        'Find a view by its React Native testID and return its properties (position, size, and visibility). Use this to verify a view rendered correctly, or to obtain coordinates before calling automation_tap.',
      inputSchema: {
        projectRoot: projectRootInput,
        platform: platformInput,
        testID: z.string().describe('React Native testID of the view to inspect'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectRoot, platform, testID }) => {
      const { automation } = await getAutomationContext(projectRoot, platform);
      const result = await automation.findViewByTestIDAsync(testID);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );
}
