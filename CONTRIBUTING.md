# Contributing

Use Node 24+. Run `npm ci`, `npm run build`, `npm test`, `npm run verify`, and `npm run format:check`.

Keep the core guarantees explicit: cache writes merge across tabs; acknowledgements follow SQL commit; reconnects reconcile state; viewers cannot upload updates; authorization changes do not silently discard local drafts. Add behavior-based tests when changing these boundaries.

The project uses Yjs for CRDT semantics. Transport revisions, cache completion, and server acknowledgements describe different events; do not collapse them into a generic save indicator. Never claim browser storage is a guaranteed backup or that revocation erases downloaded content.

Keep credentials, databases, build output, and runtime reports under ignored paths. Demo credentials are intentionally public and must not become a bypass for normal account checks. Public hosting, horizontal scale, encryption, deletion, and revision restore require separate designs and tests.

For UI changes, check desktop and narrow layouts, keyboard access, the real WebSocket/API boundary, and offline reload after a production build. The Vite hot-reload server alone does not verify the production offline shell.
