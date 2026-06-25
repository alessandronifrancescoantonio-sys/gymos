// ═══════════════════════════════════════════════
//  GymOS — app.js
//  Router, init, navigazione
// ═══════════════════════════════════════════════

const App = {
  currentPage: "dashboard",

  async init() {
    this.setupNav();
    await this.boot();
  },

  setupNav() {
    // Sidebar + bottom-nav usano entrambi data-page
    document.querySelectorAll(".nav-link, .bn-link").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        this.navigate(link.dataset.page);
      });
    });
  },

  navigate(page) {
    // Aggiorna entrambe le nav (sidebar + bottom)
    document.querySelectorAll(".nav-link, .bn-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(`[data-page="${page}"]`).forEach(l => l.classList.add("active"));

    // Aggiorna pagine
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById(`page-${page}`)?.classList.add("active");

    this.currentPage = page;

    // Mostra il bottone Salva mobile solo sulla pagina Sessione
    const bnSave = document.getElementById("bn-save");
    if (bnSave) bnSave.classList.toggle("show", page === "session");

    // Mostra il timer recupero (FAB) solo nella pagina Sessione
    const restFab = document.getElementById("rest-fab");
    if (restFab) restFab.style.display = (page === "session") ? "flex" : "none";

    // Scroll in cima quando cambi pagina (utile su mobile)
    const main = document.getElementById("main");
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);

    // Carica dati pagina
    switch(page) {
      case "dashboard":   Dashboard.load(); break;
      case "session":     Session.load();   break;
      case "cardio":      Cardio.load();    break;
      case "progression": Progression.load(); break;
      case "body":        Body.load();      break;
      case "diary":       Diary.load();     break;
      case "schede":      Schede.load();    break;
    }
  },

  async boot() {
    const loading = document.getElementById("loading");
    const fill    = document.getElementById("loading-fill");
    const msg     = document.getElementById("loading-msg");

    // Step 1 — test connessione
    setProgress(20, "Connessione a Notion...");
    const ok = await API.testConnection().catch(() => false);

    if (!ok) {
      setProgress(100, "Errore connessione — controlla config.js");
      setConnStatus(false);
      setTimeout(() => loading.style.display = "none", 2000);
      return;
    }

    setConnStatus(true);
    setProgress(50, "Caricamento schede...");

    // Step 2 — carica le schede da Notion in CONFIG.SCHEDE
    await App.loadSchede().catch(console.error);

    setProgress(70, "Caricamento dati...");

    // Step 3 — carica dashboard
    await Dashboard.load().catch(console.error);
    setProgress(100, "Pronto!");

    setTimeout(() => {
      loading.style.opacity = "0";
      loading.style.transition = "opacity .4s";
      setTimeout(() => loading.style.display = "none", 400);
    }, 500);

    function setProgress(pct, text) {
      fill.style.width = pct + "%";
      msg.textContent  = text;
    }
  },

  // Carica le sedute da Notion, le raggruppa per Programma e popola CONFIG.SCHEDE
  // con le SOLE sedute del programma ATTIVO (così sessione/progressioni lo usano).
  async loadSchede() {
    try {
      const schede = await API.getSchede();
      App.schede = schede; // tutte le sedute (con id), per la sezione gestione

      // Raggruppa per programma, in ordine di apparizione
      const programmi = {};   // nome programma -> [sedute]
      schede.forEach(s => {
        const pg = s.programma || "La mia scheda";
        (programmi[pg] = programmi[pg] || []).push(s);
      });
      App.programmi = programmi;

      // Programma attivo = quello con almeno una seduta progAttivo; fallback al primo
      const names = Object.keys(programmi);
      let active = names.find(pg => programmi[pg].some(s => s.progAttivo)) || names[0] || null;
      App.activeProgram = active;

      // CONFIG.SCHEDE = sedute del solo programma attivo (formato usato ovunque)
      const map = {};
      (active ? programmi[active] : []).forEach(s => {
        map[s.nome] = { color: s.colore, exercises: s.exercises, _id: s.id };
      });
      CONFIG.SCHEDE = map;
    } catch(e) {
      console.error("loadSchede:", e);
    }
  },
  schede: [],
  programmi: {},
  activeProgram: null,
};

function setConnStatus(ok) {
  const dot   = document.getElementById("conn-dot");
  const label = document.getElementById("conn-label");
  dot.style.background = ok ? "#22C55E" : "#EF4444";
  label.textContent    = ok ? "Notion connesso" : "Connessione fallita";
}

// Utilities globali usate da tutti i moduli
const U = {
  fmt:  n => n == null ? "—" : (n % 1 === 0 ? "" + n : n.toFixed(1)),
  fmtV: v => v >= 1000 ? (v / 1000).toFixed(1) + "k kg" : Math.round(v) + " kg",
  vol:  (s, r, kg) => Math.round(s * r * (kg || 0)),

  // Un esercizio di una scheda può essere una stringa (vecchio formato) o
  // un oggetto { nome, serie } (nuovo formato). Questi helper li normalizzano.
  exName: item => typeof item === "string" ? item : ((item && item.nome) || ""),
  exSets: item => typeof item === "string" ? 1 : Math.max(1, (item && item.serie) || 1),

  // ─── Modali in-app (sostituiscono confirm/prompt/alert nativi) ───
  _modal(opts) {
    return new Promise(resolve => {
      const ov = document.getElementById("app-modal");
      if (!ov) { resolve(opts.input ? null : (opts.kind === "alert")); return; }
      const titleEl = document.getElementById("app-modal-title");
      const msgEl   = document.getElementById("app-modal-msg");
      const inp     = document.getElementById("app-modal-input");
      const ok      = document.getElementById("app-modal-ok");
      const cancel  = document.getElementById("app-modal-cancel");

      titleEl.textContent = opts.title || "";
      titleEl.style.display = opts.title ? "block" : "none";
      msgEl.textContent = opts.message || "";
      msgEl.style.display = opts.message ? "block" : "none";
      if (opts.input) {
        inp.style.display = "block";
        inp.value = opts.value || "";
        inp.placeholder = opts.placeholder || "";
      } else { inp.style.display = "none"; }
      ok.textContent = opts.okText || "Conferma";
      ok.classList.toggle("danger", !!opts.danger);
      cancel.style.display = (opts.kind === "alert") ? "none" : "inline-flex";
      ov.style.display = "flex";
      if (opts.input) setTimeout(() => { inp.focus(); inp.select(); }, 50);

      const cleanup = () => {
        ov.style.display = "none";
        ok.onclick = cancel.onclick = ov.onclick = inp.onkeydown = null;
        ok.classList.remove("danger");
      };
      const done = v => { cleanup(); resolve(v); };
      ok.onclick     = () => done(opts.input ? (inp.value.trim() || null) : true);
      cancel.onclick = () => done(opts.input ? null : false);
      ov.onclick     = e => { if (e.target === ov) done(opts.input ? null : false); };
      if (opts.input) inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); done(inp.value.trim() || null); } };
    });
  },
  confirm(message, opts = {}) { return this._modal({ message, title: opts.title, danger: opts.danger, okText: opts.okText || "Conferma" }); },
  prompt(message, opts = {})  { return this._modal({ input: true, title: message, placeholder: opts.placeholder, value: opts.value, okText: opts.okText || "Aggiungi" }); },
  alert(message, opts = {})   { return this._modal({ message, title: opts.title, kind: "alert", okText: opts.okText || "Ok" }); },

  fmtDate(isoDate) {
    if (!isoDate) return "—";
    const d = new Date(isoDate + "T12:00:00");
    const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  },

  today() {
    return new Date().toISOString().split("T")[0];
  },

  weekNum(isoDate) {
    if (!isoDate) return "—";
    const d = new Date(isoDate);
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  },

  deltaHTML(d, downGood = false) {
    if (d === null || d === undefined) return "—";
    d = Math.round(d * 10) / 10;
    if (d === 0) return `<span class="delta-eq">= uguale</span>`;
    const good = downGood ? d < 0 : d > 0;
    const icon = d > 0 ? "ti-trending-up" : "ti-trending-down";
    const cls  = good ? "delta-up" : "delta-dn";
    return `<span class="${cls}"><i class="ti ${icon}"></i>${d > 0 ? "+" : ""}${U.fmt(d)}</span>`;
  },

  buildChartTooltip(ttEl, ctx2, buildContent, wrapSelector) {
    if (ctx2.tooltip.opacity === 0) { ttEl.style.display = "none"; return; }
    const idx = ctx2.tooltip.dataPoints[0].dataIndex;
    ttEl.innerHTML = buildContent(idx);
    const wrap = document.querySelector(wrapSelector);
    if (!wrap) return;

    // Mostra (display block) per misurare la larghezza reale
    ttEl.style.display = "block";
    const ttW = ttEl.offsetWidth;
    const ttH = ttEl.offsetHeight;
    const wrapW = wrap.offsetWidth;

    // Centrato orizzontalmente sopra il punto
    let left = ctx2.tooltip.caretX - ttW / 2;
    // Clamp: non esce dai bordi (8px di margine)
    if (left < 8) left = 8;
    if (left + ttW > wrapW - 8) left = wrapW - ttW - 8;

    // Sopra il punto; se non c'è spazio sopra, sotto
    let top = ctx2.tooltip.caretY - ttH - 14;
    if (top < 0) top = ctx2.tooltip.caretY + 14;

    ttEl.style.left = left + "px";
    ttEl.style.top  = top + "px";
  },

  baseChartOptions(ttEl, buildContent, wrapSelector) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: ctx2 => U.buildChartTooltip(ttEl, ctx2, buildContent, wrapSelector),
        },
      },
      scales: {
        x: {
          ticks: { color: "#52525C", font: { family: "DM Mono", size: 10 }, maxRotation: 0 },
          grid:  { color: "rgba(255,255,255,.04)" },
          border:{ color: "rgba(255,255,255,.07)" },
        },
        y: {
          ticks: { color: "#52525C", font: { family: "DM Mono", size: 10 } },
          grid:  { color: "rgba(255,255,255,.05)" },
          border:{ color: "rgba(255,255,255,.07)" },
        },
      },
    };
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
