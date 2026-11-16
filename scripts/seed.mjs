import { Store } from '../dist/server/store.js';
import { hashPassword } from '../dist/server/auth.js';
import { resolve } from 'node:path';
const store = new Store(resolve('data/syncforge.db'));
try {
  if (store.userByName('alex')) {
    console.log('Existing workspace preserved.');
  } else {
    const password = await hashPassword('syncforge-demo-2026');
    const alex = store.createUser('alex', 'Alex Morgan', password),
      sam = store.userByName('sam') ?? store.createUser('sam', 'Sam Rivera', password);
    const id = store.createDocument(
      alex,
      'A workspace that goes with you',
      `# A workspace that goes with you\n\nGood ideas do not wait for a stable connection. Neither should your documents.\n\n## Built for the in-between\n\nSyncForge is a shared space for the notes, plans, and decisions that move a team forward. Write here, close your laptop, and pick up where you left off.\n\n- **Write together.** Changes and cursors appear as your team works.\n- **Keep moving offline.** Your document is stored in this browser.\n- **Reconnect with confidence.** Concurrent edits merge using Yjs CRDTs.\n\n## Try it yourself\n\n1. Open this document in a second browser tab.\n2. Choose **Pause sync** in one tab and keep writing in both.\n3. Resume sync. Both tabs should converge on the same text.\n\n> Pause sync disconnects this document's WebSocket. It is a reproducible network-partition demo, not airplane mode for the entire browser.\n\n## A little room for your ideas\n\nWhat should we build next?\n`,
    );
    store.setMember(id, sam.id, 'editor');
    store.createDocument(
      alex,
      'The shape of good collaboration',
      '# The shape of good collaboration\n\n## Principles\n\n1. Make the state visible.\n2. Preserve local work before asking for a network.\n3. Acknowledge only what has been committed.\n4. Treat permissions as a server responsibility.\n\n## Open questions\n\n- How do we explain concurrent changes clearly?\n- What should happen to offline edits after access is revoked?\n',
    );
    store.createDocument(
      alex,
      'Launch checklist',
      '# Launch checklist\n\n- [ ] Verify concurrent editing\n- [ ] Test offline reload\n- [ ] Restart the sync server\n- [ ] Check viewer permissions\n- [ ] Review the sync activity log\n',
    );
    console.log('Seeded local demo: alex / syncforge-demo-2026 (sam uses the same demo password).');
  }
} finally {
  store.close();
}
