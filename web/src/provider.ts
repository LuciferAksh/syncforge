import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import type { ServerFrame, Role, User } from '../../src/shared';
import { cacheGet, cacheMergeDocument } from './cache';

export interface SyncState {
  ready: boolean;
  hasCopy: boolean;
  status: 'connecting' | 'connected' | 'offline' | 'paused' | 'blocked';
  role: Role;
  pending: number;
  revision: number | null;
  sent: number;
  received: number;
  localSaved: boolean;
  storageError: string | null;
  error: string | null;
  lastAck: number | null;
  events: { at: number; text: string }[];
}
const encode = (data: Uint8Array) => {
  let text = '';
  for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
};
const decode = (data: string) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
export class SyncProvider {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private state: SyncState;
  private listeners = new Set<() => void>();
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending = new Set<string>();
  private paused = false;
  private closed = false;
  private attempt = 0;
  private writes = Promise.resolve();
  private saveGeneration = 0;
  constructor(
    readonly id: string,
    readonly user: User,
    role: Role,
  ) {
    this.state = {
      ready: false,
      hasCopy: false,
      status: 'connecting',
      role,
      pending: 0,
      revision: null,
      sent: 0,
      received: 0,
      localSaved: false,
      storageError: null,
      error: null,
      lastAck: null,
      events: [],
    };
    const colors = ['#ce623e', '#477e76', '#8e6eb2', '#507cba'];
    this.awareness.setLocalStateField('user', {
      name: user.name,
      color: colors[this.doc.clientID % colors.length],
    });
    this.awareness.on('update', this.presence);
    void this.initialize();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private event(text: string) {
    this.set({ events: [{ at: Date.now(), text }, ...this.state.events].slice(0, 35) });
  }
  private async initialize() {
    try {
      const cached = await cacheGet<Uint8Array>(`document:${this.user.id}:${this.id}`);
      if (this.closed) return;
      if (cached) Y.applyUpdate(this.doc, cached, 'cache');
      this.set({ localSaved: !!cached, hasCopy: !!cached });
      this.event(cached ? 'Loaded the document from this device' : 'Device cache ready');
    } catch {
      this.set({ storageError: 'Browser storage is unavailable. Export your work before closing this tab.' });
    }
    if (this.closed) return;
    this.doc.on('update', this.update);
    this.set({ ready: true });
    this.connect();
  }
  private persist() {
    const generation = ++this.saveGeneration;
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    this.set({ localSaved: false });
    this.writes = this.writes
      .catch(() => {})
      .then(() => cacheMergeDocument(`document:${this.user.id}:${this.id}`, snapshot))
      .then(() => {
        if (!this.closed && generation === this.saveGeneration)
          this.set({ localSaved: true, storageError: null });
      })
      .catch(() => {
        if (!this.closed)
          this.set({
            storageError: 'Could not save to browser storage. Keep this tab open and export your document.',
          });
      });
  }
  private update = (data: Uint8Array, origin: unknown) => {
    this.persist();
    if (origin === 'server') return;
    if (this.state.role === 'viewer' || this.state.status === 'blocked') return;
    if (this.socket?.readyState === WebSocket.OPEN && this.state.status === 'connected')
      this.sendUpdate(data);
    else this.set({ pending: Math.max(1, this.state.pending) });
  };
  private sendUpdate(data: Uint8Array) {
    if (data.length <= 2) return;
    const id = crypto.randomUUID();
    this.pending.add(id);
    this.socket?.send(JSON.stringify({ type: 'update', id, data: encode(data) }));
    this.set({ pending: this.pending.size, sent: this.state.sent + data.length });
  }
  private presence = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (
      origin === 'server' ||
      ![...added, ...updated, ...removed].includes(this.doc.clientID) ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    this.socket.send(
      JSON.stringify({
        type: 'presence',
        data: encode(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])),
      }),
    );
  };
  connect = () => {
    if (this.closed || this.paused || !this.state.ready) return;
    clearTimeout(this.retry);
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return;
    this.set({ status: 'connecting', error: null });
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync/${this.id}`,
    );
    this.socket = ws;
    ws.onmessage = (event) => {
      if (ws !== this.socket || this.closed) return;
      try {
        const message = JSON.parse(event.data) as ServerFrame;
        if (message.type === 'welcome') {
          if (message.user.id !== this.user.id) {
            this.set({
              status: 'blocked',
              error: 'The signed-in account changed. Reload before continuing.',
            });
            ws.close();
            return;
          }
          Y.applyUpdate(this.doc, decode(message.state), 'server');
          this.set({ hasCopy: true });
          this.pending.clear();
          this.set({
            role: message.role,
            status: 'connected',
            revision: message.revision,
            pending: 0,
            received: this.state.received + decode(message.state).length,
          });
          this.attempt = 0;
          this.event('Connected. Exchanging missing document updates.');
          const missing = Y.encodeStateAsUpdate(this.doc, decode(message.vector));
          if (message.role !== 'viewer') this.sendUpdate(missing);
          else if (encode(Y.encodeStateAsUpdate(this.doc)) !== message.state) {
            this.set({
              status: 'blocked',
              error:
                'This cached draft may contain edits the server has not accepted. View-only access prevents uploading them. Export your draft before clearing its device copy.',
            });
          }
          this.presence({ added: [this.doc.clientID], updated: [], removed: [] }, 'local');
          this.persist();
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
          }, 10_000);
        } else if (message.type === 'update') {
          const data = decode(message.data);
          Y.applyUpdate(this.doc, data, 'server');
          this.set({ received: this.state.received + data.length, revision: message.revision });
          this.event('Received a committed remote update.');
        } else if (message.type === 'ack') {
          this.pending.delete(message.id);
          this.set({ pending: this.pending.size, revision: message.revision, lastAck: Date.now() });
          this.event(`Server committed revision ${message.revision}.`);
        } else if (message.type === 'presence')
          applyAwarenessUpdate(this.awareness, decode(message.data), 'server');
        else if (message.type === 'error') {
          this.set({ error: message.message });
          this.event(`Update rejected: ${message.message}`);
        }
      } catch {
        this.set({ error: 'Received an invalid sync message. Reconnect to recover.' });
      }
    };
    ws.onclose = (event) => {
      if (ws !== this.socket || this.closed) return;
      clearInterval(this.heartbeat);
      this.socket = undefined;
      const blocked = this.state.status === 'blocked' || [4401, 4403].includes(event.code);
      this.set({
        status: blocked ? 'blocked' : this.paused ? 'paused' : 'offline',
        error: blocked
          ? (this.state.error ?? event.reason ?? 'Access changed. Sign in or reopen this document.')
          : this.state.error,
      });
      removeAwarenessStates(
        this.awareness,
        [...this.awareness.getStates().keys()].filter((client) => client !== this.doc.clientID),
        'server',
      );
      this.event(
        blocked
          ? 'Server access ended. Local content remains exportable.'
          : this.paused
            ? 'Live sync paused. Edits stay on this device.'
            : 'Connection lost. Retrying with backoff.',
      );
      if (!this.paused && !blocked)
        this.retry = setTimeout(
          this.connect,
          Math.min(10_000, 700 * 2 ** this.attempt++) + Math.random() * 200,
        );
    };
    ws.onerror = () => {};
  };
  toggle = () => {
    this.paused = !this.paused;
    if (this.paused) {
      clearTimeout(this.retry);
      this.set({ status: 'paused' });
      this.socket?.close();
      this.event('Live sync paused. You can continue writing.');
    } else {
      this.event('Resuming sync.');
      this.connect();
    }
  };
  flush = () => this.writes;
  destroy = () => {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.doc.off('update', this.update);
    this.awareness.off('update', this.presence);
    this.socket?.close();
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
  };
}
