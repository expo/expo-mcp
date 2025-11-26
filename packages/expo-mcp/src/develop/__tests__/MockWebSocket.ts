import { EventEmitter } from 'node:events';

export class MockWebSocket extends EventEmitter {
  public readonly url: string;
  constructor(
    url: string,
    private readonly responder: (request: any, socket: MockWebSocket) => void
  ) {
    super();
    this.url = url;
    process.nextTick(() => this.emit('open'));
  }

  send(payload: string) {
    const request = JSON.parse(payload);
    setImmediate(() => this.responder(request, this));
  }

  close() {
    this.emit('close');
  }
}
