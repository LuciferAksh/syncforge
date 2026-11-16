import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  Cloud,
  CloudOff,
  Database,
  FileText,
  Globe,
  HardDrive,
  History,
  Info,
  LoaderCircle,
  Lock,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Activity, DocumentInfo, User } from '../../../src/shared';
import { SyncProvider } from '../provider';
import { api, download } from '../api';
import Share from './Share';
const Editor = lazy(() => import('./Editor'));
const Markdown = lazy(() => import('react-markdown'));

export default function Document({
  info,
  user,
  onRefresh,
}: {
  info: DocumentInfo;
  user: User;
  onRefresh: () => void;
}) {
  const [provider, setProvider] = useState<SyncProvider | null>(null);
  useEffect(() => {
    const instance = new SyncProvider(info.id, user, info.role);
    setProvider(instance);
    return () => instance.destroy();
  }, [info.id, user.id]);
  return provider ? (
    <DocumentBody info={info} user={user} provider={provider} onRefresh={onRefresh} />
  ) : (
    <div className="loading-space">
      <LoaderCircle className="spin" />
      Opening your device copy…
    </div>
  );
}
function DocumentBody({
  info,
  user,
  provider,
  onRefresh,
}: {
  info: DocumentInfo;
  user: User;
  provider: SyncProvider;
  onRefresh: () => void;
}) {
  const state = useSyncExternalStore(provider.subscribe, provider.getSnapshot),
    [text, setText] = useState(''),
    [title, setTitle] = useState(info.title),
    [preview, setPreview] = useState(false),
    [share, setShare] = useState(false),
    [activity, setActivity] = useState<Activity[]>([]),
    [activityError, setActivityError] = useState(''),
    [error, setError] = useState(''),
    [details, setDetails] = useState(false),
    [people, setPeople] = useState<{ id: number; name: string; color: string }[]>([]);
  useEffect(() => {
    const update = () =>
      setPeople(
        [...provider.awareness.getStates()]
          .filter(([, state]) => state.user)
          .map(([id, state]) => ({ id, ...state.user })),
      );
    provider.awareness.on('change', update);
    update();
    return () => provider.awareness.off('change', update);
  }, [provider]);
  useEffect(() => {
    setTitle(info.title);
  }, [info.title]);
  useEffect(() => {
    let alive = true;
    api<Activity[]>(`/api/documents/${info.id}/activity`)
      .then((data) => {
        if (alive) {
          setActivity(data);
          setActivityError('');
        }
      })
      .catch(() => {
        if (alive) setActivityError('Server activity is unavailable while disconnected.');
      });
    return () => {
      alive = false;
    };
  }, [info.id, state.revision]);
  async function rename() {
    if (title === info.title) return;
    try {
      await api(`/api/documents/${info.id}`, 'PATCH', { title });
      setError('');
      onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Rename failed');
      setTitle(info.title);
    }
  }
  const connected = state.status === 'connected',
    blocked = state.status === 'blocked',
    readonly = state.role === 'viewer' || blocked || !state.hasCopy;
  const label =
    state.status === 'paused'
      ? 'Sync paused'
      : state.status === 'offline'
        ? 'Working offline'
        : blocked
          ? 'Access changed'
          : state.status === 'connecting'
            ? 'Connecting…'
            : state.pending
              ? 'Syncing changes…'
              : 'All changes synced';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <>
      <header className="workspace-topbar">
        <div>
          <span>Workspace</span>
          <ChevronRight size={13} />
          <FileText size={14} />
          <strong>{info.title}</strong>
        </div>
        <div className="presence">
          <div className="avatar-stack">
            {people.slice(0, 4).map((person) => (
              <span
                className="avatar"
                key={person.id}
                style={{ background: person.color }}
                title={person.name}
              >
                {person.name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </span>
            ))}
          </div>
          <span>{people.length > 1 ? `${people.length} connected` : 'Your space to think'}</span>
          <span className="topbar-divider" />
          <span className="avatar profile" title={`Signed in as ${user.name}`}>
            {user.name[0]}
          </span>
        </div>
      </header>
      <div className={`connection-banner ${connected ? 'online' : blocked ? 'blocked' : 'offline'}`}>
        <span>
          <span className="status-dot" />
          {label}
        </span>
        <span>
          {connected
            ? 'Your team is up to date.'
            : blocked
              ? 'Local content remains available for export.'
              : 'Keep writing. Your device copy is still available.'}
        </span>
        <button onClick={provider.toggle} disabled={blocked}>
          {state.status === 'paused' ? (
            <>
              <Play size={12} />
              Resume sync
            </>
          ) : (
            <>
              <Pause size={12} />
              Pause sync
            </>
          )}
        </button>
      </div>
      <div className="document-layout">
        <main className="document-main">
          <div className="document-actions">
            <div className="document-category">
              <span className="category-dot" />
              TEAM NOTES<span>/</span>
              <span>{state.role === 'viewer' ? 'READ ONLY' : 'MARKDOWN DOCUMENT'}</span>
            </div>
            <div>
              <button
                className="icon-button"
                aria-label="Export document as Markdown"
                onClick={() =>
                  download(
                    `${title.replace(/[^a-z0-9 -]/gi, '').slice(0, 80) || 'document'}.md`,
                    provider.doc.getText('content').toString(),
                  )
                }
              >
                <ArrowDownToLine size={17} />
              </button>
              {info.role === 'owner' ? (
                <button className="button dark small" onClick={() => setShare(true)} disabled={!connected}>
                  <Users size={14} />
                  Share
                </button>
              ) : (
                <span className="role-tag">
                  <Lock size={12} />
                  {state.role === 'viewer' ? 'Can view' : 'Can edit'}
                </span>
              )}
            </div>
          </div>
          <div className="document-title">
            <div className="document-emoji">
              <FileText size={29} strokeWidth={1.5} />
            </div>
            {info.role === 'owner' ? (
              <input
                className="title-input"
                aria-label="Document title"
                value={title}
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                disabled={!connected}
              />
            ) : (
              <h1>{title}</h1>
            )}
            <div className="document-meta">
              <span className="tiny-avatar coral">{info.owner[0]}</span>
              <span>{info.owner}</span>
              <span>·</span>
              <span>
                {new Date(info.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <span>·</span>
              <span>{words} words</span>
              <span className="local-pill">
                <HardDrive size={11} />
                {state.hasCopy ? 'Device copy loaded' : 'First connection required'}
              </span>
            </div>
          </div>
          {(error || state.error || state.storageError) && (
            <div className="document-warning" role="alert">
              <Info size={17} />
              <p>{state.storageError ?? state.error ?? error}</p>
            </div>
          )}
          {!state.hasCopy && state.ready && (
            <div className="document-warning">
              <Info size={17} />
              <p>
                This document has no cached device copy yet. Connect to the server once before editing it
                offline.
              </p>
            </div>
          )}
          <div className="editor-toolbar">
            <div className="editor-tabs">
              <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
                <FileText size={13} />
                {readonly ? 'Source' : 'Write'}
              </button>
              <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
                <Globe size={13} />
                Preview
              </button>
            </div>
            <span>
              <span className={`status-dot ${state.localSaved ? 'green' : ''}`} />
              {state.storageError
                ? 'Device storage failed'
                : !state.hasCopy
                  ? 'Not cached yet'
                  : state.localSaved
                    ? 'Saved on this device'
                    : 'Saving to device…'}
            </span>
          </div>
          {state.ready ? (
            <>
              <div hidden={preview}>
                <Suspense fallback={<div className="loading-space">Opening editor…</div>}>
                  <Editor provider={provider} readonly={readonly} onText={setText} />
                </Suspense>
              </div>
              {preview && (
                <article className="markdown-preview">
                  <Suspense fallback={<p>Rendering preview…</p>}>
                    <Markdown>{text}</Markdown>
                  </Suspense>
                </article>
              )}
            </>
          ) : (
            <div className="loading-space">
              <LoaderCircle className="spin" />
              Loading your device copy…
            </div>
          )}
          <div className="editor-footer">
            <span>
              <ShieldCheck size={13} />
              Your words, on your device.
            </span>
            <span>
              {text.length.toLocaleString()} characters<span>·</span>Markdown
            </span>
          </div>
        </main>
        <aside className="sync-sidebar">
          <div className="sync-panel-heading">
            <Radio size={17} />
            <h2>Sync overview</h2>
            <span className="live-label">LIVE</span>
          </div>
          <p className="sync-intro">A little visibility. A lot of peace of mind.</p>
          <div className="sync-path">
            <div>
              <span className={`sync-path-icon ${state.localSaved ? 'ready' : ''}`}>
                <HardDrive size={19} />
              </span>
              <div>
                <strong>This device</strong>
                <span>
                  {state.storageError
                    ? 'Storage unavailable'
                    : state.localSaved
                      ? 'Local copy saved'
                      : 'Saving locally…'}
                </span>
              </div>
              {state.localSaved && <Check size={15} />}
            </div>
            <div className={`sync-path-line ${connected ? 'active' : ''}`}>
              <i />
              <span>
                {connected
                  ? state.pending
                    ? 'Sending updates'
                    : 'Connected'
                  : state.status === 'paused'
                    ? 'Connection paused'
                    : 'Waiting to reconnect'}
              </span>
            </div>
            <div>
              <span className={`sync-path-icon ${connected && !state.pending ? 'ready' : ''}`}>
                <Cloud size={19} />
              </span>
              <div>
                <strong>Sync server</strong>
                <span>
                  {connected
                    ? state.pending
                      ? 'Awaiting commit'
                      : 'Changes committed'
                    : 'Your local work stays here'}
                </span>
              </div>
              {connected && !state.pending && <Check size={15} />}
            </div>
          </div>
          <div className="sync-stat-grid">
            <div>
              <span>Pending batches</span>
              <strong>
                {state.revision === null && !state.pending ? '—' : state.pending}
                <small>{state.revision === null ? 'unverified' : 'batches'}</small>
              </strong>
            </div>
            <div>
              <span>Server revision</span>
              <strong>{state.revision?.toLocaleString() ?? '—'}</strong>
            </div>
          </div>
          <div className="offline-card">
            <span>
              <CloudOff size={18} />
            </span>
            <strong>Uninterrupted thinking.</strong>
            <p>Go offline. Keep writing. Your changes merge when you reconnect.</p>
            <button onClick={provider.toggle} disabled={blocked}>
              {state.status === 'paused' ? 'Resume live sync' : 'Try pausing sync'}
              <ArrowRight size={13} />
            </button>
          </div>
          <button className="details-toggle" onClick={() => setDetails(!details)}>
            <Database size={14} />
            Under the hood
            <ChevronRight size={14} className={details ? 'rotated' : ''} />
          </button>
          {details && (
            <div className="sync-details">
              <div>
                Conflict resolution<strong>Yjs CRDT</strong>
              </div>
              <div>
                Device storage<strong>IndexedDB</strong>
              </div>
              <div>
                Server persistence<strong>SQLite WAL</strong>
              </div>
              <div>
                Sent this session<strong>{state.sent.toLocaleString()} B</strong>
              </div>
              <div>
                Received<strong>{state.received.toLocaleString()} B</strong>
              </div>
              <p>
                A sync acknowledgement means the server committed an update. It does not mean another person
                has read it.
              </p>
            </div>
          )}
          <div className="activity-heading">
            <History size={15} />
            <h3>Recent activity</h3>
            <button
              className="icon-button"
              aria-label="Refresh document activity"
              onClick={() => {
                void api<Activity[]>(`/api/documents/${info.id}/activity`)
                  .then((data) => {
                    setActivity(data);
                    setActivityError('');
                  })
                  .catch(() => setActivityError('Activity unavailable. Reconnect and try again.'));
              }}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          {activityError && <p className="activity-unavailable">{activityError}</p>}
          <div className="activity-list">
            {activity.slice(0, 5).map((item) => (
              <div key={item.id}>
                <span className={`activity-dot ${item.kind === 'edited' ? 'green' : ''}`} />
                <div>
                  <strong>{item.actor}</strong>
                  <p>
                    {item.kind === 'edited'
                      ? 'Committed a document update'
                      : item.kind === 'compacted'
                        ? 'Compacted the update log'
                        : item.kind === 'created'
                          ? 'Created this document'
                          : item.kind === 'renamed'
                            ? 'Renamed this document'
                            : item.kind === 'access removed'
                              ? 'Removed collaborator access'
                              : 'Updated sharing permissions'}
                  </p>
                  <time>
                    {new Date(item.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
              </div>
            ))}
          </div>
          <details className="transport-events">
            <summary>Connection events</summary>
            {state.events.map((event, index) => (
              <p key={`${event.at}:${index}`}>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                {event.text}
              </p>
            ))}
          </details>
          <div className="sync-sidebar-footer">
            <ShieldCheck size={13} />
            <span>Local-first. Shared when connected.</span>
          </div>
        </aside>
      </div>
      {share && <Share document={info} onClose={() => setShare(false)} />}
    </>
  );
}
