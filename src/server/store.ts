import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as Y from 'yjs';
import type { Activity, DocumentInfo, Role, User } from '../shared.js';

type DocRow = {
  id: string;
  title: string;
  owner_id: string;
  state: Uint8Array;
  revision: number;
  created_at: number;
  updated_at: number;
};
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner_id TEXT REFERENCES users(id),state BLOB NOT NULL,revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members(doc_id TEXT REFERENCES documents(id),user_id TEXT REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('editor','viewer')),PRIMARY KEY(doc_id,user_id));
      CREATE TABLE IF NOT EXISTS updates(seq INTEGER PRIMARY KEY AUTOINCREMENT,doc_id TEXT REFERENCES documents(id),message_id TEXT NOT NULL,actor TEXT NOT NULL,data BLOB NOT NULL,at INTEGER NOT NULL,UNIQUE(doc_id,message_id));
      CREATE TABLE IF NOT EXISTS receipts(doc_id TEXT REFERENCES documents(id),message_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(doc_id,message_id));
      CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,doc_id TEXT REFERENCES documents(id),actor TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_document ON updates(doc_id,seq);
      CREATE INDEX IF NOT EXISTS activity_document ON activity(doc_id,id);`);
    if (
      !(this.db.prepare('PRAGMA table_info(receipts)').all() as { name: string }[]).some(
        (column) => column.name === 'hash',
      )
    )
      this.db.exec("ALTER TABLE receipts ADD COLUMN hash TEXT NOT NULL DEFAULT ''");
  }
  userByName(username: string) {
    return this.db.prepare('SELECT id,username,name,password FROM users WHERE username=?').get(username) as
      (User & { password: string }) | undefined;
  }
  createUser(username: string, name: string, password: string): User {
    if (Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n) >= 200)
      throw new Error('This local server has reached its 200-account limit');
    const user = { id: randomUUID(), username, name };
    this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id, username, name, password);
    return user;
  }
  session(userId: string) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(digest(token), userId, Date.now() + 7 * 24 * 60 * 60 * 1000);
    return token;
  }
  authenticate(token: string): User | undefined {
    return this.db
      .prepare(
        'SELECT u.id,u.username,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
      )
      .get(digest(token), Date.now()) as User | undefined;
  }
  logout(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
  }
  role(docId: string, userId: string): Role | undefined {
    const doc = this.db.prepare('SELECT owner_id FROM documents WHERE id=?').get(docId) as
      { owner_id: string } | undefined;
    if (doc?.owner_id === userId) return 'owner';
    return (
      this.db.prepare('SELECT role FROM members WHERE doc_id=? AND user_id=?').get(docId, userId) as
        { role: Role } | undefined
    )?.role;
  }
  list(userId: string): DocumentInfo[] {
    return this.db
      .prepare(
        `SELECT d.id,d.title,u.name AS owner,CASE WHEN d.owner_id=? THEN 'owner' ELSE m.role END AS role,d.updated_at AS updatedAt,d.created_at AS createdAt,d.revision FROM documents d JOIN users u ON u.id=d.owner_id LEFT JOIN members m ON m.doc_id=d.id AND m.user_id=? WHERE d.owner_id=? OR m.user_id=? ORDER BY d.updated_at DESC`,
      )
      .all(userId, userId, userId, userId) as unknown as DocumentInfo[];
  }
  createDocument(user: User, title: string, text = '') {
    if (
      (this.db.prepare('SELECT COUNT(*) AS n FROM documents WHERE owner_id=?').get(user.id) as { n: number })
        .n >= 100
    )
      throw new Error('Document limit reached (100 per owner)');
    const id = randomUUID(),
      doc = new Y.Doc();
    doc.getText('content').insert(0, text);
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    this.db
      .prepare('INSERT INTO documents VALUES(?,?,?,?,0,?,?)')
      .run(id, title, user.id, state, Date.now(), Date.now());
    this.record(id, user.name, 'created', state.length);
    return id;
  }
  row(id: string) {
    return this.db.prepare('SELECT * FROM documents WHERE id=?').get(id) as DocRow | undefined;
  }
  load(id: string) {
    const row = this.row(id);
    if (!row) throw new Error('Document not found');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    for (const update of this.db.prepare('SELECT data FROM updates WHERE doc_id=? ORDER BY seq').all(id) as {
      data: Uint8Array;
    }[])
      Y.applyUpdate(doc, update.data);
    return doc;
  }
  append(id: string, messageId: string, actor: string, update: Uint8Array, state: Uint8Array) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hash = createHash('sha256').update(update).digest('hex');
      const added = this.db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?)').run(id, messageId, hash);
      if (added.changes === 0) {
        const existing = this.db
          .prepare('SELECT hash FROM receipts WHERE doc_id=? AND message_id=?')
          .get(id, messageId) as { hash: string };
        if (existing.hash !== hash)
          throw new Error('Message ID was already used for different content. Reconnect to resync.');
        this.db.exec('COMMIT');
        return { revision: this.row(id)!.revision, duplicate: true };
      }
      this.db
        .prepare('INSERT INTO updates(doc_id,message_id,actor,data,at) VALUES(?,?,?,?,?)')
        .run(id, messageId, actor, update, Date.now());
      this.db.prepare('UPDATE documents SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), id);
      this.record(id, actor, 'edited', update.length);
      const count = (
        this.db.prepare('SELECT COUNT(*) AS n FROM updates WHERE doc_id=?').get(id) as { n: number }
      ).n;
      if (count >= 20) {
        this.db.prepare('UPDATE documents SET state=? WHERE id=?').run(state, id);
        this.db.prepare('DELETE FROM updates WHERE doc_id=?').run(id);
        this.record(id, 'SyncForge', 'compacted', state.length);
      }
      this.db.exec('COMMIT');
      return { revision: this.row(id)!.revision, duplicate: false };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  rename(id: string, title: string, actor: string) {
    this.db.prepare('UPDATE documents SET title=?,updated_at=? WHERE id=?').run(title, Date.now(), id);
    this.record(id, actor, 'renamed', 0);
  }
  members(id: string) {
    return this.db
      .prepare(
        'SELECT u.id,u.username,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.doc_id=? ORDER BY u.name',
      )
      .all(id);
  }
  setMember(id: string, userId: string, role: 'editor' | 'viewer') {
    this.db
      .prepare(
        'INSERT INTO members VALUES(?,?,?) ON CONFLICT(doc_id,user_id) DO UPDATE SET role=excluded.role',
      )
      .run(id, userId, role);
  }
  removeMember(id: string, userId: string) {
    this.db.prepare('DELETE FROM members WHERE doc_id=? AND user_id=?').run(id, userId);
  }
  record(id: string, actor: string, kind: string, bytes: number) {
    this.db
      .prepare('INSERT INTO activity(doc_id,actor,kind,bytes,at) VALUES(?,?,?,?,?)')
      .run(id, actor, kind, bytes, Date.now());
  }
  activity(id: string): Activity[] {
    return this.db
      .prepare('SELECT id,actor,kind,bytes,at FROM activity WHERE doc_id=? ORDER BY id DESC LIMIT 80')
      .all(id) as unknown as Activity[];
  }
  stats(id: string) {
    return {
      revision: this.row(id)?.revision,
      storedUpdates: (
        this.db.prepare('SELECT COUNT(*) AS n FROM updates WHERE doc_id=?').get(id) as { n: number }
      ).n,
      snapshotBytes: this.row(id)?.state.length,
    };
  }
  close() {
    this.db.close();
  }
}
