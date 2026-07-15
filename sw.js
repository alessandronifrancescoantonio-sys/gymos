// GymOS — Service Worker (stale-while-revalidate)
//
// PRIMA: network-first con { cache: "no-cache" } → ad OGNI apertura l'app
// faceva una richiesta condizionale per OGNI file (8 round-trip) prima di
// mostrare qualcosa. Su rete mobile sono 1,5-3 secondi di attesa bloccante
// ogni volta, anche quando non era cambiato nulla — più la radio che si
// accende, che è la voce che pesa di più sulla batteria.
//
// ORA: la cache risponde SUBITO (apertura istantanea, zero rete bloccante) e
// l'aggiornamento viene scaricato in background. Se il file è cambiato davvero,
// avvisiamo la pagina, che mostra "nuova versione disponibile". Niente più
// "chiudi e riapri l'app due volte per vedere le modifiche".
const CACHE = "gymos-v87";

// File essenziali: pre-caricati all'installazione, così la PRIMA apertura
// offline dopo un aggiornamento funziona già.
const CORE = [
  "./", "./index.html", "./style.css", "./config.js", "./api.js",
  "./app.js", "./session.js", "./modules.js", "./timers.js",
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

// Avvisa le pagine aperte che un file è cambiato (una sola volta per attivazione).
let notified = false;
async function notifyUpdate() {
  if (notified) return;
  notified = true;
  const cs = await self.clients.matchAll({ type: "window" });
  cs.forEach((c) => c.postMessage({ type: "gymos-update" }));
}

// Due risposte sono "la stessa versione" se combaciano ETag o Last-Modified.
// GitHub Pages li manda entrambi: è il modo più affidabile di accorgersi di un
// deploy senza confrontare i corpi (che costerebbe memoria e CPU).
function changed(a, b) {
  if (!a || !b) return false;
  const ea = a.headers.get("etag"), eb = b.headers.get("etag");
  if (ea && eb) return ea !== eb;
  const la = a.headers.get("last-modified"), lb = b.headers.get("last-modified");
  if (la && lb) return la !== lb;
  return false;
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // API/CDN esterni: non toccarli

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });

    // Rivalidazione in background: NON blocca la risposta.
    const revalidate = fetch(e.request).then((res) => {
      if (res && res.ok) {
        if (cached && changed(cached, res)) notifyUpdate();
        // Cache-a solo risposte buone: un 404/500 a metà deploy non deve
        // sostituire la copia sana (offline serviresti l'errore).
        cache.put(e.request, res.clone()).catch(() => {});
      }
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
