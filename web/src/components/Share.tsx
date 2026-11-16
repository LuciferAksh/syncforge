import { useEffect, useState } from 'react';
import { Lock, Plus, Trash2, Users, X } from 'lucide-react';
import { api } from '../api';
import type { DocumentInfo } from '../../../src/shared';
type Member = { id: string; username: string; name: string; role: 'editor' | 'viewer' };
export default function Share({ document, onClose }: { document: DocumentInfo; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]),
    [username, setUsername] = useState(''),
    [role, setRole] = useState('editor'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Member[]>(`/api/documents/${document.id}/members`)
      .then(setMembers)
      .catch((error) => setError(error.message));
  useEffect(() => {
    void load();
  }, [document.id]);
  async function change(method: string, user: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/documents/${document.id}/members`, method, { username: user, role });
      setUsername('');
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sharing failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <span className="large-icon">
            <Users size={21} />
          </span>
          <button className="icon-button" aria-label="Close sharing" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <h2 id="share-title">Good work is shared.</h2>
        <p>
          Invite an existing account on this server to <strong>{document.title}</strong>.
        </p>
        <form
          className="share-form"
          onSubmit={(event) => {
            event.preventDefault();
            void change('POST', username);
          }}
        >
          <input
            aria-label="Collaborator username"
            placeholder="Username, e.g. sam"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <select
            aria-label="Collaborator role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="button primary" disabled={busy}>
            <Plus size={15} />
            Add
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="member-list">
          <div>
            <span className="avatar coral">{document.owner[0]}</span>
            <span>
              <strong>{document.owner}</strong>
              <small>Document owner</small>
            </span>
            <b>Owner</b>
          </div>
          {members.map((member) => (
            <div key={member.id}>
              <span className="avatar teal">{member.name[0]}</span>
              <span>
                <strong>{member.name}</strong>
                <small>@{member.username}</small>
              </span>
              <b>{member.role === 'editor' ? 'Can edit' : 'Can view'}</b>
              <button
                className="icon-button"
                aria-label={`Remove ${member.username}`}
                disabled={busy}
                onClick={() => void change('DELETE', member.username)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="privacy-note">
          <Lock size={15} />
          <p>
            Access is checked by the server. Revoking access closes active connections; it cannot erase copies
            already cached on someone else's device.
          </p>
        </div>
        <button className="button secondary modal-done" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}
