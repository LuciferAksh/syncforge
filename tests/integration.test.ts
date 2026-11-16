import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { fixture, until, b64 } from './helpers.js';

test('failed persistence does not acknowledge, mutate, or broadcast an update', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Atomic commit' }, owner.cookie);
    const a = f.peer(data.id, owner.cookie),
      b = f.peer(data.id, owner.cookie);
    await a.connect();
    await b.connect();
    const original = f.app.store.append.bind(f.app.store);
    f.app.store.append = () => {
      throw new Error('Simulated storage failure');
    };
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(a.doc));
    candidate.getText('content').insert(0, 'Must not leak');
    a.send({ type: 'update', id: 'storage-failure', data: b64(Y.encodeStateAsUpdate(candidate)) });
    await until(() => a.frames.some((frame) => frame.type === 'error'));
    assert.equal(b.text.toString(), '');
    assert.equal(f.app.rooms.rooms.get(data.id)!.doc.getText('content').toString(), '');
    assert.equal(f.app.store.row(data.id)!.revision, 0);
    assert.equal(a.frames.filter((frame) => frame.type === 'ack').length, 0);
    f.app.store.append = original;
    a.text.insert(0, 'Recovered');
    await a.flush();
    await until(() => b.text.toString() === 'Recovered');
    candidate.destroy();
  } finally {
    await f.cleanup();
  }
});

test('a reused delivery ID with different content is rejected instead of falsely acknowledged', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Delivery identity' }, owner.cookie);
    const a = f.peer(data.id, owner.cookie);
    await a.connect();
    const candidate = new Y.Doc();
    candidate.getText('content').insert(0, 'First');
    a.send({ type: 'update', id: 'collision', data: b64(Y.encodeStateAsUpdate(candidate)) });
    await until(() => a.frames.some((frame) => frame.type === 'ack'));
    candidate.getText('content').insert(5, ' second');
    a.send({ type: 'update', id: 'collision', data: b64(Y.encodeStateAsUpdate(candidate)) });
    await until(() => a.frames.some((frame) => frame.type === 'error'));
    assert.equal(f.app.store.row(data.id)!.revision, 1);
    assert.equal(f.app.rooms.rooms.get(data.id)!.doc.getText('content').toString(), 'First');
    candidate.destroy();
  } finally {
    await f.cleanup();
  }
});

test('two authenticated users converge after independent offline edits', async () => {
  const f = await fixture();
  try {
    const alex = await f.register('alex'),
      sam = await f.register('sam');
    const created = await f.request(
      '/api/documents',
      'POST',
      { title: 'Shared plan', text: 'Start\n' },
      alex.cookie,
    );
    const id = created.data.id;
    assert.equal(
      (
        await f.request(
          `/api/documents/${id}/members`,
          'POST',
          { username: 'sam', role: 'editor' },
          alex.cookie,
        )
      ).response.status,
      200,
    );
    const a = f.peer(id, alex.cookie),
      b = f.peer(id, sam.cookie);
    await a.connect();
    await b.connect();
    await b.disconnect();
    a.text.insert(a.text.length, 'Alex online\n');
    b.text.insert(b.text.length, 'Sam offline\n');
    await a.flush();
    await b.connect();
    await until(() => a.text.toString() === b.text.toString(), 'Peers did not converge');
    assert.ok(a.text.toString().includes('Alex online'));
    assert.ok(a.text.toString().includes('Sam offline'));
    assert.equal(f.app.store.load(id).getText('content').toString(), a.text.toString());
  } finally {
    await f.cleanup();
  }
});

test('acknowledged updates survive compaction, room eviction, and a server restart', async () => {
  const f = await fixture();
  try {
    const alex = await f.register('alex');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Durability' }, alex.cookie);
    const peer = f.peer(data.id, alex.cookie);
    await peer.connect();
    for (let i = 0; i < 24; i++) {
      peer.text.insert(peer.text.length, `${i},`);
      await peer.flush();
    }
    assert.equal(f.app.store.stats(data.id).storedUpdates, 4);
    const expected = peer.text.toString();
    await peer.disconnect();
    await until(() => f.app.rooms.rooms.size === 0);
    await f.restart();
    await peer.connect();
    assert.equal(peer.text.toString(), expected);
    const row = f.app.store.row(data.id)!;
    assert.equal(row.revision, 24);
    assert.ok(f.app.store.activity(data.id).some((event) => event.kind === 'compacted'));
  } finally {
    await f.cleanup();
  }
});

test('viewer receives live changes but a forged write is rejected server-side', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner'),
      viewer = await f.register('viewer');
    const { data } = await f.request(
      '/api/documents',
      'POST',
      { title: 'Read only', text: 'Approved' },
      owner.cookie,
    );
    await f.request(
      `/api/documents/${data.id}/members`,
      'POST',
      { username: 'viewer', role: 'viewer' },
      owner.cookie,
    );
    const a = f.peer(data.id, owner.cookie),
      b = f.peer(data.id, viewer.cookie);
    await a.connect();
    await b.connect();
    a.text.insert(a.text.length, ' update');
    await a.flush();
    await until(() => b.text.toString() === 'Approved update');
    const forged = new Y.Doc();
    Y.applyUpdate(forged, Y.encodeStateAsUpdate(b.doc));
    forged.getText('content').insert(0, 'FORGED ');
    b.send({ type: 'update', id: 'forged-write', data: b64(Y.encodeStateAsUpdate(forged)) });
    await until(() => b.frames.some((frame) => frame.type === 'error'));
    assert.equal(a.text.toString(), 'Approved update');
    assert.equal(f.app.store.row(data.id)!.revision, 1);
    forged.destroy();
  } finally {
    await f.cleanup();
  }
});

test('revocation closes active sockets and prevents later reads and reconnects', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner'),
      editor = await f.register('editor');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Permissions' }, owner.cookie);
    await f.request(
      `/api/documents/${data.id}/members`,
      'POST',
      { username: 'editor', role: 'editor' },
      owner.cookie,
    );
    const peer = f.peer(data.id, editor.cookie);
    await peer.connect();
    await f.request(`/api/documents/${data.id}/members`, 'DELETE', { username: 'editor' }, owner.cookie);
    await until(() => peer.closedCode === 4403);
    assert.equal(
      (await f.request(`/api/documents/${data.id}/activity`, 'GET', undefined, editor.cookie)).response
        .status,
      404,
    );
    assert.equal((await f.request('/api/documents', 'GET', undefined, editor.cookie)).data.length, 0);
    const socket = new WebSocket(`ws://127.0.0.1:${f.port}/sync/${data.id}`, {
      headers: { Cookie: editor.cookie, Origin: `http://127.0.0.1:${f.port}` },
    });
    let rejected = false;
    socket.on('close', (code) => {
      rejected = code === 4403;
    });
    socket.on('error', () => {});
    await until(() => rejected);
    socket.terminate();
  } finally {
    await f.cleanup();
  }
});

test('duplicate delivery is idempotent and malformed updates do not poison the room', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Retry' }, owner.cookie);
    const peer = f.peer(data.id, owner.cookie);
    await peer.connect();
    const temporary = new Y.Doc();
    Y.applyUpdate(temporary, Y.encodeStateAsUpdate(peer.doc));
    temporary.getText('content').insert(0, 'Once');
    const frame = { type: 'update', id: 'same-delivery', data: b64(Y.encodeStateAsUpdate(temporary)) };
    peer.send(frame);
    peer.send(frame);
    await until(() => peer.frames.filter((frame) => frame.type === 'ack').length === 2);
    assert.equal(f.app.store.row(data.id)!.revision, 1);
    peer.send({ type: 'update', id: 'bad', data: b64(new Uint8Array([255, 255, 255])) });
    await until(() => peer.frames.some((frame) => frame.type === 'error'));
    assert.equal(f.app.store.row(data.id)!.revision, 1);
    temporary.destroy();
  } finally {
    await f.cleanup();
  }
});

test('HTTP authentication, ownership, input validation, and origin guards are enforced', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/documents')).response.status, 401);
    const owner = await f.register('owner'),
      other = await f.register('other');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Private' }, owner.cookie);
    assert.equal(
      (
        await f.request(
          `/api/documents/${data.id}/members`,
          'POST',
          { username: 'other', role: 'owner' },
          owner.cookie,
        )
      ).response.status,
      422,
    );
    await f.request(
      `/api/documents/${data.id}/members`,
      'POST',
      { username: 'other', role: 'editor' },
      owner.cookie,
    );
    assert.equal(
      (await f.request(`/api/documents/${data.id}`, 'PATCH', { title: 'Not yours' }, other.cookie)).response
        .status,
      403,
    );
    const attack = await fetch(`http://127.0.0.1:${f.port}/api/documents`, {
      headers: { Cookie: owner.cookie, Origin: 'https://untrusted.example' },
    });
    assert.equal(attack.status, 403);
    assert.equal(
      (
        await f.request('/api/register', 'POST', {
          username: 'bad name',
          name: 'Bad',
          password: 'strong-test-password',
        })
      ).response.status,
      422,
    );
    assert.equal(
      (await f.request('/api/login', 'POST', { username: 'owner', password: 'wrong-password-value' }))
        .response.status,
      401,
    );
    await f.request('/api/logout', 'POST', {}, owner.cookie);
    assert.equal((await f.request('/api/me', 'GET', undefined, owner.cookie)).response.status, 401);
  } finally {
    await f.cleanup();
  }
});

test('oversized text is rejected before persistence and a healthy update still succeeds', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Bounded' }, owner.cookie);
    const peer = f.peer(data.id, owner.cookie);
    await peer.connect();
    const large = new Y.Doc();
    large.getText('content').insert(0, 'a'.repeat(200001));
    peer.send({ type: 'update', id: 'oversized', data: b64(Y.encodeStateAsUpdate(large)) });
    await until(() => peer.frames.some((frame) => frame.type === 'error'));
    assert.equal(f.app.store.row(data.id)!.revision, 0);
    peer.text.insert(0, 'Healthy');
    await peer.flush();
    assert.equal(f.app.store.row(data.id)!.revision, 1);
    large.destroy();
  } finally {
    await f.cleanup();
  }
});

test('collaborator cannot spoof another presence identity', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('owner');
    const { data } = await f.request('/api/documents', 'POST', { title: 'Presence' }, owner.cookie);
    const peer = f.peer(data.id, owner.cookie);
    await peer.connect();
    const { Awareness, encodeAwarenessUpdate } = await import('y-protocols/awareness');
    const awareness = new Awareness(peer.doc);
    awareness.setLocalStateField('user', { name: 'Someone else', color: '#123456' });
    peer.send({ type: 'presence', data: b64(encodeAwarenessUpdate(awareness, [peer.doc.clientID])) });
    await until(() => peer.frames.some((frame) => frame.type === 'error'));
    assert.equal(f.app.rooms.rooms.get(data.id)!.awareness.getStates().size, 0);
    awareness.destroy();
  } finally {
    await f.cleanup();
  }
});
