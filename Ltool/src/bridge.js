import { WebSocketServer, WebSocket } from 'ws';

export class ExtensionBridge {
  constructor({ port = 9527, token = '', requestTimeoutMs = 360000, clientName = 'Ltool CLI' } = {}) {
    this.port = port;
    this.token = token;
    this.clientName = clientName;
    this.requestTimeoutMs = requestTimeoutMs;
    this.wss = null;
    this.client = null;
    this.pending = new Map();
    this.connectionResolvers = [];
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port });
      this.wss.once('listening', resolve);
      this.wss.once('error', reject);
      this.wss.on('connection', (ws) => {
        this.client = ws;
        ws.on('message', (data) => this.handleMessage(data.toString()));
        ws.on('close', () => {
          if (this.client === ws) this.client = null;
        });
        for (const resolver of this.connectionResolvers.splice(0)) resolver();
      });
    });
  }

  async stop() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge stopped'));
    }
    this.pending.clear();
    if (this.client && this.client.readyState === WebSocket.OPEN) this.client.close();
    this.client = null;
    await new Promise((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
      this.wss = null;
    });
  }

  isConnected() {
    return Boolean(this.client && this.client.readyState === WebSocket.OPEN);
  }

  async waitForConnection(timeoutMs = 30000) {
    if (this.isConnected()) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectionResolvers = this.connectionResolvers.filter((fn) => fn !== wrapped);
        reject(new Error(`Chrome extension not connected within ${timeoutMs}ms`));
      }, timeoutMs);
      const wrapped = () => {
        clearTimeout(timer);
        resolve();
      };
      this.connectionResolvers.push(wrapped);
    });
  }

  request(method, params = {}) {
    if (!this.isConnected()) throw new Error('Chrome extension is not connected');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      id,
      method,
      token: this.token,
      client: { name: this.clientName, pid: process.pid, startedAt: new Date().toISOString() },
      params,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.client.send(JSON.stringify(payload));
    });
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || message.error));
    else pending.resolve(message.result);
  }
}
