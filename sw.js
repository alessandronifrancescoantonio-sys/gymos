// GymOS — Service Worker (network-first, sempre fresco quando online)
// Online: prende SEMPRE la versione più fresca dei file (rivalida col server,
// bypassando la cache HTTP del browser). La cache serve solo da fallback offline.
// Le chiamate al Worker Notion (altra origine) NON passano da qui.
const CACHE = "gymos-v55";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  // elimina le cache di versioni precedenti
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // lascia passare API/CDN esterni

  e.respondWith(
    // { cache: "no-cache" } forza la rivalidazione col server: niente più
    // versioni vecchie servite dalla cache HTTP del browser quando sei online.
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
