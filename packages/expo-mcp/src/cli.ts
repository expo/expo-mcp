import { CompositeMcpServerProxy, StdioMcpServerProxy } from '@expo/mcp-tunnel';
import assert from 'node:assert';
import { minimist } from 'zx';

import packageJson from '../package.json' with { type: 'json' };
import { createLogCollector } from './develop/LogCollectorFactory.js';
import { addMcpCapabilities } from './index.js';
import { resolveProjectRoot } from './utils.js';

const args = minimist(process.argv.slice(2), {
  string: ['root', 'mcp-server-url', 'dev-server-url', 'app-id', 'platform', 'collect-logs'],
  boolean: ['help', 'version'],
  alias: {
    h: 'help',
    v: 'version',
  },
});
const programName = packageJson.name;
const projectRoot = (args.root as string | undefined) ?? resolveProjectRoot();
const devServerUrl: string | undefined = args['dev-server-url'];

if (args.help) {
  showHelp(programName);
  process.exit(0);
}
if (args.version) {
  console.log(packageJson.version);
  process.exit(0);
}
if (!devServerUrl) {
  console.error(`Error: required option '--dev-server-url <devServerUrl>' not specified`);
  process.exit(1);
}

if (typeof args['collect-logs'] === 'string') {
  const durationMs = args['collect-logs'] ? Number(args['collect-logs']) : 5000;
  const appId = args['app-id'];
  const platform = args['platform'];
  assert(appId, 'App ID is required');
  assert(platform, 'Platform is required');
  const logCollector = createLogCollector({
    iosSimulator: platform === 'ios' ? { bundleIdentifier: appId, durationMs } : undefined,
    android: platform === 'android' ? { appId, durationMs } : undefined,
    cdp: { metroUrl: devServerUrl, durationMs },
  });
  const logs = await logCollector.collectAsync();
  console.log(logs);
  process.exit(0);
}

const server =
  args['mcp-server-url'] && args['dev-server-url']
    ? new CompositeMcpServerProxy({
        tunnelServerUrl: args['mcp-server-url'],
        projectRoot,
        devServerUrl,
        stdioMcpServerName: packageJson.name,
        stdioMcpServerVersion: packageJson.version,
      })
    : new StdioMcpServerProxy({
        devServerUrl,
        mcpServerName: packageJson.name,
        mcpServerVersion: packageJson.version,
      });

addMcpCapabilities(server, projectRoot);

await server.start();

//#region Internals

function showHelp(programName: string) {
  console.log(`\
Usage: ${programName} [options]

Options:
  -h, --help                          Show help
  -v, --version                       Show version
  --dev-server-url <devServerUrl>     The URL of the running Expo dev server
  --mcp-server-url <mcpServerUrl>     The URL of the MCP tunnel server to connect to
  --root <projectRoot>                The project root directory (default: current working directory)
  --app-id <appId>                    The app ID
  --platform <platform>               The target platform
  --collect-logs <durationMs>         To collect logs from the app for the given duration in milliseconds (default: 5000)

Examples:
  # Start as stdio server (default)
  ${programName} --dev-server-url <devServerUrl>
`);
}

//#endregion Internals
