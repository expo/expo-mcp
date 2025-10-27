export class MockWebSocket {
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    setImmediate(() => {
      this.trigger('open');
    });
  }

  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  send(data: string) {
    // Mock send method
  }

  close(code?: number, reason?: string) {
    this.trigger('close', code ?? 1000, reason ?? 'Normal Closure');
  }

  private trigger(event: string, ...args: any[]) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }
}
