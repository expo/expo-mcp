import { CompositeMcpServerProxy, StdioMcpServerProxy } from '@expo/mcp-tunnel';
import { minimist } from 'zx';

import packageJson from '../package.json' with { type: 'json' };
import { addMcpCapabilities } from './index.js';
import { resolveProjectRoot } from './utils.js';

const args = minimist(process.argv.slice(2), {
  string: ['root', 'mcp-server-url'],
  boolean: ['help', 'version'],
  alias: {
    h: 'help',
    v: 'version',
  },
});
const programName = packageJson.name;
const projectRoot = args.root ?? resolveProjectRoot();

if (args.help) {
  showHelp(programName);
  process.exit(0);
}
if (args.version) {
  console.log(packageJson.version);
  process.exit(0);
}

const server = args['mcp-server-url']
  ? new CompositeMcpServerProxy({
      tunnelServerUrl: args['mcp-server-url'],
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
  -h, --help                Show help
  -v, --version             Show version
  --root                    The project root directory
  --mcp-server-url          The URL of the MCP tunnel server to connect to

Examples:
  # Start as stdio server (default)
  ${programName}
`);
}

//#endregion Internals
