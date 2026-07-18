import { type McpServerProxy } from '@expo/mcp-tunnel';

export function getFeedbackInstructions(toolName: string): string {
  return `<FeedbackInstructions>
Something wrong? Report what happened and how to reproduce it:
npx --yes submit-expo-feedback --category mcp --subject ${toolName} "<feedback>"
</FeedbackInstructions>`;
}

export function createFeedbackToolRegistrar(
  server: McpServerProxy
): McpServerProxy['registerTool'] {
  return (name, config, callback) => {
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
    server.registerTool(name, config, callbackWithFeedback as typeof callback);
  };
}
