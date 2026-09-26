// GymOS — immutable offline shell per build. A new worker installs the whole
// shell before activation. version.json remains network-first for update alerts.
const CACHE = "gymos-v107";

// File essenziali: pre-caricati all'installazione, così la PRIMA apertura
// offline dopo un aggiornamento funziona già.
const CORE = [
  "./", "./index.html", "./style.css", "./config.js", "./api.js",
  "./app.js", "./session.js", "./modules.js", "./timers.js", "./version.json",
  "./notes.js", "./ai-client.js", "./quality.css", "./apple-theme.css", "./exercise-guide-index.js",
  "./accessibility.js",
  "./backup.js",
  "./vendor/idb.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      // An incomplete shell must not replace the last working installation.
      await c.addAll(CORE);
    } catch (e) { throw e; }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("gymos-v") && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // API/CDN esterni: non toccarli

  // version.json è l'UNICO file che la pagina usa per decidere se mostrare
  // "nuova versione" — cache-first qui rendeva il controllo inaffidabile:
  // a seconda di QUANDO la revalidation in background era arrivata, due
  // aperture consecutive potevano leggere due numeri diversi e far
  // ricomparire il banner più volte per lo stesso aggiornamento (o, al
  // contrario, farlo sparire prima che l'utente avesse davvero ricaricato).
  // Qui invece: rete SEMPRE, cache solo come fallback offline.
  if (url.pathname.endsWith("/version.json")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res && res.ok) { const c = await caches.open(CACHE); c.put(e.request, res.clone()).catch(() => {}); }
        return res;
      } catch (e2) {
        const cache = await caches.open(CACHE);
        return (await cache.match(e.request, { ignoreSearch: true })) || new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    // A build is an immutable snapshot: never mix new JS with an old shell.
    // A new service worker installs the next complete CORE before activation.
    if (cached) return cached;

    // Rivalidazione in background: NON blocca la risposta. Cache-a solo
    // risposte buone: un 404/500 a metà deploy non deve sostituire la copia
    // sana (offline serviresti l'errore).
    const revalidate = fetch(e.request).then((res) => {
      if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    // Prima volta per questo file: serve la rete.
    const res = await revalidate;
    if (res) return res;
    // Offline e mai visto: se è una navigazione, ripiega sulla shell.
    if (e.request.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  })());
});
