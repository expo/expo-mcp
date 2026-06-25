import createDebug from "debug";
import { WebSocket } from "ws";

const debug = createDebug("expo-mcp:runtime");
const PLUGIN_NAME = "expo-mcp-runtime";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class RuntimeClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private browserClientId = crypto.randomUUID();
  private readyResolvers: Array<() => void> = [];
  private ready = false;

  readonly devServerUrl: string;

  constructor(devServerUrl: string) {
    this.devServerUrl = devServerUrl;
  }

  /**
   * Connect to the devtools broadcast WebSocket.
   * This connects to Metro but doesn't mean the app is ready —
   * the app signals readiness by sending a "bridge_ready" message
   * when ExpoMCPDevTools mounts.
   */
  async connectAsync(): Promise<boolean> {
    try {
      const wsUrl = `${this.devServerUrl.replace("http", "ws")}/expo-dev-plugins/broadcast`;
      debug(`Connecting to devtools broadcast: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          debug("WebSocket connection timeout");
          this.ws?.close();
          resolve(false);
        }, 3000);

        this.ws!.on("open", () => {
          debug("WebSocket open, sending handshake");
          this.ws!.send(
            JSON.stringify({
              __isHandshakeMessages: true,
              pluginName: PLUGIN_NAME,
              method: "handshake",
              protocolVersion: 1,
              browserClientId: this.browserClientId,
            }),
          );
          this.setupMessageHandler();
          clearTimeout(timeout);
          this.connected = true;
          debug("WebSocket connected, waiting for app bridge_ready...");
          resolve(true);
        });

        this.ws!.on("error", (err) => {
          clearTimeout(timeout);
          debug("WebSocket connection error:", err.message);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Wait for the app to signal it's ready (ExpoMCPDevTools mounted).
   * Resolves immediately if already ready.
   */
  waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve);
    });
  }

  /**
   * Send a request to the app and wait for the response.
   */
  async request<T = any>(
    type: string,
    payload?: Record<string, any>,
    timeoutMs = 5000,
  ): Promise<T> {
    if (!this.isConnected) {
      throw new Error(
        "Runtime bridge not connected. Is the app running with expo-mcp/runtime?",
      );
    }

    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `Runtime request '${type}' timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout });

      this.ws!.send(
        JSON.stringify({
          messageKey: {
            pluginName: PLUGIN_NAME,
            method: type,
          },
          payload: {
            requestId,
            ...(payload ?? {}),
          },
        }),
      );
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.ready = false;
    for (const [id, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(new Error("Connection closed"));
    }
    this.pending.clear();
    this.ws?.close();
  }

  private setupMessageHandler(): void {
    this.ws!.on("message", (data) => {
      try {
        const raw = data.toString();
        const msg = JSON.parse(raw);

        // Skip handshake messages
        if (msg.__isHandshakeMessages) return;

        const messageKey = msg.messageKey;
        const payload = msg.payload;

        if (!messageKey || messageKey.pluginName !== PLUGIN_NAME) return;

        // App signals it's ready
        if (messageKey.method === "bridge_ready") {
          debug("App bridge_ready received");
          this.ready = true;
          for (const resolve of this.readyResolvers) {
            resolve();
          }
          this.readyResolvers = [];
          return;
        }

        // Response to a pending request
        if (payload?.requestId && this.pending.has(payload.requestId)) {
          const req = this.pending.get(payload.requestId)!;
          clearTimeout(req.timeout);
          this.pending.delete(payload.requestId);

          if (payload.error) {
            req.reject(new Error(payload.error));
          } else {
            req.resolve(payload.result);
          }
        }
      } catch (err) {
        debug("Failed to parse runtime message:", err);
      }
    });

    this.ws!.on("close", () => {
      debug("Runtime bridge disconnected");
      this.connected = false;
      this.ready = false;
    });
  }
}
