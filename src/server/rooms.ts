import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { Store } from './store.js';
import { MAX_TEXT, MAX_UPDATE, type ClientFrame, type ServerFrame, type User } from '../shared.js';

type Peer = {
  socket: WebSocket;
  user: User;
  token: string;
  clients: Set<number>;
  messages: number;
  window: number;
};
type Room = { doc: Y.Doc; awareness: Awareness; peers: Set<Peer> };
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
function bytes(value: unknown) {
  if (typeof value !== 'string' || value.length > MAX_UPDATE * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('Invalid or oversized binary payload');
  return Buffer.from(value, 'base64');
}
export class Rooms {
  readonly rooms = new Map<string, Room>();
  constructor(readonly store: Store) {}
  send(peer: Peer, value: ServerFrame) {
    if (peer.socket.readyState === WebSocket.OPEN) {
      if (peer.socket.bufferedAmount > 2 * 1024 * 1024)
        peer.socket.close(1013, 'Slow connection; reconnect to resync');
      else peer.socket.send(JSON.stringify(value));
    }
  }
  room(id: string) {
    let room = this.rooms.get(id);
    if (room) return room;
    if (this.rooms.size >= 100) throw new Error('Active document limit reached');
    const doc = this.store.load(id),
      awareness = new Awareness(doc);
    awareness.setLocalState(null);
    room = { doc, awareness, peers: new Set() };
    this.rooms.set(id, room);
    const active = room;
    awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const data = base64(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
        for (const peer of active.peers) this.send(peer, { type: 'presence', data });
      },
    );
    return room;
  }
  connect(id: string, socket: WebSocket, user: User, token: string) {
    const room = this.room(id),
      peer: Peer = { socket, user, token, clients: new Set(), messages: 0, window: Date.now() };
    if (room.peers.size >= 50) {
      socket.close(1013, 'Document connection limit reached');
      return;
    }
    room.peers.add(peer);
    const role = this.store.role(id, user.id)!;
    this.send(peer, {
      type: 'welcome',
      user,
      role,
      state: base64(Y.encodeStateAsUpdate(room.doc)),
      vector: base64(Y.encodeStateVector(room.doc)),
      revision: this.store.row(id)!.revision,
    });
    if (room.awareness.getStates().size)
      this.send(peer, {
        type: 'presence',
        data: base64(encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()])),
      });
    socket.on('message', (raw, isBinary) => {
      try {
        if (!this.store.authenticate(token)) {
          socket.close(4401, 'Session expired');
          return;
        }
        const currentRole = this.store.role(id, user.id);
        if (!currentRole) {
          socket.close(4403, 'Access revoked');
          return;
        }
        if (Date.now() - peer.window > 1000) {
          peer.messages = 0;
          peer.window = Date.now();
        }
        if (++peer.messages > 100) throw new Error('Update rate exceeded');
        if (isBinary) throw new Error('JSON frames required');
        const frame = JSON.parse(raw.toString()) as ClientFrame;
        if (frame.type === 'hello') {
          this.send(peer, {
            type: 'update',
            data: base64(Y.encodeStateAsUpdate(room.doc, bytes(frame.vector))),
            revision: this.store.row(id)!.revision,
          });
        } else if (frame.type === 'update') {
          if (currentRole === 'viewer') {
            this.send(peer, { type: 'error', message: 'Read-only access: changes were not accepted' });
            return;
          }
          if (typeof frame.id !== 'string' || !/^[\w-]{1,100}$/.test(frame.id))
            throw new Error('Invalid message ID');
          const update = bytes(frame.data);
          if (update.length > MAX_UPDATE) throw new Error('Update too large');
          const candidate = new Y.Doc();
          let state: Uint8Array;
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            Y.applyUpdate(candidate, update);
            if (
              candidate.share.size > 1 ||
              [...candidate.share.keys()].some((key) => key !== 'content') ||
              candidate.getText('content').length > MAX_TEXT
            )
              throw new Error('Document content limit exceeded');
            state = Y.encodeStateAsUpdate(candidate);
            if (state.length > 2 * 1024 * 1024) throw new Error('Document state exceeds 2 MiB');
          } finally {
            candidate.destroy();
          }
          if (Buffer.from(state).equals(Buffer.from(Y.encodeStateAsUpdate(room.doc)))) {
            this.send(peer, { type: 'ack', id: frame.id, revision: this.store.row(id)!.revision });
            return;
          }
          // Commit before acknowledging or broadcasting. A retry after a crash is idempotent.
          const saved = this.store.append(id, frame.id, user.name, update, state);
          if (!saved.duplicate) {
            Y.applyUpdate(room.doc, update, peer);
            for (const other of room.peers)
              if (other !== peer)
                this.send(other, { type: 'update', data: frame.data, revision: saved.revision });
          }
          this.send(peer, { type: 'ack', id: frame.id, revision: saved.revision });
        } else if (frame.type === 'presence') {
          const data = bytes(frame.data);
          if (data.length > 16 * 1024) throw new Error('Presence too large');
          const decoder = decoding.createDecoder(data),
            count = decoding.readVarUint(decoder);
          if (count > 5) throw new Error('Too many presence entries');
          for (let i = 0; i < count; i++) {
            const client = decoding.readVarUint(decoder);
            decoding.readVarUint(decoder);
            const state = JSON.parse(decoding.readVarString(decoder));
            if (
              !peer.clients.has(client) &&
              [...room.peers].some((other) => other !== peer && other.clients.has(client))
            )
              throw new Error('Presence identity already connected');
            if (
              state !== null &&
              (!state.user || state.user.name !== user.name || !/^#[a-f0-9]{6}$/i.test(state.user.color))
            )
              throw new Error('Presence must match the signed-in user and a valid color');
            peer.clients.add(client);
            if (peer.clients.size > 3) throw new Error('Presence client limit exceeded');
          }
          applyAwarenessUpdate(room.awareness, data, peer);
        } else if (frame.type === 'ping') this.send(peer, { type: 'pong' });
        else throw new Error('Unknown frame type');
      } catch (error) {
        this.send(peer, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Message rejected',
        });
      }
    });
    socket.on('close', () => {
      room.peers.delete(peer);
      removeAwarenessStates(room.awareness, [...peer.clients], peer);
      if (!room.peers.size) {
        room.awareness.destroy();
        room.doc.destroy();
        this.rooms.delete(id);
      }
    });
    socket.on('error', () => socket.close());
  }
  revoke(id: string, userId: string) {
    for (const peer of this.rooms.get(id)?.peers ?? [])
      if (peer.user.id === userId) peer.socket.close(4403, 'Permissions changed; reopen the document');
  }
  expire() {
    for (const [id, room] of this.rooms)
      for (const peer of room.peers)
        if (!this.store.authenticate(peer.token) || !this.store.role(id, peer.user.id))
          peer.socket.close(4401, 'Session expired or access revoked');
  }
  close() {
    for (const room of this.rooms.values()) {
      for (const peer of room.peers) peer.socket.terminate();
      room.awareness.destroy();
      room.doc.destroy();
    }
    this.rooms.clear();
  }
}
