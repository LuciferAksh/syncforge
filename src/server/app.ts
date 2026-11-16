import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Rooms } from './rooms.js';
import { hashPassword, verifyPassword, sessionToken } from './auth.js';
import { MAX_TEXT } from '../shared.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage) {
  let text = '',
    size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 512 * 1024) throw new HttpError(413, 'Request too large');
    text += chunk.toString();
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Expected a JSON object');
  }
}
function value(input: unknown, name: string, max: number, min = 1) {
  if (typeof input !== 'string' || input.trim().length < min || input.length > max)
    throw new HttpError(422, `${name} must contain ${min}–${max} characters`);
  return input.trim();
}
export function createApp(dbPath: string) {
  const store = new Store(dbPath),
    rooms = new Rooms(store),
    rates = new Map<string, { at: number; count: number }>();
  let closing = false;
  const allowed = (req: IncomingMessage) => {
    const host = req.headers.host ?? '';
    try {
      if (!['127.0.0.1', 'localhost'].includes(new URL(`http://${host}`).hostname)) return false;
    } catch {
      return false;
    }
    return (
      !req.headers.origin ||
      [`http://${host}`, 'http://127.0.0.1:5175', 'http://localhost:5175'].includes(req.headers.origin)
    );
  };
  const server = createServer(async (req, res) => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!allowed(req)) throw new HttpError(403, 'Only same-origin loopback access is accepted');
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(200, { ok: true, service: 'SyncForge' });
        return;
      }
      if (
        ['POST', 'PATCH', 'DELETE'].includes(req.method ?? '') &&
        !(req.headers['content-type'] ?? '').startsWith('application/json')
      )
        throw new HttpError(415, 'Expected application/json');
      if (req.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
        const key = req.socket.remoteAddress ?? 'local',
          now = Date.now(),
          rate = rates.get(key);
        if (rate && now - rate.at < 60_000 && rate.count >= 30)
          throw new HttpError(429, 'Too many sign-in attempts. Wait one minute.');
        rates.set(
          key,
          rate && now - rate.at < 60_000 ? { ...rate, count: rate.count + 1 } : { at: now, count: 1 },
        );
        const data = await body(req),
          username = value(data.username, 'Username', 30, 3).toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(username))
          throw new HttpError(422, 'Username accepts letters, numbers, underscores, and hyphens');
        if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128)
          throw new HttpError(422, 'Password must contain 12–128 characters');
        let user = store.userByName(username);
        if (url.pathname === '/api/register') {
          if (user) throw new HttpError(409, 'Username is already registered');
          const name = value(data.name, 'Display name', 50),
            password = await hashPassword(data.password);
          // Recheck after asynchronous hashing to handle simultaneous registrations.
          if (store.userByName(username)) throw new HttpError(409, 'Username is already registered');
          const created = store.createUser(username, name, password);
          const token = store.session(created.id);
          res.setHeader(
            'Set-Cookie',
            `sf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`,
          );
          json(201, created);
          return;
        }
        if (!user || !(await verifyPassword(data.password, user.password)))
          throw new HttpError(401, 'Username or password is incorrect');
        const token = store.session(user.id);
        res.setHeader('Set-Cookie', `sf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
        json(200, { id: user.id, username: user.username, name: user.name });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const token = sessionToken(req.headers.cookie),
          user = store.authenticate(token);
        if (!user) throw new HttpError(401, 'Sign in to continue');
        if (req.method === 'GET' && url.pathname === '/api/me') {
          json(200, user);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/logout') {
          store.logout(token);
          rooms.expire();
          res.setHeader('Set-Cookie', 'sf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          json(200, { ok: true });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/documents') {
          json(200, store.list(user.id));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/documents') {
          const data = await body(req),
            title = value(data.title, 'Title', 100);
          if (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > MAX_TEXT))
            throw new HttpError(422, 'Invalid initial document content');
          const id = store.createDocument(user, title, data.text as string | undefined);
          json(201, { id });
          return;
        }
        const match = url.pathname.match(/^\/api\/documents\/([\w-]+)(?:\/(members|activity|stats))?$/);
        if (match) {
          const [, id, section] = match,
            role = store.role(id, user.id);
          if (!role) throw new HttpError(404, 'Document not found or access unavailable');
          if (!section && req.method === 'PATCH') {
            if (role !== 'owner') throw new HttpError(403, 'Only the owner can rename a document');
            const data = await body(req);
            store.rename(id, value(data.title, 'Title', 100), user.name);
            json(200, { ok: true });
            return;
          }
          if (req.method === 'GET' && section === 'activity') {
            json(200, store.activity(id));
            return;
          }
          if (req.method === 'GET' && section === 'stats') {
            json(200, store.stats(id));
            return;
          }
          if (section === 'members') {
            if (role !== 'owner') throw new HttpError(403, 'Only the owner manages sharing');
            if (req.method === 'GET') {
              json(200, store.members(id));
              return;
            }
            if (['POST', 'DELETE'].includes(req.method ?? '')) {
              const data = await body(req),
                username = value(data.username, 'Username', 30),
                target = store.userByName(username);
              if (!target) throw new HttpError(404, 'Ask this person to create an account first');
              if (target.id === user.id) throw new HttpError(422, 'The owner always retains access');
              if (req.method === 'DELETE') store.removeMember(id, target.id);
              else {
                if (!['editor', 'viewer'].includes(data.role as string))
                  throw new HttpError(422, 'Choose editor or viewer access');
                store.setMember(id, target.id, data.role as 'editor' | 'viewer');
              }
              store.record(id, user.name, req.method === 'DELETE' ? 'access removed' : 'sharing changed', 0);
              rooms.revoke(id, target.id);
              json(200, { ok: true });
              return;
            }
          }
        }
        throw new HttpError(404, 'API route not found');
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const directory = resolve(project, 'web/dist'),
        path =
          url.pathname === '/'
            ? resolve(directory, 'index.html')
            : resolve(directory, `.${decodeURIComponent(url.pathname)}`);
      const part = relative(directory, path);
      if (part.startsWith('..') || !existsSync(path) || !mime[extname(path)])
        throw new HttpError(404, 'Asset not found');
      if (url.pathname === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(200, { 'Content-Type': mime[extname(path)] });
      res.end(readFileSync(path));
    } catch (error) {
      if (!res.headersSent) {
        json(error instanceof HttpError ? error.status : 500, {
          error: error instanceof HttpError ? error.message : 'The server could not complete this request',
        });
      } else res.end();
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 750 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const id = req.url?.match(/^\/sync\/([\w-]+)$/)?.[1],
      token = sessionToken(req.headers.cookie),
      user = store.authenticate(token);
    if (!allowed(req) || !req.headers.origin || !id || closing) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      if (!user) {
        ws.close(4401, 'Sign in to continue');
        return;
      }
      if (!store.role(id, user.id)) {
        ws.close(4403, 'Document access is unavailable');
        return;
      }
      try {
        rooms.connect(id, ws, user, token);
      } catch {
        ws.close(1013, 'Document could not be opened');
      }
    });
  });
  const heartbeat = setInterval(() => rooms.expire(), 15_000);
  heartbeat.unref();
  return {
    server,
    store,
    rooms,
    start: (port = 4400) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
      }),
    close: async () => {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      rooms.close();
      sockets.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
