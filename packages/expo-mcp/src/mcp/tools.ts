import { type McpServerProxy } from '@expo/mcp-tunnel';
import fs from 'node:fs';
import { z } from 'zod';
import { $, tmpfile, within } from 'zx';

import { AutomationFactory } from '../automation/AutomationFactory.js';
import { findDevServerUrlAsync, openDevtoolsAsync } from '../develop/devtools.js';
import { resizeImageToMaxSizeAsync } from '../imageUtils.js';
import { isExpoRouterProject } from '../project.js';

export function addMcpTools(server: McpServerProxy, projectRoot: string) {
  const isRouterProject = isExpoRouterProject(projectRoot);
  if (isRouterProject) {
    server.registerTool(
      'expo_router_sitemap',
      {
        title: 'Query the sitemap of the current expo-router project',
        description:
          'Query the all routes of the current expo-router project. This is useful if you were using expo-router and want to know all the routes of the app',
      },
      async () => {
        const sitemap = await within(async () => {
          $.cwd = projectRoot;
          const { stdout } = await $`npx -y expo-router-sitemap@latest`.nothrow();
          return stdout;
        });
        return { content: [{ type: 'text', text: sitemap }] };
      }
    );
  }

  server.registerTool(
    'open_devtools',
    {
      title: 'Open devtools',
      description: 'Open the React Native DevTools',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
      },
    },
    async ({ projectRoot, platform: platformParam }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      try {
        const responses: { type: 'text'; text: string }[] = [];
        const devServerUrl = await findDevServerUrlAsync(projectRoot);
        if (!devServerUrl) {
          return { content: [{ type: 'text', text: 'No dev server found' }] };
        }
        responses.push({ type: 'text', text: `Found dev server URL: ${devServerUrl.toString()}` });
        await openDevtoolsAsync({ appId, devServerUrl });
        responses.push({ type: 'text', text: `Opening devtools for ${appId}...` });
        return { content: responses };
      } catch (e: unknown) {
        return { content: [{ type: 'text', text: `Failed to open devtools: ${e}` }] };
      }
    }
  );

  //#region automation tools

  server.registerTool(
    'automation_tap',
    {
      title: 'Tap on device',
      description: 'Tap on the device at the given coordinates',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        x: z.number(),
        y: z.number(),
      },
    },
    async ({ projectRoot, platform: platformParam, x, y }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      const automation = AutomationFactory.create(platform, {
        appId,
        deviceId,
      });
      const result = await automation.tapAsync({ x, y });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    'automation_take_screenshot',
    {
      title: 'Take screenshot of the app',
      description:
        'Take screenshot of the app. This is useful to verify the app is visually correct',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
      },
    },
    async ({ projectRoot, platform: platformParam }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      const outputPath = `${tmpfile()}.png`;
      try {
        const automation = AutomationFactory.create(platform, {
          appId,
          deviceId,
        });
        await automation.takeFullScreenshotAsync({ outputPath });
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
    'automation_find_view_by_testid',
    {
      title: 'Find view properties by react-native testID',
      description:
        'Find view and dump its properties by react-native testID. This is useful to verify the view is rendered correctly',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        testID: z.string(),
      },
    },
    async ({ projectRoot, platform: platformParam, testID }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      const automation = AutomationFactory.create(platform, {
        appId,
        deviceId,
      });
      const result = await automation.findViewByTestIDAsync(testID);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    'automation_tap_by_testid',
    {
      title: 'Tap on the view by react-native testID',
      description:
        'Tap on the view specified by react-native testID. This is useful to interact with the view',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        testID: z.string(),
      },
    },
    async ({ projectRoot, platform: platformParam, testID }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      const automation = AutomationFactory.create(platform, {
        appId,
        deviceId,
      });
      const result = await automation.tapByTestIDAsync(testID);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    'automation_take_screenshot_by_testid',
    {
      title: 'Take screenshot of the app by react-native testID',
      description:
        'Take screenshot of the app by react-native testID. This is useful to verify the view is rendered correctly',
      inputSchema: {
        projectRoot: z.string(),
        platform: z.enum(['android', 'ios']).optional(),
        testID: z.string(),
      },
    },
    async ({ projectRoot, platform: platformParam, testID }) => {
      const platform = platformParam ?? (await AutomationFactory.guessCurrentPlatformAsync());
      const deviceId = await AutomationFactory.getBootedDeviceIdAsync(platform);
      const appId = await AutomationFactory.getAppIdAsync({ projectRoot, platform, deviceId });
      const outputPath = `${tmpfile()}.png`;
      try {
        const automation = AutomationFactory.create(platform, {
          appId,
          deviceId,
        });
        await automation.taksScreenshotByTestIDAsync({ testID, outputPath });
        const { buffer } = await resizeImageToMaxSizeAsync(outputPath);
        return {
          content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' }],
        };
      } finally {
        await fs.promises.rm(outputPath, { force: true });
      }
    }
  );

  //#endregion automation tools
}
