import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import App from './App';
import './styles.css';
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('Interface error', error.message);
  }
  render() {
    return this.state.failed ? (
      <div className="boot">
        <h1>Let's reconnect.</h1>
        <p>The interface hit an error. Your persisted device copy remains in browser storage.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload SyncForge
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch(() =>
      console.warn('Offline app shell could not be cached. Keep this tab open for offline editing.'),
    );
}
