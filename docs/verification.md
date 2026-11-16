# Verification evidence

## Repeatable automated checks

`npm test` runs 14 tests across three boundaries:

| Boundary                   | Evidence                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRDT behavior              | 64 deterministic three-replica partitions with concurrent insertion/deletion, shuffled delivery, and duplicates; state-vector delta recovery                                                                                                                              |
| Device storage             | Concurrent IndexedDB read/write transactions merge two divergent tab states; account-keyed metadata remains separate                                                                                                                                                      |
| Actual server and database | Authenticated HTTP/WebSocket editing, offline convergence, SQL compaction/restart recovery, viewer write rejection, access revocation, malformed/oversized updates, input and origin guards, presence identity, persistence failure atomicity, and delivery-ID collisions |

IndexedDB unit tests use fake-indexeddb; they validate transaction logic rather than browser-specific quota/eviction behavior. Real browser persistence is checked separately below. Server tests use temporary SQLite files and actual sockets, not mocked transport. The injected persistence-failure test verifies that neither the shared in-memory room nor another client receives an update when storage fails.

`npm run verify` runs a controlled two-account scenario against a fresh database and writes `data/verification.json`. It asserts that both partitioned edits survive, both peers converge, the merged state survives server restart, and a subsequent viewer write is rejected. Generated databases, reports, credentials, and browser screenshots remain ignored.

## Browser story

The primary story is: **edit → local IndexedDB commit → WebSocket → authorization → SQLite commit → remote replica → rendered document**.

Manual verification exercises the built app in two browser tabs:

1. Sign in using the seeded demo and create a dedicated `Reconnect lab` document through the UI.
2. Pause one tab's document sync and append different text in each tab.
3. Resume sync and compare the Markdown previews. Both contain the online and disconnected edits; live presence shows two connected replicas.
4. Add an existing registered account with viewer permission through the sharing dialog.
5. Pause a tab, edit, wait for local save, stop the backend, and reload that tab.
6. Confirm the cached app shell loads, the local document retains the edit, and more writing remains possible with the server unavailable.
7. Restart the backend. Confirm both previews contain all edits and the server revision advances only after the missing update commits.
8. Verify Markdown export, viewer UI, document search, and narrow-screen layout. Save screenshots for the repository and handoff.

The two browser tabs use the same demo account because their browser profile shares cookies. Separate authenticated identities and server-enforced viewer/revocation behavior are covered by socket integration tests. Browser offline reload uses genuine backend unavailability, not only the pause button.

## CI

GitHub Actions runs Node 24 builds, formatting, all tests, and the recovery verifier on Linux and Windows. This validates the repository's repeatable setup, including the built-in SQLite API and database file lifecycle. Browser visual/offline-shell checks are manual and are not implied by a green CI badge.
