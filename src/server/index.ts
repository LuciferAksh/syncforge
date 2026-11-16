import { resolve } from 'node:path';
import { createApp } from './app.js';
const args = process.argv.slice(2);
let port = 4400,
  path = resolve('data/syncforge.db');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i] === '--db') path = resolve(args[++i]);
  else throw new Error(`Unknown option: ${args[i]}`);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const app = createApp(path);
try {
  const actual = await app.start(port);
  console.log(
    `SyncForge: http://127.0.0.1:${actual}\nStorage: ${path}\nLocal collaborative workspace. Ctrl+C stops the server.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Server failed');
  await app.close();
  process.exitCode = 1;
}
process.on('SIGINT', () => {
  void app.close();
});
process.on('SIGTERM', () => {
  void app.close();
});
