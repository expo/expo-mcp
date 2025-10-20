import { $ } from 'zx';

/**
 * Find the URL of the Expo dev server for the given project root.
 */
export async function findDevServerUrlAsync(projectRoot: string): Promise<URL | null> {
  const lsofOutput = await $`lsof -i TCP -s TCP:LISTEN -n -P | grep node`;
  const lines = lsofOutput.stdout.trim().split('\n');

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[1];
    const portInfo = parts[8]; // Usually in format *:PORT

    const { exitCode } = await $`lsof -P -n -p ${pid} | grep 'cwd.*${projectRoot}'`
      .nothrow()
      .quiet();
    if (exitCode !== 0) {
      continue;
    }

    const psOutput = await $`ps -p ${pid} -o args=`;
    const command = psOutput.stdout.trim();

    if (command.includes('expo start')) {
      const portMatch = portInfo.match(/:(\d+)/);
      if (portMatch) {
        return new URL(`http://localhost:${portMatch[1]}`);
      }
    }
  }
  return null;
}

/**
 * Open the React Native DevTools for the given appId and project root.
 */
export async function openDevtoolsAsync({
  appId,
  devServerUrl,
}: {
  appId: string;
  devServerUrl: URL;
}): Promise<void> {
  await fetch(`${devServerUrl.toString()}_expo/debugger?appId=${appId}`, {
    method: 'PUT',
  });
}
