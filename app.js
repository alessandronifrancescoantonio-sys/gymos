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

    // Carica dati pagina. I loader sono async: senza catch un errore (es.
    // rete caduta) diventava unhandled rejection e pagina mezza vuota senza
    // alcun feedback — ora almeno un toast, come già fa boot().
    const fail = e => { console.error(`load ${page}:`, e); if (typeof U !== "undefined" && U.toast) U.toast("Errore nel caricamento — riprova", "err"); };
    switch(page) {
      case "dashboard":   Dashboard.load().catch(fail); break;
      case "session":     Session.load().catch(fail);   break;
      case "cardio":      Cardio.load().catch(fail);    break;
      case "progression": Progression.load().catch(fail); break;
      case "body":        Body.load().catch(fail);      break;
      case "diary":       Diary.load().catch(fail);     break;
      case "schede":      Schede.load().catch(fail); PredictiveCoach.load().catch(fail); break;
      case "report":      WeeklyReport.loadHistory().catch(fail); break;
      case "science":     ScienceUpdates.load().catch(fail); break;
    }
  },

  async boot() {
    const loading = document.getElementById("loading");
    const fill    = document.getElementById("loading-fill");
    const msg     = document.getElementById("loading-msg");
    const retryBtn = document.getElementById("boot-retry-btn");

    // Riavvio (via bottone Riprova): riporta la schermata allo stato iniziale
    loading.style.display = "flex"; loading.style.opacity = "1";
    retryBtn.style.display = "none";

    // Step 1 — test connessione
    setProgress(20, "Connessione a Notion...");
    const ok = await API.testConnection().catch(() => false);

    if (!ok) {
      // Prima non c'era via d'uscita se non ricaricare manualmente la pagina:
      // ora un bottone Riprova richiama boot() senza refresh.
      setProgress(100, "Errore connessione — controlla la rete o config.js");
      setConnStatus(false);
      retryBtn.style.display = "inline-flex";
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

  // ─── Toast non invasivo: U.toast("Salvato", "ok") | "err" | "info" ───
  toast(msg, kind = "ok", ms = 2200) {
    let wrap = document.getElementById("toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "toast-wrap"; document.body.appendChild(wrap); }
    const icon = kind === "err" ? "alert-triangle" : kind === "info" ? "info-circle" : "check";
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    // textContent per il messaggio: può contenere nomi esercizio da Notion —
    // innerHTML li interpreterebbe come markup.
    el.innerHTML = `<i class="ti ti-${icon}"></i><span></span>`;
    el.querySelector("span").textContent = String(msg == null ? "" : msg);
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      el.addEventListener("animationend", () => el.remove(), { once: true });
    }, ms);
  },

  // Un esercizio di una scheda può essere una stringa (vecchio formato) o
  // un oggetto { nome, serie } (nuovo formato). Questi helper li normalizzano.
  exName: item => typeof item === "string" ? item : ((item && item.nome) || ""),
  // Nome-base NORMALIZZATO di un esercizio: primo segmento del titolo log
  // ("Nome – Sessione – S1" → "Nome") ripulito da spazi estremi/doppi. Serve a
  // far combaciare storico e "volta scorsa" anche quando il nome ha un drift
  // (spazio finale, doppio spazio): senza, il confronto per nome esatto falliva
  // e un esercizio già fatto risultava "mai fatto".
  exBase: t => String(t == null ? "" : t).split(" – ")[0].trim().replace(/\s+/g, " "),
  exSets: item => typeof item === "string" ? 1 : Math.max(1, (item && item.serie) || 1),
  exRest: item => (item && typeof item === "object" && item.recupero != null) ? item.recupero : null,
  exRir:  item => (item && typeof item === "object" && item.rir != null) ? item.rir : null,
  exTec:  item => (item && typeof item === "object" && Array.isArray(item.tecnica)) ? item.tecnica : [],
  exCad:  item => (item && typeof item === "object" && item.cadenza) ? item.cadenza : "",
  exInfo: item => (item && typeof item === "object" && item.info) ? item.info : "",
  exGrp:  item => (item && typeof item === "object" && item.gruppo) ? item.gruppo : "",
  exRrMin: item => (item && typeof item === "object" && item.rrMin != null) ? item.rrMin : 8,
  exRrMax: item => (item && typeof item === "object" && item.rrMax != null) ? item.rrMax : 12,

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

  // Data LOCALE, non UTC: toISOString() tra mezzanotte e le 01:00/02:00
  // italiane restituiva ancora IERI — diario/habits/sessioni finivano sul
  // giorno sbagliato (stesso fix già presente in ProgressPhotos._localDate).
  today() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
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

    // Il contenitore di riferimento è SEMPRE quello che racchiude il canvas
    // (position:relative). caretX/caretY sono relativi al canvas → coordinate
    // coerenti. Sposto la tooltip dentro a quel contenitore così il suo
    // position:absolute si calcola rispetto ad esso (prima usciva fuori schermo).
    const wrap = (ctx2.chart && ctx2.chart.canvas && ctx2.chart.canvas.parentElement)
      || document.querySelector(wrapSelector);
    if (!wrap) return;
    if (ttEl.parentElement !== wrap) wrap.appendChild(ttEl);

    ttEl.style.display = "block";
    const ttW = ttEl.offsetWidth, ttH = ttEl.offsetHeight, wrapW = wrap.offsetWidth;

    // Centrata orizzontalmente sul punto, senza uscire dai bordi (6px di margine)
    let left = ctx2.tooltip.caretX - ttW / 2;
    if (left < 6) left = 6;
    if (left + ttW > wrapW - 6) left = wrapW - ttW - 6;

    // Sopra il punto; se non c'è spazio, subito sotto
    let top = ctx2.tooltip.caretY - ttH - 12;
    if (top < 4) top = ctx2.tooltip.caretY + 16;

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
