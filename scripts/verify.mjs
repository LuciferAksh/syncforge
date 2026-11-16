import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fixture, until } from '../tests/helpers.ts';
const f = await fixture();
try {
  const owner = await f.register('writer_one'),
    editor = await f.register('writer_two');
  const { data } = await f.request(
    '/api/documents',
    'POST',
    { title: 'Recovery verification', text: 'Our shared plan.\n' },
    owner.cookie,
  );
  await f.request(
    `/api/documents/${data.id}/members`,
    'POST',
    { username: 'writer_two', role: 'editor' },
    owner.cookie,
  );
  const a = f.peer(data.id, owner.cookie),
    b = f.peer(data.id, editor.cookie);
  await a.connect();
  await b.connect();
  await b.disconnect();
  a.text.insert(a.text.length, 'Written online.\n');
  b.text.insert(b.text.length, 'Written during the partition.\n');
  await a.flush();
  await b.connect();
  await until(() => a.text.toString() === b.text.toString());
  const merged = a.text.toString();
  assert.ok(merged.includes('Written online.'));
  assert.ok(merged.includes('Written during the partition.'));
  await a.disconnect();
  await b.disconnect();
  await f.restart();
  await a.connect();
  await b.connect();
  assert.equal(a.text.toString(), merged);
  assert.equal(b.text.toString(), merged);
  await f.request(
    `/api/documents/${data.id}/members`,
    'POST',
    { username: 'writer_two', role: 'viewer' },
    owner.cookie,
  );
  await until(() => b.closedCode === 4403);
  await b.connect();
  b.send({ type: 'update', id: 'viewer-attempt', data: Buffer.from([0, 0]).toString('base64') });
  await until(() => b.frames.some((frame) => frame.type === 'error'));
  assert.equal(a.text.toString(), merged);
  const report = {
    generatedAt: new Date().toISOString(),
    scenario: 'Two authenticated users, partitioned edits, restart recovery, and viewer write rejection',
    checks: {
      partitionConverged: true,
      bothEditsPreserved: true,
      restartRecovered: true,
      viewerWriteRejected: true,
    },
    mergedText: merged,
    revision: f.app.store.row(data.id).revision,
    scope:
      'Controlled local integration scenario against a real HTTP/WebSocket server and temporary SQLite database. Browser offline-shell and IndexedDB checks are documented separately; this is not a production scale benchmark.',
  };
  mkdirSync('data', { recursive: true });
  writeFileSync('data/verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    `PASS: partition convergence, both edits retained, restart recovery, viewer write rejected.\nServer revision: ${report.revision}\nReport: data/verification.json`,
  );
} finally {
  await f.cleanup();
}
