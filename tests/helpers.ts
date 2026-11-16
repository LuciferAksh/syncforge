import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../src/server/app.js';
import type { ServerFrame, User } from '../src/shared.js';
export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export async function until(
  predicate: () => unknown,
  message = 'Condition was not satisfied',
  timeout = 8000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}
export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'syncforge-test-')),
    path = join(directory, 'state.db');
  let app = createApp(path),
    port = await app.start(0);
  const peers: Peer[] = [];
  const request = async (route: string, method = 'GET', body?: unknown, cookie = '') => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json() };
  };
  const register = async (username: string) => {
    const result = await request('/api/register', 'POST', {
      username,
      name: username.toUpperCase(),
      password: 'strong-test-password-2026',
    });
    assert.equal(result.response.status, 201);
    return { user: result.data as User, cookie: result.response.headers.get('set-cookie')!.split(';')[0] };
  };
  return {
    path,
    request,
    register,
    get app() {
      return app;
    },
    get port() {
      return port;
    },
    peer: (id: string, cookie: string) => {
      const peer = new Peer(() => port, id, cookie);
      peers.push(peer);
      return peer;
    },
    restart: async () => {
      await app.close();
      app = createApp(path);
      port = await app.start(0);
    },
    cleanup: async () => {
      for (const peer of peers) peer.destroy();
      await app.close();
      assert.equal(realpathSync(dirname(directory)), realpathSync(tmpdir()));
      assert.ok(basename(directory).startsWith('syncforge-test-'));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
export class Peer {
  readonly doc = new Y.Doc();
  socket?: WebSocket;
  frames: ServerFrame[] = [];
  pending = new Set<string>();
  closedCode: number | null = null;
  welcomes = 0;
  constructor(
    readonly port: () => number,
    readonly id: string,
    readonly cookie: string,
  ) {
    this.doc.on('update', (update, origin) => {
      if (origin !== 'server' && this.socket?.readyState === WebSocket.OPEN) this.sendUpdate(update);
    });
  }
  sendUpdate(update: Uint8Array, id = crypto.randomUUID()) {
    if (update.length <= 2) return;
    this.pending.add(id);
    this.send({ type: 'update', id, data: b64(update) });
    return id;
  }
  send(value: unknown) {
    this.socket?.send(JSON.stringify(value));
  }
  async connect() {
    const prior = this.welcomes;
    this.closedCode = null;
    const socket = new WebSocket(`ws://127.0.0.1:${this.port()}/sync/${this.id}`, {
      headers: { Cookie: this.cookie, Origin: `http://127.0.0.1:${this.port()}` },
    });
    this.socket = socket;
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as ServerFrame;
      this.frames.push(frame);
      if (frame.type === 'welcome') {
        Y.applyUpdate(this.doc, Buffer.from(frame.state, 'base64'), 'server');
        this.welcomes++;
        if (frame.role !== 'viewer')
          this.sendUpdate(Y.encodeStateAsUpdate(this.doc, Buffer.from(frame.vector, 'base64')));
      } else if (frame.type === 'update')
        Y.applyUpdate(this.doc, Buffer.from(frame.data, 'base64'), 'server');
      else if (frame.type === 'ack') this.pending.delete(frame.id);
    });
    socket.on('close', (code) => {
      this.closedCode = code;
    });
    socket.on('error', () => {});
    await until(() => this.welcomes > prior, 'WebSocket welcome not received');
    await this.flush();
  }
  async flush() {
    await until(() => this.pending.size === 0, 'Update was not durably acknowledged');
  }
  async disconnect() {
    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
      await until(() => socket.readyState === WebSocket.CLOSED);
    }
    this.socket = undefined;
    this.pending.clear();
  }
  get text() {
    return this.doc.getText('content');
  }
  destroy() {
    this.socket?.terminate();
    this.doc.destroy();
  }
}
