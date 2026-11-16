import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CloudOff,
  FilePlus2,
  FileText,
  FolderOpen,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { DocumentInfo, User } from '../../src/shared';
import { api, ApiError } from './api';
import { cacheDelete, cacheGet, cachePut } from './cache';
import Auth, { Brand } from './components/Auth';
import Document from './components/Document';

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [documents, setDocuments] = useState<DocumentInfo[]>([]),
    [selected, setSelected] = useState(location.hash.slice(1)),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<'all' | 'shared'>('all'),
    [error, setError] = useState(''),
    [offline, setOffline] = useState(false),
    [creating, setCreating] = useState(false),
    [newTitle, setNewTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<User>('/api/me')
      .then(async (current) => {
        await cachePut('last-user', current).catch(() => {});
        if (alive) setUser(current);
      })
      .catch(async (error) => {
        if (error instanceof ApiError && error.status === 401) return;
        const cached = await cacheGet<User>('last-user').catch(() => undefined);
        if (alive && cached) {
          setUser(cached);
          setOffline(true);
        }
      })
      .finally(() => {
        if (alive) setBoot(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function refresh() {
    if (!user) return;
    try {
      const list = await api<DocumentInfo[]>('/api/documents');
      setDocuments(list);
      setOffline(false);
      await cachePut(`list:${user.id}`, list).catch(() => {});
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setError('Your session ended. Export any local work, then sign out and sign in again.');
        return;
      }
      const cached = await cacheGet<DocumentInfo[]>(`list:${user.id}`).catch(() => undefined);
      if (cached) setDocuments(cached);
      setOffline(true);
    }
  }
  useEffect(() => {
    void refresh();
    const online = () => void refresh();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [user?.id]);
  useEffect(() => {
    if (documents.length && !documents.some((doc) => doc.id === selected)) choose(documents[0].id);
  }, [documents]);
  function choose(id: string) {
    setSelected(id);
    location.hash = id;
  }
  async function login(current: User) {
    await cachePut('last-user', current).catch(() => {});
    setUser(current);
    setError('');
  }
  async function logout() {
    try {
      await api('/api/logout', 'POST', {});
      await cacheDelete('last-user');
      setUser(null);
      setDocuments([]);
      setSelected('');
      location.hash = '';
    } catch {
      setError('Sign out needs the local server. Your device copies remain available.');
    }
  }
  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>('/api/documents', 'POST', {
        title: newTitle,
        text: '# ' + newTitle + '\n\n',
      });
      setCreating(false);
      setNewTitle('');
      await refresh();
      choose(result.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create document');
    } finally {
      setBusy(false);
    }
  }
  if (boot)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user) return <Auth onLogin={(current) => void login(current)} />;
  const active = documents.find((doc) => doc.id === selected),
    visible = documents.filter(
      (doc) =>
        (filter !== 'shared' || doc.role !== 'owner') &&
        doc.title.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-mobile-tools">
          <button
            className="icon-button"
            aria-label="Create document"
            onClick={() => setCreating(true)}
            disabled={offline}
          >
            <Plus size={18} />
          </button>
          <button className="icon-button" aria-label="Sign out" onClick={() => void logout()}>
            <LogOut size={17} />
          </button>
        </div>
        <button className="workspace-picker" onClick={() => setHelp(true)}>
          <span className="workspace-icon">
            <Sparkles size={17} />
          </span>
          <span>
            <strong>Our workspace</strong>
            <small>LOCAL TEAM SPACE</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <label className="sidebar-search">
          <Search size={15} />
          <input
            aria-label="Search documents"
            placeholder="Find a document…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌕</kbd>
        </label>
        <nav aria-label="Workspace navigation">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            <FolderOpen size={17} />
            All documents<span>{documents.length}</span>
          </button>
          <button className={filter === 'shared' ? 'active' : ''} onClick={() => setFilter('shared')}>
            <Users size={17} />
            Shared with me<span>{documents.filter((doc) => doc.role !== 'owner').length}</span>
          </button>
        </nav>
        <div className="sidebar-section-title">
          <span>YOUR DOCUMENTS</span>
          <button
            className="icon-button"
            aria-label="Create document"
            onClick={() => setCreating(true)}
            disabled={offline}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="document-list">
          {visible.map((doc) => (
            <button
              key={doc.id}
              className={selected === doc.id ? 'selected' : ''}
              onClick={() => choose(doc.id)}
            >
              <FileText size={16} />
              <span>{doc.title}</span>
              {doc.role === 'viewer' && <ShieldCheck size={12} />}
            </button>
          ))}
          {!visible.length && <p>No documents match this view.</p>}
        </div>
        <button className="new-document" onClick={() => setCreating(true)} disabled={offline}>
          <Plus size={15} />
          New document
        </button>
        <div className="sidebar-bottom">
          <div className="local-first-note">
            <span>
              <span className="status-dot green" />
              LOCAL-FIRST BY DESIGN
            </span>
            <h3>Your work goes with you.</h3>
            <p>
              Less waiting for a connection.
              <br />
              More room for your ideas.
            </p>
            <button onClick={() => setHelp(true)}>
              How it works
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="profile-row">
            <span className="avatar coral">{user.name[0]}</span>
            <span>
              <strong>{user.name}</strong>
              <small>@{user.username}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out; device copies remain cached"
              onClick={() => void logout()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-content">
        {error && (
          <div className="global-error" role="alert">
            {error}
            <button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {offline && (
          <div className="offline-library">
            <CloudOff size={14} />
            Showing your cached workspace. Document creation and sharing need the server.
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {active ? (
          <Document
            key={`${user.id}:${active.id}`}
            info={active}
            user={user}
            onRefresh={() => void refresh()}
          />
        ) : (
          <div className="empty-workspace">
            <span className="large-icon">
              <BookOpen size={27} />
            </span>
            <h1>Room for your next idea.</h1>
            <p>Create your first document and invite someone to think with you.</p>
            <button className="button primary" disabled={offline} onClick={() => setCreating(true)}>
              <FilePlus2 size={16} />
              Create a document
            </button>
          </div>
        )}
      </div>
      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <section
            className="modal create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="large-icon">
                <FilePlus2 size={23} />
              </span>
              <button
                className="icon-button"
                aria-label="Close new document"
                onClick={() => setCreating(false)}
              >
                <X size={18} />
              </button>
            </div>
            <h2 id="create-title">A fresh page.</h2>
            <p>Give your next idea a place to start.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label>
                Document title
                <input
                  autoFocus
                  placeholder="Something worth writing down"
                  value={newTitle}
                  maxLength={100}
                  onChange={(event) => setNewTitle(event.target.value)}
                  required
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <>
                    <Plus size={15} />
                    Create document
                  </>
                )}
              </button>
            </form>
          </section>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="large-icon">
                <Settings2 size={23} />
              </span>
              <button className="icon-button" aria-label="Close help" onClick={() => setHelp(false)}>
                <X size={18} />
              </button>
            </div>
            <h2 id="help-title">A workspace with a local heartbeat.</h2>
            <p>
              Write in Markdown. Yjs merges concurrent edits; IndexedDB keeps document state on this browser.
              The WebSocket server persists updates to SQLite before acknowledging them.
            </p>
            <ol>
              <li>Open a document in two tabs.</li>
              <li>Pause sync in one and edit in both.</li>
              <li>Resume sync and compare the content.</li>
            </ol>
            <p>
              Pausing sync simulates a document transport outage. After a first online visit, the service
              worker caches the app shell for offline reloads. First sign-in, new documents, titles, and
              sharing require a connection.
            </p>
            <p>
              Device copies survive sign-out. Anyone with this browser profile may access cached content
              through developer tools. Use a private profile for sensitive work. Revocation cannot erase
              already downloaded copies.
            </p>
            <p className="help-scope">
              This release is a local single-server collaboration system, not an end-to-end encrypted cloud
              service.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
