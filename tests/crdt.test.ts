import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

test('64 deterministic partition scenarios converge despite reordering and duplicate delivery', () => {
  for (let seed = 1; seed <= 64; seed++) {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const initial = new Y.Doc();
    initial.getText('content').insert(0, 'A shared starting point.\n');
    const base = Y.encodeStateAsUpdate(initial),
      updates: Uint8Array[] = [];
    const peers = Array.from({ length: 3 }, () => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, base);
      doc.on('update', (update) => updates.push(update));
      return doc;
    });
    for (let i = 0; i < 45; i++) {
      const text = peers[i % 3].getText('content');
      if (random() < 0.3 && text.length) text.delete(Math.floor(random() * text.length), 1);
      else text.insert(Math.floor(random() * (text.length + 1)), String.fromCharCode(97 + (i % 26)));
    }
    const shuffled = [...updates, ...updates.slice(0, 15)];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // The delivery set is fixed before replay.
    for (const peer of peers) {
      for (const update of shuffled) Y.applyUpdate(peer, update, 'replay');
    }
    assert.equal(
      new Set(peers.map((peer) => peer.getText('content').toString())).size,
      1,
      `Divergence at seed ${seed}`,
    );
    for (const peer of peers) peer.destroy();
    initial.destroy();
  }
});
test('state-vector synchronization sends only missing edits and duplicate updates are harmless', () => {
  const a = new Y.Doc(),
    b = new Y.Doc();
  a.getText('content').insert(0, 'baseline');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.getText('content').insert(8, ' plus more');
  const delta = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  Y.applyUpdate(b, delta);
  Y.applyUpdate(b, delta);
  assert.equal(b.getText('content').toString(), 'baseline plus more');
  assert.ok(delta.length < Y.encodeStateAsUpdate(a).length);
  a.destroy();
  b.destroy();
});
