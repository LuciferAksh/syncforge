import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve('web/dist'),
  files = ['/', '/index.html', ...readdirSync(resolve(root, 'assets')).map((file) => '/assets/' + file)];
const version = createHash('sha256')
  .update(readFileSync(resolve(root, 'index.html')))
  .digest('hex')
  .slice(0, 12);
writeFileSync(
  resolve(root, 'sw.js'),
  `const CACHE='syncforge-${version}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('syncforge-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/sync/'))return;if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));else if(url.pathname.startsWith('/assets/'))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});`,
);
console.log('Generated versioned offline app shell. API responses are never cached by the service worker.');
