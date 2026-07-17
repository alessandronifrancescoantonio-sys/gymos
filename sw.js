// GymOS — Service Worker (stale-while-revalidate)
//
// PRIMA: network-first con { cache: "no-cache" } → ad OGNI apertura l'app
// faceva una richiesta condizionale per OGNI file (8 round-trip) prima di
// mostrare qualcosa. Su rete mobile sono 1,5-3 secondi di attesa bloccante
// ogni volta, anche quando non era cambiato nulla — più la radio che si
// accende, che è la voce che pesa di più sulla batteria.
//
// ORA: la cache risponde SUBITO (apertura istantanea, zero rete bloccante) e
// l'aggiornamento viene scaricato in background. Il controllo "nuova versione"
// (build number in version.json) è fatto DALLA PAGINA, non da un postMessage
// del SW: un push SW→pagina subito dopo una navigazione piena si è rivelato
// fragile in pratica (il client nuovo non è sempre già in clients.matchAll()
// nell'istante esatto in cui il SW confronta i contenuti — il segnale si perde
// silenziosamente). Il SW qui fa solo cache-first + revalidate, niente di più.
const CACHE = "gymos-v88";

// File essenziali: pre-caricati all'installazione, così la PRIMA apertura
// offline dopo un aggiornamento funziona già.
const CORE = [
  "./", "./index.html", "./style.css", "./config.js", "./api.js",
  "./app.js", "./session.js", "./modules.js", "./timers.js", "./version.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      // addAll fallisce tutto se un solo file manca: meglio uno per uno, così
      // un 404 su un file non essenziale non impedisce l'installazione.
      await Promise.all(CORE.map((u) => c.add(u).catch(() => {})));
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // API/CDN esterni: non toccarli

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });

    // Rivalidazione in background: NON blocca la risposta. Cache-a solo
    // risposte buone: un 404/500 a metà deploy non deve sostituire la copia
    // sana (offline serviresti l'errore).
    const revalidate = fetch(e.request).then((res) => {
      if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    // C'è in cache → rispondi SUBITO, l'aggiornamento viaggia dietro.
    if (cached) { e.waitUntil(revalidate); return cached; }

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
