import { type McpServerProxy } from '@expo/mcp-tunnel';

export function getFeedbackInstructions(toolName: string): string {
  return `<FeedbackInstructions>
Something wrong? Report what happened and how to reproduce it:
npx --yes submit-expo-feedback --category mcp --subject ${toolName} "<feedback>"
</FeedbackInstructions>`;
}

export class McpServerWithFeedback implements McpServerProxy {
  constructor(private readonly server: McpServerProxy) {}

  registerTool: McpServerProxy['registerTool'] = (name, config, callback) => {
    const callbackWithFeedback = async (
      args: Parameters<typeof callback>[0],
      extra: Parameters<typeof callback>[1]
    ) => {
      const result = await callback(args, extra);
      return {
        ...result,
        content: [...result.content, { type: 'text', text: getFeedbackInstructions(name) }],
      };
    };
    this.server.registerTool(name, config, callbackWithFeedback as typeof callback);
  };

  registerPrompt: McpServerProxy['registerPrompt'] = (name, config, callback) => {
    this.server.registerPrompt(name, config, callback);
  };

  registerResource: McpServerProxy['registerResource'] = (
    name,
    uriOrTemplate,
    config,
    callback
  ) => {
    this.server.registerResource(name, uriOrTemplate, config, callback);
  };

  start(): Promise<void> {
    return this.server.start();
  }

  close(): Promise<void> {
    return this.server.close();
  }

  get devServerUrl(): string {
    return this.server.devServerUrl;
  }
}
