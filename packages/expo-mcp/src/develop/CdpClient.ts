import createDebug from 'debug';
import { WebSocket } from 'ws';

const debug = createDebug('expo-mcp:develop:CdpClient');

export interface CdpTarget {
  id: string;
  appId: string;
  deviceName: string;
  description: string;
  type: string;
  title: string;
  devtoolsFrontendUrl: string;
  webSocketDebuggerUrl: string;
  reactNative?: {
    capabilities?: {
      nativePageReloads?: boolean;
      [key: string]: unknown;
    };
    logicalDeviceId: string;
  };
  [key: string]: unknown;
}

export type CdpTargetSelector = (targets: CdpTarget[]) => Promise<CdpTarget | null>;

export interface CdpClientOptions {
  metroUrl: string;
  targetSelector?: CdpTargetSelector;
  createWebSocket?: (url: string) => WebSocket;
}

export class CdpClient {
  private resolvedWebSocketDebuggerUrl?: string;

  constructor(private readonly options: CdpClientOptions) {}

  private async listTargetsAsync(): Promise<CdpTarget[]> {
    const response = await fetch(`${this.options.metroUrl}/json/list`);
    if (!response.ok) {
      throw new Error(`Failed to fetch debugger targets: ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Unexpected debugger targets payload: expected an array.');
    }

    return data as CdpTarget[];
  }

  private async resolveWebSocketDebuggerUrlAsync(): Promise<string> {
    if (this.resolvedWebSocketDebuggerUrl) {
      return this.resolvedWebSocketDebuggerUrl;
    }

    const targets = await this.listTargetsAsync();
    const selector = this.options.targetSelector ?? defaultTargetSelector;
    const target = await selector(targets);
    if (!target) {
      throw new Error('No target found.');
    }
    this.resolvedWebSocketDebuggerUrl = target.webSocketDebuggerUrl;
    return this.resolvedWebSocketDebuggerUrl;
  }

  async createWebSocketAsync(): Promise<WebSocket> {
    const webSocketDebuggerUrl = await this.resolveWebSocketDebuggerUrlAsync();
    const factory = this.options.createWebSocket ?? ((url: string) => new WebSocket(url));

    try {
      return factory(webSocketDebuggerUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create CDP WebSocket connection: ${message}`);
    }
  }

  getWebSocketDebuggerUrl(): string {
    return this.resolvedWebSocketDebuggerUrl ?? '';
  }
}

const HIDE_FROM_INSPECTOR_ENV = 'globalThis.__expo_hide_from_inspector__';

const defaultTargetSelector: CdpTargetSelector = async (targets) => {
  for (const target of targets) {
    const capabilities = target.reactNative?.capabilities ?? {};
    if (capabilities.nativePageReloads !== true) {
      continue;
    }
    try {
      const hideFromInspector =
        (await evaluateJsFromCdpAsync(target.webSocketDebuggerUrl, HIDE_FROM_INSPECTOR_ENV)) !==
        undefined;
      if (hideFromInspector) {
        continue;
      }
    } catch (e: unknown) {
      // If we can't evaluate the JS, we just ignore the error and skips the target.
      debug(`Can't evaluate the JS on the app:`, JSON.stringify(e, null, 2));
      continue;
    }
    return target;
  }
  return null;
};

/**
 * Evaluates JavaScript code in the CDP
 */
export function evaluateJsFromCdpAsync(
  webSocketDebuggerUrl: string,
  source: string,
  timeoutMs: number = 2000,
  options?: { createWebSocket?: (url: string) => WebSocket }
): Promise<string | undefined> {
  const REQUEST_ID = 0;
  let timeoutHandle: NodeJS.Timeout;

  return new Promise((resolve, reject) => {
    let settled = false;
    const factory = options?.createWebSocket ?? ((url: string) => new WebSocket(url));
    const ws = factory(webSocketDebuggerUrl);

    timeoutHandle = setTimeout(() => {
      debug(`[evaluateJsFromCdpAsync] Request timeout from ${webSocketDebuggerUrl}`);
      reject(new Error('Request timeout'));
      settled = true;
      ws.close();
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          id: REQUEST_ID,
          method: 'Runtime.evaluate',
          params: { expression: source },
        })
      );
    });

    ws.on('error', (e) => {
      debug(`[evaluateJsFromCdpAsync] Failed to connect ${webSocketDebuggerUrl}`, e);
      reject(e);
      settled = true;
      clearTimeout(timeoutHandle);
      ws.close();
    });

    ws.on('close', () => {
      if (!settled) {
        reject(new Error('WebSocket closed before response was received.'));
        clearTimeout(timeoutHandle);
      }
    });

    ws.on('message', (data) => {
      debug(
        `[evaluateJsFromCdpAsync] message received from ${webSocketDebuggerUrl}: ${data.toString()}`
      );
      try {
        const response = JSON.parse(data.toString());
        if (response.id === REQUEST_ID) {
          if (response.error) {
            reject(new Error(response.error.message));
          } else if (response.result.result.type === 'string') {
            resolve(response.result.result.value);
          } else {
            resolve(undefined);
          }
          settled = true;
          clearTimeout(timeoutHandle);
          ws.close();
        }
      } catch (e) {
        reject(e);
        settled = true;
        clearTimeout(timeoutHandle);
        ws.close();
      }
    });
  });
}
