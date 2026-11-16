import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, CloudOff, GitMerge, LoaderCircle, RefreshCw } from 'lucide-react';
import type { User } from '../../../src/shared';
import { api } from '../api';
export function Brand() {
  return (
    <div className="brand">
      <span>
        <RefreshCw size={21} />
      </span>
      SyncForge<span className="brand-dot">®</span>
    </div>
  );
}
export default function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(''),
    [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function login(event?: FormEvent, demo = false) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await api<User>(register && !demo ? '/api/register' : '/api/login', 'POST', {
        username: demo ? 'alex' : username,
        password: demo ? 'syncforge-demo-2026' : password,
        name,
      });
      onLogin(user);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">A LITTLE LESS FRICTION. A LOT MORE FLOW.</span>
          <h1>
            Great ideas.
            <br />
            Always in <em>sync.</em>
          </h1>
          <p>A calm space to write together. Online, offline, and everywhere in between.</p>
          <div className="auth-features">
            <span>
              <Check />
              Real-time collaboration
            </span>
            <span>
              <CloudOff />
              Made to work offline
            </span>
            <span>
              <GitMerge />
              Concurrent edits, merged
            </span>
          </div>
          <div className="paper-note">
            <span className="note-tag">TEAM NOTES</span>
            <strong>Keep the good ideas moving.</strong>
            <p>Connection lost? Your train of thought doesn't have to be.</p>
            <div>
              <span className="tiny-avatar coral">A</span>
              <span className="tiny-avatar teal">S</span>
              <span>Better, together.</span>
              <ArrowUpRight size={19} />
            </div>
          </div>
        </div>
        <div className="auth-footer">
          Local-first. Thoughtfully connected.<span>BUILT FOR THE WAY YOU WORK</span>
        </div>
      </section>
      <section className="auth-form">
        <div>
          <span className="eyebrow">YOUR NEXT GOOD IDEA STARTS HERE</span>
          <h2>{register ? 'Make yourself at home.' : 'Welcome back.'}</h2>
          <p>
            {register
              ? 'Create an account on this local SyncForge server.'
              : 'Sign in to your local workspace.'}
          </p>
          <form onSubmit={(event) => void login(event)}>
            {register && (
              <label>
                Your name
                <input
                  autoComplete="name"
                  required
                  maxLength={50}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Username
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your username"
              />
            </label>
            <label>
              Password
              <input
                autoComplete={register ? 'new-password' : 'current-password'}
                type="password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 12 characters"
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <>
                  {register ? 'Create workspace' : 'Open your workspace'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          <p className="switch-auth">
            {register ? 'Already have an account?' : 'New here?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <div className="auth-divider">
            <span />
            OR EXPLORE FIRST
            <span />
          </div>
          <button
            className="button secondary demo-button"
            disabled={busy}
            onClick={() => void login(undefined, true)}
          >
            Try the seeded local demo
            <ArrowUpRight size={15} />
          </button>
          <small>
            Demo available after <code>npm run dev</code>. No external account needed.
          </small>
        </div>
      </section>
    </div>
  );
}
