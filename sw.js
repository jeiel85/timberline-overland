// Service worker: makes the game installable and playable offline after the
// first visit. Game files are fetched network-first, so an update arrives as
// soon as you are online and the cache only answers when the network cannot;
// the version-pinned CDN modules never change and are served cache-first.

const VERSION = 'v0.2.0';
const SHELL = `timberline-shell-${VERSION}`;
const FONTS = 'timberline-fonts';

// Everything the game needs to boot. tests/pwa.test.mjs keeps this list in
// step with src/ and with the import map in index.html.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./src/audio.js",
  "./src/camera.js",
  "./src/carmodel.js",
  "./src/drivetrain.js",
  "./src/flora.js",
  "./src/fx.js",
  "./src/hud.js",
  "./src/i18n.js",
  "./src/input.js",
  "./src/journal.js",
  "./src/layout.js",
  "./src/main.js",
  "./src/noise.js",
  "./src/physics.js",
  "./src/props.js",
  "./src/save.js",
  "./src/scatter.js",
  "./src/terrain.js",
  "./src/vehicle.js",
  "./src/world.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/geometries/RoundedBoxGeometry.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/utils/BufferGeometryUtils.js",
  "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs"
];

const PINNED = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^/@]+@\d[^/]*\//;
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('timberline-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (PINNED.test(req.url)) event.respondWith(cacheFirst(req));
  else if (FONT_HOSTS.test(req.url)) event.respondWith(staleWhileRevalidate(req));
  else if (new URL(req.url).origin === self.location.origin) event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const navigate = req.mode === 'navigate';
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (err) {
    // Offline: the cached copy, and for a page load (any query string) the game itself.
    const hit = (await caches.match(req, { ignoreSearch: navigate })) || (navigate && (await caches.match('./index.html')));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || fresh;
}
