import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { cacheGet, cachePut, cacheMergeDocument, cacheDelete } from '../web/src/cache.js';

test('concurrent device writes merge CRDT state instead of overwriting another tab', async () => {
  const seed = new Y.Doc();
  seed.getText('content').insert(0, 'Shared. ');
  const a = new Y.Doc(),
    b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));
  a.getText('content').insert(a.getText('content').length, 'From tab A. ');
  b.getText('content').insert(b.getText('content').length, 'From tab B. ');
  await Promise.all([
    cacheMergeDocument('merge-test', Y.encodeStateAsUpdate(a)),
    cacheMergeDocument('merge-test', Y.encodeStateAsUpdate(b)),
  ]);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, (await cacheGet<Uint8Array>('merge-test'))!);
  assert.ok(restored.getText('content').toString().includes('From tab A'));
  assert.ok(restored.getText('content').toString().includes('From tab B'));
  for (const doc of [seed, a, b, restored]) doc.destroy();
});
test('cached metadata is namespaced per account and can be removed', async () => {
  await cachePut('list:alice', [{ title: 'Alice private' }]);
  await cachePut('list:bob', [{ title: 'Bob private' }]);
  assert.deepEqual(await cacheGet('list:alice'), [{ title: 'Alice private' }]);
  assert.deepEqual(await cacheGet('list:bob'), [{ title: 'Bob private' }]);
  await cacheDelete('list:alice');
  assert.equal(await cacheGet('list:alice'), undefined);
  assert.deepEqual(await cacheGet('list:bob'), [{ title: 'Bob private' }]);
});
