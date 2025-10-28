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

  server.registerTool(
    'eas_workflow_create',
    {
      title: 'Create EAS workflow',
      description: 'Create an EAS workflow YAML file in .eas/workflows/ for building, submitting, or updating your Expo app',
      inputSchema: {
        projectRoot: z.string(),
        workflowName: z.string().describe('Name of the workflow file (without .yml extension)'),
        platform: z.enum(['android', 'ios', 'both']).optional(),
        jobType: z.enum(['build', 'submit', 'update']).optional(),
      },
    },
    async ({ projectRoot, workflowName, platform, jobType }) => {
      try {
        const responses: { type: 'text'; text: string }[] = [];

        await within(async () => {
          $.cwd = projectRoot;
          await $`mkdir -p .eas/workflows`;
        });

        const platformType = platform ?? 'both';
        const type = jobType ?? 'build';

        let workflowContent = `name: ${workflowName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}\njobs:\n`;

        if (platformType === 'both' || platformType === 'android') {
          workflowContent += `  ${type}_android:\n    type: ${type}\n    params:\n      platform: android\n`;
        }

        if (platformType === 'both' || platformType === 'ios') {
          workflowContent += `  ${type}_ios:\n    type: ${type}\n    params:\n      platform: ios\n`;
        }

        const workflowPath = `${projectRoot}/.eas/workflows/${workflowName}.yml`;
        await fs.promises.writeFile(workflowPath, workflowContent);

        responses.push({ type: 'text', text: `Created workflow at .eas/workflows/${workflowName}.yml` });
        responses.push({ type: 'text', text: `Run with: npx eas-cli workflow:run ${workflowName}.yml` });

        return { content: responses };
      } catch (e: unknown) {
        return {
          content: [{ type: 'text', text: `Failed to create workflow: ${e}` }]
        };
      }
    }
  );

  server.registerTool(
    'eas_workflow_validate',
    {
      title: 'Validate EAS workflow',
      description: 'Validate an EAS workflow YAML file before running it',
      inputSchema: {
        projectRoot: z.string(),
        workflowFile: z.string().describe('Name of the workflow file (e.g., build-production.yml)'),
      },
    },
    async ({ projectRoot, workflowFile }) => {
      try {
        const workflowPath = `${projectRoot}/.eas/workflows/${workflowFile}`;
        const exists = await fs.promises.access(workflowPath).then(() => true).catch(() => false);

        if (!exists) {
          return {
            content: [{ type: 'text', text: `Workflow file not found: .eas/workflows/${workflowFile}` }]
          };
        }

        const content = await fs.promises.readFile(workflowPath, 'utf-8');

        return {
          content: [
            { type: 'text', text: `Workflow file found: .eas/workflows/${workflowFile}` },
            { type: 'text', text: `\nContent:\n${content}` },
            { type: 'text', text: `\nTo run: npx eas-cli workflow:run ${workflowFile}` }
          ]
        };
      } catch (e: unknown) {
        return {
          content: [{ type: 'text', text: `Failed to validate workflow: ${e}` }]
        };
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
