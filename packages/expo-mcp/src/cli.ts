import { CompositeMcpServerProxy, StdioMcpServerProxy } from '@expo/mcp-tunnel';
import { minimist } from 'zx';

import packageJson from '../package.json' with { type: 'json' };
import { addMcpCapabilities } from './index.js';
import { resolveProjectRoot } from './utils.js';

const args = minimist(process.argv.slice(2), {
  string: ['root', 'mcp-server-url', 'dev-server-url'],
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

const server = args['mcp-server-url']
  ? new CompositeMcpServerProxy({
      tunnelServerUrl: args['mcp-server-url'],
      projectRoot,
      devServerUrl,
      stdioMcpServerName: packageJson.name,
      stdioMcpServerVersion: packageJson.version,
    })
  : new StdioMcpServerProxy({
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

Examples:
  # Start as stdio server (default)
  ${programName} --dev-server-url http://localhost:8081
`);
}

//#endregion Internals
