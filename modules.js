// ═══════════════════════════════════════════════
//  GymOS — progression.js
// ═══════════════════════════════════════════════
const Progression = {
  activeScheda: Object.keys(CONFIG.SCHEDE)[0],
  activeEx:     null,
  history:      [],
  chart:        null,

  async load() {
    // Protezione: se la scheda attiva non esiste più (es. rinominata su Notion),
    // riparti dalla prima scheda disponibile. Non cambia nulla nel caso normale.
    const keys = Object.keys(CONFIG.SCHEDE);
    if (!keys.length) return;
    if (!CONFIG.SCHEDE[this.activeScheda]) this.activeScheda = keys[0];
    this.activeEx = U.exName(CONFIG.SCHEDE[this.activeScheda].exercises[0]);
    this.buildSchedaBtns();
    this.buildExTabs();
    await this.loadHistory();
  },

  buildSchedaBtns() {
    const wrap = document.getElementById("prog-scheda-btns");
    wrap.innerHTML = "";
    Object.keys(CONFIG.SCHEDE).forEach(name => {
      const b = document.createElement("button");
      b.className = "pill-btn" + (name === this.activeScheda ? " on" : "");
      b.textContent = name;
      b.onclick = () => {
        this.activeScheda = name;
        this.activeEx = U.exName(CONFIG.SCHEDE[name].exercises[0]);
        this.buildSchedaBtns();
        this.buildExTabs();
        this.loadHistory();
      };
      wrap.appendChild(b);
    });
  },

  buildExTabs() {
    const wrap = document.getElementById("prog-ex-tabs");
    wrap.innerHTML = "";
    const scheda = CONFIG.SCHEDE[this.activeScheda];
    scheda.exercises.forEach(item => {
      const exName = U.exName(item);
      const b = document.createElement("button");
      b.className = "pill-btn" + (exName === this.activeEx ? " on" : "");
      b.textContent = exName;
      if (exName === this.activeEx) b.style.background = scheda.color;
      b.onclick = () => { this.activeEx = exName; this.buildExTabs(); this.loadHistory(); };
      wrap.appendChild(b);
    });
  },

  async loadHistory() {
    document.getElementById("prog-ex-name").textContent = this.activeEx;
    try {
      this.history = await API.getExerciseHistory(this.activeEx);
      this.sessions = this.groupSessions();
      this.buildChart();
      this.buildRecords();
      this.buildSessions();
    } catch(e) { console.error("Progression.loadHistory:", e); }
  },

  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },

  // Raggruppa le righe (una per serie) in SESSIONI, con tutte le serie ordinate,
  // scartando quelle vuote (rep 0). Calcola top set, volume e record (PR).
  groupSessions() {
    // Epley — tenuta solo per topKg/topReps (mostrati nella tooltip come "top
    // set" e usati da "I tuoi record"), NON per la linea del grafico: la
    // progressione della SEDUTA è il lavoro totale fatto (tutte le serie),
    // non una stima del massimale su un singolo set (l'utente ha chiarito:
    // più peso e più rep nella totalità delle 3 serie = progresso, anche a
    // parità di set di punta — l'1RM stimato da solo lo nascondeva).
    const e1 = (kg, reps) => (kg > 0 && reps > 0) ? kg * (1 + reps / 30) : reps;
    const groups = {};
    (this.history || []).forEach(r => {
      // una sessione = un giorno (il nome scheda non è univoco tra sessioni diverse)
      const key = String(r.date);
      const setLabel = (r.name || "").split(" – ").pop() || "";
      const m = setLabel.match(/S(\d+)/);
      if (!groups[key]) groups[key] = { key, date: r.date, series: [], note: "" };
      const g = groups[key];
      g.series.push({ n: m ? parseInt(m[1]) : g.series.length + 1, reps: r.reps || 0, kg: r.kg || 0 });
      if (r.note && !g.note) g.note = r.note;
    });
    let out = Object.values(groups).map(g => {
      g.series = g.series.filter(s => s.reps > 0).sort((a, b) => a.n - b.n);
      let top = g.series[0] || { kg: 0, reps: 0 };
      g.series.forEach(s => { if (e1(s.kg, s.reps) > e1(top.kg, top.reps)) top = s; });
      g.topKg   = top.kg || 0;
      g.topReps = top.reps || 0;
      g.topE1   = Math.round(e1(top.kg, top.reps) * 10) / 10;
      g.volume  = g.series.reduce((t, s) => t + s.reps * (s.kg || 0), 0);
      g.repsTot = g.series.reduce((t, s) => t + s.reps, 0);
      return g;
    }).filter(g => g.series.length)
      .sort((a, b) => new Date(a.date) - new Date(b.date));   // dal più vecchio al più recente
    // Record: il VOLUME TOTALE della seduta (peso libero: rep totali) supera
    // il massimo di tutte le sessioni precedenti — "stesso set di punta ma
    // tutte le serie più solide" ora conta come progresso, non solo "peso
    // massimo alzato".
    // isBW è una decisione GLOBALE (quale metro usa l'intero grafico: kg di
    // volume o conteggio rep) — ma se l'esercizio passa nel tempo da corpo
    // libero a pesato (es. trazioni → trazioni zavorrate), le vecchie sedute
    // a corpo libero avrebbero kg=0 e quindi volume=0: un falso crollo a
    // zero, non un vero calo. `progVal` è null in quel caso — un buco onesto
    // nella linea, non un valore fasullo comparabile.
    const isBW = out.every(g => g.topKg === 0);
    out.forEach(g => { g.progVal = isBW ? g.repsTot : (g.topKg === 0 ? null : g.volume); });
    let running = 0;
    out.forEach((g, i) => {
      if (g.progVal == null) { g.isPR = false; return; }
      g.isPR = i > 0 && g.progVal > running && g.progVal > 0;
      running = Math.max(running, g.progVal);
    });
    return out;
  },

  buildChart() {
    const s = this.sessions || [];
    const canvas = document.getElementById("prog-chart");
    const caption = document.getElementById("prog-chart-caption");
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    if (!s.length || !canvas) return;
    const color = CONFIG.SCHEDE[this.activeScheda].color;
    const isBW  = s.every(g => g.topKg === 0);
    const labels = s.map(g => U.fmtDate(g.date));
    // Linea = VOLUME TOTALE della seduta (peso × ripetizioni, sommato su
    // tutte le serie) — la progressione reale dell'esercizio quella seduta,
    // non una stima del massimale su un solo set: più peso e più rep nella
    // totalità delle serie conta, anche se il set di punta resta invariato.
    // g.progVal è null per una seduta a corpo libero dentro uno storico
    // altrimenti pesato (non confrontabile in kg) — Chart.js lascia un buco
    // onesto nella linea invece di un falso crollo a zero.
    const data = s.map(g => g.progVal);
    if (caption) caption.textContent = isBW ? "Linea = ripetizioni totali della seduta (tutte le serie sommate)." : "Linea = volume totale della seduta (peso × ripetizioni, sommato su tutte le serie) — non solo il set migliore.";
    const validData = data.filter(v => v != null);
    const minD = validData.length ? Math.min(...validData) : 0, maxD = validData.length ? Math.max(...validData) : 1;
    const pad  = (maxD - minD) * 0.3 || 3;
    const ptColors = s.map(g => g.isPR ? "#F59E0B" : color);
    const ptRadius = s.map(g => g.isPR ? 8 : 5);
    const ttEl = document.getElementById("prog-tt");
    const opts = U.baseChartOptions(ttEl, idx => {
      const g = s[idx];
      const prTag = g.isPR ? '<span class="tt-pr">Record</span>' : "";
      const setsStr = g.series.map(x => isBW ? x.reps + "r" : U.fmt(x.kg) + "×" + x.reps).join("  ");
      const mainVal = g.progVal == null ? `${g.repsTot} rep (corpo libero, non confrontabile a volume)` : (isBW ? `${g.progVal} rep totali` : U.fmtV(g.progVal));
      return `
        <div class="tt-date">Sett. ${U.weekNum(g.date)} — ${U.fmtDate(g.date)}</div>
        <div class="tt-main" style="color:${color}">${mainVal}${prTag}</div>
        <div class="tt-sub">${isBW || g.progVal == null ? "" : `Top set: ${U.fmt(g.topKg)}kg × ${g.topReps} · `}${g.series.length} serie · ${setsStr}</div>
      `;
    }, ".card");
    opts.scales.y.min = Math.max(0, minD - pad);
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => isBW ? U.fmt(v) + " r" : U.fmtV(v);
    this.chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: "transparent", spanGaps: false,
        borderWidth: 2.5, pointRadius: ptRadius, pointBackgroundColor: ptColors,
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 9, tension: .35 }] },
      options: opts,
    });
  },

  // "I tuoi record" per l'esercizio selezionato: peso max, 1RM stimato (Epley),
  // rep massime, volume record. Calcolati dallo storico completo (this.history).
  buildRecords() {
    const wrap   = document.getElementById("prog-records");
    const nameEl = document.getElementById("prog-rec-name");
    if (nameEl) nameEl.textContent = this.activeEx || "";
    if (!wrap) return;
    const sets = (this.history || []).filter(s => (s.reps || 0) > 0);
    if (!sets.length) {
      wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-trophy"></i><span class="es-title">Ancora nessun record</span><span class="es-sub">Registra questo esercizio in una sessione per sbloccare i tuoi record.</span></div>';
      return;
    }
    const e1 = (kg, reps) => (kg > 0 && reps > 0) ? Math.round(kg * (1 + reps / 30) * 10) / 10 : 0;
    const isBW = sets.every(s => (s.kg || 0) === 0);
    let heavy = sets[0];
    sets.forEach(s => { if ((s.kg || 0) > (heavy.kg || 0) || ((s.kg || 0) === (heavy.kg || 0) && s.reps > heavy.reps)) heavy = s; });
    let bestE = { v: 0, s: null };
    sets.forEach(s => { const v = e1(s.kg || 0, s.reps); if (v > bestE.v) bestE = { v, s }; });
    let repMax = sets[0];
    sets.forEach(s => { if (s.reps > repMax.reps) repMax = s; });
    let volMax = { volume: 0, repsTot: 0, date: null };
    (this.sessions || []).forEach(g => { if (g.volume > volMax.volume) volMax = g; });

    const tile = (icon, color, val, lbl, sub) => `
      <div class="rec-tile">
        <div class="rec-ic" style="color:${color}"><i class="ti ${icon}"></i></div>
        <div class="rec-main">
          <div class="rec-val">${val}</div>
          <div class="rec-lbl">${lbl}</div>
          ${sub ? `<div class="rec-sub">${sub}</div>` : ""}
        </div>
      </div>`;
    let html = "";
    if (!isBW) {
      html += tile("ti-barbell", "var(--accent)", `${U.fmt(heavy.kg)} <small>kg</small>`, "Peso massimo", `× ${heavy.reps} rep · ${U.fmtDate(heavy.date)}`);
      html += tile("ti-trending-up", "var(--amber)", `${U.fmt(bestE.v)} <small>kg</small>`, "1RM stimato", "stima Epley");
    }
    html += tile("ti-repeat", "#3B82F6", `${repMax.reps} <small>rep</small>`, "Rep massime", isBW ? U.fmtDate(repMax.date) : `a ${U.fmt(repMax.kg)} kg`);
    html += tile("ti-stack-2", "var(--green)", isBW ? `${volMax.repsTot} <small>rep</small>` : `${U.fmtV(volMax.volume)}`, "Volume record", volMax.date ? U.fmtDate(volMax.date) : "");
    wrap.innerHTML = html;
  },

  // Una scheda per sessione (più recente in alto) con TUTTE le serie fatte.
  buildSessions() {
    const wrap = document.getElementById("prog-sessions");
    if (!wrap) return;
    const sessions = this.sessions || [];
    if (!sessions.length) {
      wrap.innerHTML = '<div class="empty-state"><i class="ti ti-history"></i><span class="es-title">Ancora nessun dato</span><span class="es-sub">Registra questo esercizio in una sessione per vedere le progressioni.</span></div>';
      return;
    }
    const isBW = sessions.every(g => g.topKg === 0);
    let html = "";
    for (let i = sessions.length - 1; i >= 0; i--) {
      const g = sessions[i];
      const prev = i > 0 ? sessions[i - 1] : null;
      const dv = (prev && !isBW) ? g.volume - prev.volume : null;
      const seriesHTML = g.series.map(x =>
        `<div class="ps-set">
          <span class="ps-sn">S${x.n}</span>
          ${isBW
            ? `<span class="ps-val">${x.reps}<small>rep</small></span>`
            : `<span class="ps-val">${U.fmt(x.kg)}<small>kg</small></span><span class="ps-x">×</span><span class="ps-val">${x.reps}<small>rep</small></span>`}
        </div>`).join("");
      html += `
        <div class="prog-sess${g.isPR ? " is-pr" : ""}">
          <div class="ps-head">
            <div class="ps-date">${U.fmtDate(g.date)}<span class="ps-wk">Sett. ${U.weekNum(g.date)}</span></div>
            ${g.isPR ? '<span class="ps-pr"><i class="ti ti-trophy"></i>Record</span>' : ""}
          </div>
          <div class="ps-sets">${seriesHTML}</div>
          <div class="ps-foot">
            <span class="ps-metric">${isBW ? `<b>${g.topReps}</b> rep max` : `<b>${U.fmt(g.topKg)}</b> kg top set`}</span>
            <span class="ps-metric">Volume <b>${isBW ? g.repsTot + " rep" : U.fmtV(g.volume)}</b></span>
            ${dv !== null ? `<span class="ps-delta">${U.deltaHTML(dv)}</span>` : ""}
          </div>
          ${g.note ? `<div class="ps-note"><i class="ti ti-note"></i>${this._esc(g.note)}</div>` : ""}
        </div>`;
    }
    wrap.innerHTML = html;
  },
};

// ═══════════════════════════════════════════════
//  GymOS — body.js
// ═══════════════════════════════════════════════
const Body = {
  checkins:     [],
  activeMisura: CONFIG.MISURE[0].key,
  activeFase:   "Cut",
  pesoChart:    null,
  misuraChart:  null,

  FASE_COLORS: {
    "Cut":   { bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.3)",  text: "#EF4444" },
    "Bulk":  { bg: "rgba(34,197,94,.12)",  border: "rgba(34,197,94,.3)",  text: "#22C55E" },
    "Mant.": { bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.3)", text: "#3B82F6" },
  },

  async load() {
    try {
      this.checkins = await API.getBodyMetrics(30);
      this.render();
    } catch(e) { console.error("Body.load:", e); }
  },

  render() {
    this.buildStats();
    this.buildEnergyFlag();
    this.buildPesoChart();
    this.buildMisureGrid();
    this.buildMisuraChart();
    this.buildFaseRow();
    this.buildHistTable();
    if (typeof ProgressPhotos !== "undefined") ProgressPhotos.renderCard();
  },

  // #6 PT scientifico — ENERGIA DISPONIBILE (RED-S). Se coincidono un calo di
  // forza DIFFUSO (segnale persistito da Session, non un solo esercizio) e una
  // perdita di peso RAPIDA (>~1%/settimana), avvisa: può essere troppo poca
  // energia disponibile → calano forza, ormoni, recupero (consenso IOC 2023).
  // NON calcola l'EA precisa (servirebbe un diario alimentare, fuori scope):
  // cita il concetto e la soglia proteica evidence-based (Morton 2018: la
  // curva si appiattisce a ~1,6 g/kg, tetto difendibile ~2,2 g/kg).
  _energyFlag() {
    try {
      const sig = JSON.parse(localStorage.getItem("gymos_strength_signal") || "null");
      if (!sig || !sig.down) return null;
      // Segnale forza troppo vecchio (>28 gg) → non più affidabile
      if (sig.ts && (Date.now() - sig.ts) > 28 * 86400000) return null;

      const w = this.checkins.filter(c => c.peso != null && c.peso > 0);
      if (w.length < 2) return null;
      const last = w[w.length - 1];
      const lastT = new Date(last.date).getTime();
      // Riferimento: il check-in più vecchio in una finestra di 10-45 giorni
      let ref = null;
      for (const c of w) {
        const dd = (lastT - new Date(c.date).getTime()) / 86400000;
        if (dd >= 10 && dd <= 45) { ref = c; break; }
      }
      if (!ref) return null;
      const days = (lastT - new Date(ref.date).getTime()) / 86400000;
      const dKg  = Math.round((last.peso - ref.peso) * 10) / 10;
      if (dKg >= 0 || days <= 0) return null;                 // non sta calando
      const pctPerWeek = (dKg / ref.peso) * 100 / (days / 7);
      if (pctPerWeek > -1.0) return null;                     // calo non "rapido"

      const pMin = Math.round(last.peso * 1.6);
      const pMax = Math.round(last.peso * 2.2);
      return { dKg: Math.abs(dKg), days: Math.round(days), pMin, pMax,
        rate: Math.abs(Math.round(pctPerWeek * 10) / 10) };
    } catch (e) { return null; }
  },

  buildEnergyFlag() {
    const el = document.getElementById("energy-flag");
    if (!el) return;
    const f = this._energyFlag();
    if (!f) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="energy-flag">
        <i class="ti ti-bolt"></i>
        <div class="ef-txt">
          <span class="ef-title">Occhio all'energia disponibile</span>
          <span class="ef-body">La forza cala su più esercizi <b>e</b> il peso scende in fretta (−${U.fmt(f.dKg)} kg in ${f.days} giorni, ~${U.fmt(f.rate)}%/settimana). Un deficit troppo aggressivo (RED-S) fa calare forza, ormoni e recupero. Tieni le proteine alte — per te <b>~${f.pMin}–${f.pMax} g al giorno</b> — e valuta di rallentare il taglio.</span>
        </div>
      </div>`;
  },

  last()  { return this.checkins[this.checkins.length - 1] || {}; },
  first() { return this.checkins[0] || {}; },
  delta(key) {
    const l = this.last()[key], f = this.first()[key];
    return (l != null && f != null) ? Math.round((l - f) * 10) / 10 : null;
  },

  buildStats() {
    const l  = this.last();
    const fc = this.FASE_COLORS[l.fase] || this.FASE_COLORS["Mant."];
    document.getElementById("fase-badge-hd").innerHTML =
      `<span class="fase-badge" style="background:${fc.bg};border-color:${fc.border};color:${fc.text}">${l.fase || "—"}</span>`;

    const dp = this.delta("peso");
    const strip = document.getElementById("body-stats");
    strip.innerHTML = `
      <div class="bstat"><div class="bstat-v">${U.fmt(l.peso)}<span class="bstat-u">kg</span></div><div class="bstat-l">Peso attuale</div>${dp != null ? `<div class="bstat-d" style="color:${dp < 0 ? "var(--green)" : "var(--red)"}">${dp > 0 ? "+" : ""}${U.fmt(dp)} kg da inizio</div>` : ""}</div>
      <div class="bstat"><div class="bstat-v">${U.fmt(l.bf)}<span class="bstat-u">%</span></div><div class="bstat-l">% Grasso</div></div>
      <div class="bstat"><div class="bstat-v">${U.fmt(l.vita)}<span class="bstat-u">cm</span></div><div class="bstat-l">Vita</div></div>
      <div class="bstat"><div class="bstat-v">${this.checkins.length}</div><div class="bstat-l">Check-in totali</div></div>
    `;
  },

  buildPesoChart() {
    // distruggi PRIMA del return su dati vuoti (altrimenti l'istanza resta viva)
    if (this.pesoChart && !this.checkins.length) { this.pesoChart.destroy(); this.pesoChart = null; }
    if (!this.checkins.length) return;
    const data   = this.checkins.map(c => c.peso);
    const labels = this.checkins.map(c => U.fmtDate(c.date));
    const minD   = Math.min(...data.filter(Boolean));
    const maxD   = Math.max(...data.filter(Boolean));
    const pad    = (maxD - minD) * 0.4 || 0.5;
    const ttEl   = document.getElementById("peso-tt");
    const h      = this.checkins;

    if (this.pesoChart) this.pesoChart.destroy();
    const ctx = document.getElementById("peso-chart").getContext("2d");
    const opts = U.baseChartOptions(ttEl, idx => {
      const c  = h[idx];
      const dp = idx > 0 ? Math.round((c.peso - h[idx-1].peso) * 10) / 10 : null;
      return `
        <div class="tt-date">${U.fmtDate(c.date)}</div>
        <div class="tt-main" style="color:#FF3B2F">${U.fmt(c.peso)} kg</div>
        ${dp != null ? `<div class="tt-sub" style="color:${dp < 0 ? "var(--green)" : "var(--red)"}">${dp > 0 ? "+" : ""}${U.fmt(dp)} vs prec.</div>` : ""}
        ${c.note ? `<div class="tt-note">${c.note}</div>` : ""}
      `;
    }, ".card");
    opts.scales.y.min = minD - pad;
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => v.toFixed(1) + " kg";

    this.pesoChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: "#FF3B2F", backgroundColor: "transparent",
        borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: "#FF3B2F",
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 8, tension: .35 }] },
      options: opts,
    });
  },

  buildMisureGrid() {
    const grid = document.getElementById("misure-grid");
    const l    = this.last();
    grid.innerHTML = "";
    CONFIG.MISURE.forEach(m => {
      const val = l[m.key];
      const d   = this.delta(m.key);
      const dColor = d == null ? "var(--dim)" : (m.downGood ? (d < 0 ? "var(--green)" : "var(--red)") : (d > 0 ? "var(--green)" : "var(--red)"));
      const card = document.createElement("div");
      card.className = "misura-card" + (m.key === this.activeMisura ? " active" : "");
      card.innerHTML = `
        <div class="misura-name">${m.label}</div>
        <div class="misura-val">${U.fmt(val)}<span class="misura-unit">${m.unit}</span></div>
        ${d != null ? `<div class="misura-delta" style="color:${dColor}">${d > 0 ? "+" : ""}${U.fmt(d)} ${m.unit}</div>` : ""}
      `;
      card.onclick = () => { this.activeMisura = m.key; this.buildMisureGrid(); this.buildMisuraChart(); };
      grid.appendChild(card);
    });
  },

  buildMisuraChart() {
    if (this.misuraChart && !this.checkins.length) { this.misuraChart.destroy(); this.misuraChart = null; }
    if (!this.checkins.length) return;
    const m      = CONFIG.MISURE.find(x => x.key === this.activeMisura);
    const data   = this.checkins.map(c => c[m.key]);
    const labels = this.checkins.map(c => U.fmtDate(c.date));
    const valid  = data.filter(Boolean);
    // Misura mai compilata in nessun check-in: Math.min(...[]) darebbe
    // Infinity → assi y NaN e grafico rotto. Distruggi e esci puliti.
    if (!valid.length) { if (this.misuraChart) { this.misuraChart.destroy(); this.misuraChart = null; } return; }
    const minD   = Math.min(...valid), maxD = Math.max(...valid);
    const pad    = (maxD - minD) * 0.4 || 0.5;
    const ttEl   = document.getElementById("misura-tt");
    const h      = this.checkins;

    if (this.misuraChart) this.misuraChart.destroy();
    const ctx  = document.getElementById("misura-chart").getContext("2d");
    const opts = U.baseChartOptions(ttEl, idx => {
      const c  = h[idx];
      const dv = idx > 0 ? Math.round((c[m.key] - h[idx-1][m.key]) * 10) / 10 : null;
      return `
        <div class="tt-date">${U.fmtDate(c.date)}</div>
        <div class="tt-main" style="color:${m.color}">${U.fmt(c[m.key])} ${m.unit}</div>
        ${dv != null ? `<div class="tt-sub" style="color:${m.downGood ? (dv < 0 ? "var(--green)" : "var(--red)") : (dv > 0 ? "var(--green)" : "var(--red)")}">${dv > 0 ? "+" : ""}${U.fmt(dv)} vs prec.</div>` : ""}
      `;
    }, ".card");
    opts.scales.y.min = minD - pad;
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => U.fmt(v) + " " + m.unit;

    this.misuraChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: m.color, backgroundColor: "transparent",
        borderWidth: 2, pointRadius: 5, pointBackgroundColor: m.color,
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 8, tension: .35 }] },
      options: opts,
    });
  },

  buildFaseRow() {
    const row = document.getElementById("fase-row");
    row.innerHTML = "";
    Object.keys(this.FASE_COLORS).forEach(f => {
      const b = document.createElement("button");
      b.className = "pill-btn" + (f === this.activeFase ? " on" : "");
      b.textContent = f;
      b.onclick = () => { this.activeFase = f; this.buildFaseRow(); };
      row.appendChild(b);
    });
  },

  buildHistTable() {
    const tbody = document.getElementById("body-hist-tbody");
    tbody.innerHTML = "";
    [...this.checkins].reverse().forEach((c, ri) => {
      const i    = this.checkins.length - 1 - ri;
      const prev = i > 0 ? this.checkins[i - 1] : null;
      const dp   = prev ? Math.round((c.peso - prev.peso) * 10) / 10 : null;
      const fc   = this.FASE_COLORS[c.fase] || this.FASE_COLORS["Mant."];
      const faseBadge = `<span class="fase-badge" style="background:${fc.bg};color:${fc.text};border-color:${fc.border}">${c.fase || "—"}</span>`;
      const dpHTML    = dp != null ? U.deltaHTML(dp, true) : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${U.fmtDate(c.date)}</td><td>${faseBadge}</td>
        <td class="mono">${U.fmt(c.peso)} kg</td><td>${dpHTML}</td>
        <td class="mono">${U.fmt(c.vita)} cm</td><td class="mono">${U.fmt(c.petto)} cm</td>
        <td class="mono">${U.fmt(c.coscia)} cm</td><td class="mono">${U.fmt(c.braccio)} cm</td>
        <td class="mono">${U.fmt(c.bf)}%</td>
        <td class="note-text">${c.note || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  async addCheckin() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const note = document.getElementById("inp-note-body")?.value || "";
    const peso = get("inp-peso");
    if (!peso) return;
    const data = {
      fase: this.activeFase, peso,
      vita:    get("inp-vita"),
      petto:   get("inp-petto"),
      fianchi: get("inp-fianchi"),
      coscia:  get("inp-coscia"),
      braccio: get("inp-braccio"),
      bf:      get("inp-bf"),
      note,
    };
    await API.saveBodyCheckin(data);
    ["inp-peso","inp-vita","inp-petto","inp-fianchi","inp-coscia","inp-braccio","inp-bf","inp-note-body"]
      .forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = ""; });
    await this.load();
    const msg = document.getElementById("body-save-msg");
    msg.style.display = "flex";
    setTimeout(() => msg.style.display = "none", 2500);
  },
};

function addCheckin() { Body.addCheckin(); }

// ═══════════════════════════════════════════════
//  GymOS — dashboard.js
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  GymOS — Volume settimanale per gruppo muscolare
//  Conteggio frazionato (primario 1, secondario 0,5), target 10–20 serie/sett
//  (Schoenfeld et al.). Si riferisce SEMPRE al programma attivo (CONFIG.SCHEDE):
//  se cambi programma, cambia tutto.
// ═══════════════════════════════════════════════
const Volume = {
  MUSCLES: ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Quadricipiti", "Femorali", "Glutei", "Polpacci", "Adduttori", "Addome", "Avambracci"],
  MEV: 10, MAV_HI: 20,   // zona ottimale (MAV): 10–20 serie/settimana

  // Classificatore automatico per nome esercizio → {muscolo: frazione}.
  // L'ORDINE conta: i pattern specifici stanno prima di quelli generici.
  classify(name) {
    const s = " " + (name || "").toLowerCase() + " ";
    const t = re => re.test(s);
    if (t(/polpacc|calf/)) return { Polpacci: 1 };
    if (t(/addutt/)) return { Adduttori: 1 };
    if (t(/addome|crunch|plank|abs |core|oblique/)) return { Addome: 1 };
    if (t(/glute|hip thrust|ponte/)) return { Glutei: 1 };
    if (t(/rdl|stacco rumeno|romanian|good morning/)) return { Femorali: 1, Glutei: 0.5 };
    if (t(/leg curl|femoral|nordic/)) return { Femorali: 1 };
    if (t(/leg ext|quadric/)) return { Quadricipiti: 1 };
    if (t(/squat|pressa|leg press|pendulum|belt|hack|affond|lunge|pistol/)) return { Quadricipiti: 1, Glutei: 0.5 };
    if (t(/avambracc|wrist|polso|forearm/)) return { Avambracci: 1 };
    if (t(/martell|hammer/)) return { Bicipiti: 1 };
    if (t(/curl|scott|bayes|bicip|preacher/)) return { Bicipiti: 1 };
    if (t(/push ?down|skull|french|overhead ext|tric|dip|kick ?back/)) return { Tricipiti: 1 };
    // Deltoidi posteriori PRIMA di "spalle" generico: niente tricipiti fantasma
    if (t(/rear|posterior|pec back|reverse|face pull/)) return { Spalle: 1 };
    if (t(/alz lat|laterali|lateral raise|alzate/)) return { Spalle: 1 };
    // "distensioni sopra la testa / militari / lento" = spinte sopra la testa →
    // SPALLE, da distinguere dalle "distensioni su panca/manubri" = PETTO sotto.
    if (t(/shoulder press|overhead press|militar|lento avanti|lento dietro|arnold|spalle|distensioni.*(sopra|alto|testa|dietro)/)) return { Spalle: 1, Tricipiti: 0.5 };
    if (t(/row|pulley|rematore|low row|lat mach|pulldown|trazion|pull ?up|upper back|dorso/)) return { Dorso: 1, Bicipiti: 0.5 };
    // Croci/fly: il gomito non si estende → niente tricipiti
    if (t(/croci|fly|pec deck/)) return { Petto: 1, Spalle: 0.5 };
    // "distensioni/distensione" (IT per le spinte) = petto di default (panca,
    // manubri, inclinata); le varianti sopra la testa sono già andate a Spalle.
    if (t(/pec|chest|panca|bench|dist |distension|piegament|push ?up|press/)) return { Petto: 1, Spalle: 0.5, Tricipiti: 0.5 };
    return {};   // sconosciuto → l'utente assegna a mano
  },

  // #3 PT scientifico — PATTERN di movimento, per valutare quanto un esercizio
  // è un buon SOSTITUTO di un altro (macchinario occupato ecc.). Non basta lo
  // stesso muscolo: la panca e le croci colpiscono il petto ma con pattern
  // diversi (spinta vs isolamento). L'isolamento monoarticolare va riconosciuto
  // PRIMA dei composti, e i composti hinge PRIMA dell'isolamento gambe (un RDL
  // non è isolamento). Ritorna: push | pull | squat | hinge | iso | core | calf.
  pattern(name) {
    const s = " " + (name || "").toLowerCase() + " ";
    const t = re => re.test(s);
    if (t(/polpacc|calf/)) return "calf";
    if (t(/addome|crunch|plank|abs |core|oblique|addutt/)) return "core";
    if (t(/rdl|stacco|romanian|good morning|hip thrust|deadlift/)) return "hinge";
    if (t(/squat|pressa|leg press|pendulum|belt|hack|affond|lunge|pistol/)) return "squat";
    if (t(/leg ext|leg curl|nordic|femoral/)) return "iso";
    if (t(/curl|scott|bayes|preacher|martell|hammer|bicip/)) return "iso";
    if (t(/push ?down|skull|french|overhead ext|kick ?back|tric/)) return "iso";
    if (t(/alz lat|laterali|lateral raise|alzate|rear|posterior|reverse|face pull|croci|\bfly\b|pec deck/)) return "iso";
    if (t(/avambracc|wrist|polso|forearm/)) return "iso";
    if (t(/row|pulley|rematore|low row|lat mach|pulldown|trazion|pull ?up|upper back/)) return "pull";
    if (t(/shoulder press|overhead press|military|lento|arnold|panca|bench|dist |distension|piegament|push ?up|\bdip\b|press|chest/)) return "push";
    return "";
  },

  _primary(name) {
    const m = this.musclesFor(name) || {};
    return Object.keys(m).find(k => m[k] >= 1) || null;
  },

  // Livello di `cand` come sostituto di `name`:
  //  "A" = stesso muscolo primario E stesso pattern (ottimo sostituto)
  //  "B" = stesso muscolo primario, pattern diverso (sostituto parziale)
  //  null = non è un sostituto
  subLevel(name, cand) {
    if (!name || !cand || name === cand) return null;
    const pa = this._primary(name), pb = this._primary(cand);
    if (!pa || !pb || pa !== pb) return null;
    const ma = this.pattern(name), mb = this.pattern(cand);
    return (ma && ma === mb) ? "A" : "B";
  },

  // Miglior sostituto tra gli esercizi già noti all'utente: preferisce il Livello A.
  bestSubstitute(name, candidates) {
    let a = null, b = null;
    (candidates || []).forEach(c => {
      const lvl = this.subLevel(name, c);
      if (lvl === "A" && !a) a = c;
      else if (lvl === "B" && !b) b = c;
    });
    return a ? { name: a, level: "A" } : (b ? { name: b, level: "B" } : null);
  },

  // Sostituto ARTICOLAZIONE-FRIENDLY — criterio OPPOSTO a bestSubstitute.
  // bestSubstitute cerca il più SIMILE (Livello A = stesso muscolo E stesso
  // pattern): giusto quando la macchina è occupata, ma SBAGLIATO per un dolore
  // articolare — stesso pattern = stesso stress sulla stessa articolazione.
  // Qui invece: stesso muscolo primario (l'allenamento non si perde) ma pattern
  // DIVERSO, e a parità preferiamo l'attrezzo guidato (macchina/cavo:
  // traiettoria vincolata, meno lavoro di stabilizzazione sull'articolazione
  // dolente) rispetto a bilanciere/manubri liberi.
  // Traiettoria guidata (macchina/cavo): il carico è vincolato, l'articolazione
  // lavora meno in stabilizzazione. Include i push-down/pulley: sugli ISOLAMENTI
  // l'attrezzo è la variabile che conta (due isolamenti hanno sempre lo stesso
  // "pattern", quindi il pattern da solo non distinguerebbe nulla).
  GUIDED_RE: /macchinar|machine|cavo|cable|pulley|push.?down|smith|pressa|chest press|pec deck|leg ext|leg curl|lat machine|selettor/i,
  FREE_RE: /bilancier|barbell|manubri|dumbbell|corpo libero|bodyweight/i,
  // Movimenti notoriamente esigenti per un'articolazione specifica: skull
  // crusher/french press (gomito), dietro-nuca e tirate al mento (spalla),
  // stacco/good morning (zona lombare). Non sono "cattivi" in assoluto — ma se
  // proprio quell'esercizio ti fa male da 3 sedute, non è lui il rimedio.
  HARSH_RE: /skull|french press|dietro la nuca|behind neck|upright row|tirate al mento|stacco|deadlift|good morning/i,

  // Quanto un esercizio "chiede" all'articolazione (più alto = più esigente).
  _jointStress(name) {
    let s = 0;
    if (this.GUIDED_RE.test(name)) s -= 2;
    if (this.FREE_RE.test(name))   s += 1;
    if (this.HARSH_RE.test(name))  s += 2;
    return s;
  },

  jointFriendlySubstitute(name, candidates) {
    // I candidati possono arrivare come stringa (legacy) O come oggetto
    // {nome,...} (schede da Notion): normalizza sempre, come fa _subFor.
    const asName = it => (typeof it === "string") ? it : (it && (it.nome || it.name)) || "";
    name = asName(name);
    const pa = this._primary(name);
    if (!pa) return null;
    const patA = this.pattern(name);
    const stressA = this._jointStress(name);
    let best = null, bestScore = 0;   // 0 = soglia: deve essere STRETTAMENTE più gentile
    (candidates || []).map(asName).forEach(c => {
      if (!c || c === name) return;
      if (this._primary(c) !== pa) return;              // deve allenare lo stesso muscolo
      const patC = this.pattern(c);
      let score = 0;
      if (patC && patA && patC !== patA) score += 3;    // movimento diverso = stress diverso
      score += (stressA - this._jointStress(c));        // quanto è più gentile del corrente
      if (score > bestScore) { bestScore = score; best = c; }
    });
    // Nessun candidato strettamente più gentile → null, e lo diciamo onestamente
    // all'utente invece di proporgli lo stesso problema con un altro nome.
    return best ? { name: best, score: bestScore } : null;
  },

  _overrides: null,
  // Chiave normalizzata: gli override del muscolo erano agganciati al nome
  // ESATTO, quindi uno spazio finale, una rinomina o uno spelling diverso tra
  // schede li orfanava (l'assegnazione "non si salvava"/"non si rifletteva").
  // Normalizzando (trim + spazi interni singoli) la scelta manuale combacia
  // col nome dell'esercizio ovunque venga usato (volume previsto E fatto).
  _normKey(name) { return String(name == null ? "" : name).trim().replace(/\s+/g, " "); },
  loadOverrides() {
    if (!this._overrides) {
      let raw;
      try { raw = JSON.parse(localStorage.getItem("gymos_muscle_map") || "{}"); } catch(e) { raw = {}; }
      // Migrazione una-tantum: ri-chiava con la forma normalizzata così i
      // vecchi override con spazi tornano a combaciare. In caso di collisione
      // vince l'ultimo scritto.
      const norm = {}; let changed = false;
      Object.keys(raw).forEach(k => { const nk = this._normKey(k); if (nk !== k) changed = true; if (nk) norm[nk] = raw[k]; });
      this._overrides = norm;
      if (changed) this.saveOverrides();
    }
    return this._overrides;
  },
  saveOverrides() { try { localStorage.setItem("gymos_muscle_map", JSON.stringify(this._overrides || {})); } catch(e){} },
  musclesFor(name) {
    const ov = this.loadOverrides()[this._normKey(name)];
    if (ov) { const m = { [ov.p]: 1 }; (ov.s || []).forEach(x => { if (x !== ov.p) m[x] = 0.5; }); return m; }
    return this.classify(name);
  },
  setPrimary(name, muscle) {
    const ov = this.loadOverrides();
    const key = this._normKey(name);
    if (!muscle || muscle === "—") { delete ov[key]; }   // torna all'automatico
    else {
      const auto = this.classify(name);
      const sec = Object.keys(auto).filter(m => auto[m] < 1 && m !== muscle);
      ov[key] = { p: muscle, s: sec };
    }
    this.saveOverrides();
    this.renderCard();
    this.renderEditor();
  },

  // Volume settimanale pianificato dal programma attivo (ogni seduta 1×/settimana).
  // Separa DIRETTO (muscolo primario, 1 serie) da INDIRETTO (secondario, ½ serie).
  compute() {
    const vol = {}, dir = {}, ind = {};
    this.MUSCLES.forEach(m => { vol[m] = 0; dir[m] = 0; ind[m] = 0; });
    const exList = [];
    Object.values(CONFIG.SCHEDE || {}).forEach(sc => {
      (sc.exercises || []).forEach(it => {
        const name = U.exName(it), sets = U.exSets(it);
        if (!name) return;
        exList.push(name);
        const m = this.musclesFor(name);
        Object.keys(m).forEach(mus => {
          if (vol[mus] == null) { vol[mus] = 0; dir[mus] = 0; ind[mus] = 0; }
          vol[mus] += sets * m[mus];
          if (m[mus] >= 1) dir[mus] += sets; else ind[mus] += sets * m[mus];
        });
      });
    });
    return { vol, dir, ind, exercises: [...new Set(exList)] };
  },

  zone(v) { return v === 0 ? "none" : v < this.MEV ? "low" : v <= this.MAV_HI ? "ok" : "high"; },

  // #batch2 raffinamento 4 — tetto di serie DIRETTE per SINGOLA seduta (non
  // solo il totale settimanale già coperto da MEV/MAV_HI): oltre questa soglia
  // il beneficio marginale in UNA sessione crolla (Nippard/Krieger meta-review,
  // Israetel — convergenza multipla). Dorso/Quadricipiti/Femorali/Glutei
  // tollerano di più per seduta.
  SESSION_SET_CEILING: 8,
  SESSION_SET_CEILING_HIGH: 12,
  _HIGH_TOLERANCE: ["Dorso", "Quadricipiti", "Femorali", "Glutei"],
  sedutaDirectSets(sc) {
    const dir = {};
    (sc.exercises || []).forEach(it => {
      const name = U.exName(it), sets = U.exSets(it);
      if (!name) return;
      const m = this.musclesFor(name);
      Object.keys(m).forEach(mus => { if (m[mus] >= 1) dir[mus] = (dir[mus] || 0) + sets; });
    });
    return dir;
  },
  sedutaOverCeiling(sc) {
    const dir = this.sedutaDirectSets(sc);
    return Object.keys(dir).filter(mus => dir[mus] > (this._HIGH_TOLERANCE.includes(mus) ? this.SESSION_SET_CEILING_HIGH : this.SESSION_SET_CEILING));
  },

  // Inizio settimana corrente (lunedì 00:00), coerente con lo split settimanale
  _weekStart() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));
    return monday;
  },

  // Serie realmente completate questa settimana (dalle sessioni fatte), per muscolo
  async loadActual(sessions) {
    const token = (this._actualToken = (this._actualToken || 0) + 1);
    const monday = this._weekStart();
    const wk = (sessions || []).filter(s => s.date && new Date(s.date) >= monday);
    const actual = {}, aDir = {}, aInd = {};
    this.MUSCLES.forEach(m => { actual[m] = 0; aDir[m] = 0; aInd[m] = 0; });
    let contributed = 0;
    for (const s of wk) {
      try {
        const ex = await API.getSessionExercises(s.id);
        if (token !== this._actualToken) return;   // dashboard ricaricata: abbandona
        let any = false;
        ex.forEach(row => {
          if ((row.reps || 0) <= 0) return;
          any = true;
          const name = U.exBase(row.name);
          const m = this.musclesFor(name);
          Object.keys(m).forEach(mus => {
            if (actual[mus] == null) { actual[mus] = 0; aDir[mus] = 0; aInd[mus] = 0; }
            actual[mus] += m[mus];
            if (m[mus] >= 1) aDir[mus] += 1; else aInd[mus] += m[mus];
          });
        });
        if (any) contributed++;
      } catch(e) { /* ignora la singola sessione non leggibile */ }
    }
    this._actual = actual;
    this._actualDir = aDir; this._actualInd = aInd;
    this._actualCount = contributed;   // solo sessioni con almeno una serie fatta
    this.renderCard();
    const modal = document.getElementById("vol-modal");
    if (modal && modal.style.display === "flex") this.renderEditor();
  },

  // Barra: zona target 10–20 + riempimento (fatto se disponibile, altrimenti
  // pianificato) + marcatore del volume pianificato dal programma.
  barHTML(planned, actual) {
    const max = this.MAV_HI + 6;
    const p = x => Math.min(100, (x / max) * 100);
    const mevPct = (this.MEV / max) * 100, mavPct = (this.MAV_HI / max) * 100;
    const fillVal = actual != null ? actual : planned;
    const mark = actual != null ? `<div class="vol-plan-mark" style="left:${Math.min(99, p(planned))}%" title="Previste dal programma"></div>` : "";
    return `<div class="vol-bar"><div class="vol-zone" style="left:${mevPct}%;width:${mavPct - mevPct}%"></div><div class="vol-fill vz-${this.zone(fillVal)}" style="width:${p(fillVal)}%"></div>${mark}</div>`;
  },
  fmt(v) { return Number.isInteger(v) ? v : v.toFixed(1).replace(".", ","); },

  // Una riga muscolo: mostra "fatto / previsto" se il fatto è disponibile.
  // Con split={dir,ind} aggiunge la scomposizione diretto/indiretto (½) sotto.
  _muscleRow(m, planned, split) {
    const a = this._actual ? (this._actual[m] || 0) : null;
    const shown = a != null ? a : planned;
    let detail = "";
    if (split) {
      detail = a != null
        ? `<div class="vol-split">diretto <b>${this.fmt(this._actualDir[m] || 0)}</b>/${this.fmt(split.dir)} · indiretto <b>${this.fmt(this._actualInd[m] || 0)}</b>/${this.fmt(split.ind)} <span class="vol-frac">(½)</span></div>`
        : `<div class="vol-split">diretto <b>${this.fmt(split.dir)}</b> · indiretto <b>${this.fmt(split.ind)}</b> <span class="vol-frac">(½)</span></div>`;
    }
    return `
      <div class="vol-rowwrap">
        <div class="vol-row">
          <span class="vol-name">${m}</span>
          ${this.barHTML(planned, a)}
          <span class="vol-val vz-${this.zone(shown)}">${this.fmt(shown)}${a != null ? `<span class="vol-plan">/${this.fmt(planned)}</span>` : ""}</span>
        </div>
        ${detail}
      </div>`;
  },

  renderCard() {
    const wrap = document.getElementById("dash-volume");
    if (!wrap) return;
    const prog = App.activeProgram || "—";
    const { vol } = this.compute();
    const rows = this.MUSCLES.filter(m => vol[m] > 0).sort((a, b) => vol[b] - vol[a]);
    if (!rows.length) {
      wrap.innerHTML = `<div class="card-title"><i class="ti ti-chart-bar"></i>Volume settimanale</div><div class="empty-state">Nessun esercizio nel programma attivo.</div>`;
      return;
    }
    const low = rows.filter(m => vol[m] < this.MEV).length;
    const hasA = !!this._actual;
    const foot = hasA
      ? `<b>Fatte</b> / previste a settimana · zona verde <b>10–20</b>`
      : `Serie allenanti / settimana · target <b>10–20</b>${low ? ` · <span class="vz-low">${low} sotto target</span>` : ""}`;
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-chart-bar"></i>Volume settimanale
        <span class="vol-prog">${this._esc(prog)}</span>
        <button class="vol-edit-btn" onclick="Volume.openEditor()"><i class="ti ti-adjustments"></i> Dettaglio</button>
      </div>
      <div class="vol-list">
        ${rows.slice(0, 6).map(m => this._muscleRow(m, vol[m])).join("")}
      </div>
      <div class="vol-foot">${foot} <button class="vol-more" onclick="Volume.openEditor()">vedi tutti →</button></div>`;
  },

  openEditor() { this._openSeds = new Set(); document.getElementById("vol-modal").style.display = "flex"; this.renderEditor(); },
  closeEditor(ev) { if (ev && ev.target !== ev.currentTarget) return; document.getElementById("vol-modal").style.display = "none"; },

  renderEditor() {
    const body = document.getElementById("vol-modal-body");
    if (!body) return;
    const { vol, dir, ind, exercises } = this.compute();
    const total = Object.values(vol).reduce((a, b) => a + b, 0);
    const totalA = this._actual ? Object.values(this._actual).reduce((a, b) => a + b, 0) : null;
    const bars = this.MUSCLES.map(m => this._muscleRow(m, vol[m], { dir: dir[m], ind: ind[m] })).join("");
    // Esercizi raggruppati per SEDUTA del programma attivo, in tendine
    const sedute = Object.entries(CONFIG.SCHEDE || {}).map(([nome, sc]) => {
      const exs = (sc.exercises || []).map(it => U.exName(it)).filter(Boolean);
      const toFix = exs.filter(e => Object.keys(this.musclesFor(e)).length === 0).length;
      const overCeiling = this.sedutaOverCeiling(sc);
      const isOpen = this._openSeds && this._openSeds.has(nome);
      return `
        <div class="vol-sed${isOpen ? " open" : ""}" data-sed="${String(nome).replace(/"/g, "&quot;")}">
          <button class="vol-sed-hd" onclick="Volume.toggleSed(this)" style="border-left:3px solid ${sc.color || "var(--accent)"}">
            <span class="vol-sed-name">${this._esc(nome)}</span>
            <span class="vol-sed-count">${exs.length} eserc.${toFix ? ` · <span class="vz-low">${toFix} da assegnare</span>` : ""}${overCeiling.length ? ` · <span class="vz-high">tante serie: ${overCeiling.join(", ")}</span>` : ""}</span>
            <i class="ti ti-chevron-down vol-sed-chev"></i>
          </button>
          <div class="vol-sed-body">${exs.map(e => this._exRow(e)).join("")}</div>
        </div>`;
    }).join("");
    body.innerHTML = `
      <div class="vol-total">${totalA != null
        ? `Questa settimana: <b>${this.fmt(totalA)}</b> fatte su <b>${this.fmt(total)}</b> previste${this._actualCount ? ` · ${this._actualCount} ${this._actualCount === 1 ? "sessione" : "sessioni"}` : ""}`
        : `Totale: <b>${this.fmt(total)}</b> serie allenanti / settimana`}</div>
      <div class="vol-legend"><span><i class="vz-low">■</i> sotto 10</span><span><i class="vz-ok">■</i> 10–20 ottimale</span><span><i class="vz-high">■</i> oltre 20</span>${totalA != null ? `<span><i class="vol-mark-legend"></i> previste dal programma</span>` : ""}</div>
      <div class="vol-note"><i class="ti ti-info-circle"></i> Ogni totale somma le serie <b>dirette</b> (muscolo primario, 1) e <b>indirette</b> (secondario, ½). La riga sotto ogni muscolo le mostra separate.</div>
      <div class="vol-list vol-list-full">${bars}</div>
      <div class="vol-sec-title"><i class="ti ti-body-scan"></i> Muscolo di ogni esercizio</div>
      <div class="vol-hint">Apri una seduta del programma e correggi il muscolo dove l'automatico sbaglia. Primario = 1 serie, secondari = ½. "Tante serie" avvisa quando in UNA seduta un muscolo supera ${this.SESSION_SET_CEILING} serie dirette (${this.SESSION_SET_CEILING_HIGH} per dorso/gambe/glutei): oltre, il beneficio in quella sessione cala.</div>
      <div class="vol-sed-list">${sedute}</div>`;
  },

  _openSeds: null,
  toggleSed(btn) {
    const wrap = btn.parentElement;
    if (!this._openSeds) this._openSeds = new Set();
    if (wrap.classList.toggle("open")) this._openSeds.add(wrap.dataset.sed);
    else this._openSeds.delete(wrap.dataset.sed);
  },

  // Riga singolo esercizio con selettore muscolo primario
  _exRow(ex) {
    const m = this.musclesFor(ex);
    const primary = Object.keys(m).find(k => m[k] >= 1) || "—";
    const sec = Object.keys(m).filter(k => m[k] < 1);
    const isAuto = !this.loadOverrides()[this._normKey(ex)];
    const info = [];
    if (sec.length) info.push("+ " + sec.join(", ") + " (½)");
    if (primary === "—") info.push("da assegnare");
    else if (isAuto) info.push("auto");
    const exAttr = ex.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const opts = ["—", ...this.MUSCLES];
    return `
      <div class="vol-ex">
        <div class="vol-ex-main">
          <span class="vol-ex-name">${this._esc(ex)}</span>
          <span class="vol-ex-sec">${info.join(" · ")}</span>
        </div>
        <select class="vol-ex-sel" onchange="Volume.setPrimary('${exAttr}', this.value)">
          ${opts.map(o => `<option value="${o}"${o === primary ? " selected" : ""}>${o === "—" ? "Automatico" : o}</option>`).join("")}
        </select>
      </div>`;
  },

  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
};

// ═══════════════════════════════════════════════
//  GymOS — Foto progressi (fisico/estetica)
//  Salvate SOLO sul dispositivo (IndexedDB), private, offline. Pose fronte/
//  lato/schiena, galleria per data, confronto prima/dopo. Immagini ridotte a
//  max 1280px per risparmiare spazio.
// ═══════════════════════════════════════════════
const ProgressPhotos = {
  DBN: "gymos-photos", STORE: "photos", _db: null,
  POSE: { front: "Fronte", side: "Lato", back: "Schiena" },
  _filter: "all", _compare: false, _cmpA: null, _cmpB: null, _pending: null, _urls: [], _cardUrls: [],

  // Wrapper Promise-based su IndexedDB (idb di Jake Archibald), caricato con
  // import() dinamico: gli script dell'app sono classici (non type="module",
  // altrimenti le variabili top-level smetterebbero di essere globali per
  // session.js/app.js), ma import() dinamico funziona ovunque.
  _open() {
    if (this._db) return Promise.resolve(this._db);
    if (!this._openPromise) {
      this._openPromise = import("https://cdn.jsdelivr.net/npm/idb@8/+esm")
        .then(({ openDB }) => openDB(this.DBN, 1, {
          upgrade: db => { if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE, { keyPath: "id" }); },
        }))
        .then(db => { this._db = db; return db; })
        // Fallimento (es. CDN irraggiungibile offline al primo uso): NON
        // cache-are la promise rigettata, altrimenti ogni operazione foto
        // resterebbe rotta fino al reload anche una volta tornati online.
        .catch(e => { this._openPromise = null; throw e; });
    }
    return this._openPromise;
  },
  async _all() { const db = await this._open(); return db.getAll(this.STORE); },
  async _put(rec) { const db = await this._open(); return db.put(this.STORE, rec); },
  async _del(id) { const db = await this._open(); return db.delete(this.STORE, id); },
  async _get(id) { const db = await this._open(); return db.get(this.STORE, id); },

  // Data LOCALE (YYYY-MM-DD): evita l'off-by-one del fuso orario di toISOString()
  _localDate(d) { d = d || new Date(); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
  _fmtW(w) { return (w == null) ? "" : String(w).replace(".", ",") + " kg"; },
  // Ultimo peso registrato nei check-in corporei (per pre-compilare)
  _latestWeight() {
    try {
      if (typeof Body === "undefined" || !Body.checkins) return null;
      const w = Body.checkins.filter(c => c.peso != null && c.peso > 0);
      return w.length ? w[w.length - 1].peso : null;   // checkins ordinati per data crescente
    } catch (e) { return null; }
  },
  // Chiede il peso da abbinare alla foto (facoltativo), con anteprima
  _askWeight(previewUrl, pose) {
    return new Promise(resolve => {
      let el = document.getElementById("ph-confirm");
      if (!el) { el = document.createElement("div"); el.id = "ph-confirm"; el.className = "ph-confirm"; document.body.appendChild(el); }
      const pre = this._latestWeight();
      el.innerHTML = `
        <div class="ph-confirm-box">
          <div class="ph-confirm-head"><i class="ti ti-camera"></i> ${this.POSE[pose]} · oggi</div>
          <img class="ph-confirm-img" src="${previewUrl}" alt="">
          <label class="ph-confirm-lbl">Peso di oggi (kg) — facoltativo</label>
          <input class="ph-confirm-inp" id="ph-w-inp" type="number" inputmode="decimal" step="0.1" min="0" placeholder="es. 78.5" value="${pre != null ? pre : ""}">
          <div class="ph-confirm-btns">
            <button class="btn-primary" id="ph-w-save"><i class="ti ti-check"></i> Salva foto</button>
            <button class="btn-cancel" id="ph-w-skip">Senza peso</button>
          </div>
        </div>`;
      el.style.display = "flex";
      const done = w => { el.style.display = "none"; resolve(w); };
      el.querySelector("#ph-w-save").onclick = () => { const v = parseFloat(el.querySelector("#ph-w-inp").value); done(isNaN(v) || v <= 0 ? null : Math.round(v * 10) / 10); };
      el.querySelector("#ph-w-skip").onclick = () => done(null);
      el.onclick = e => { if (e.target === el) done(null); };
      setTimeout(() => { const i = el.querySelector("#ph-w-inp"); if (i) i.focus(); }, 60);
    });
  },
  _url(blob, bucket) { const u = URL.createObjectURL(blob); (bucket === "card" ? this._cardUrls : this._urls).push(u); return u; },
  _revoke(bucket) {
    const arr = bucket === "card" ? this._cardUrls : this._urls;
    arr.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    if (bucket === "card") this._cardUrls = []; else this._urls = [];
  },

  // Ridimensiona (max 1280px) e comprime in JPEG. Tripla via robusta perché
  // una foto dal telefono si salvi SEMPRE: createImageBitmap → <img> → dataURL.
  async _process(file) {
    let src = null, w0 = 0, h0 = 0;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w0 = src.width; h0 = src.height; }
    catch (e) { try { src = await createImageBitmap(file); w0 = src.width; h0 = src.height; } catch (e2) { src = null; } }
    if (!src) {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("img")); im.src = dataUrl; });
      w0 = src.naturalWidth; h0 = src.naturalHeight;
    }
    const max = 1280, sc = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(src, 0, 0, w, h);
    let blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
    if (!blob) {   // fallback estremo: dataURL → Blob
      const durl = cv.toDataURL("image/jpeg", 0.85), bin = atob(durl.split(",")[1]), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: "image/jpeg" });
    }
    if (src && src.close) { try { src.close(); } catch (e) {} }
    return { blob, w, h };
  },

  pick(pose) { this._pending = pose; const inp = document.getElementById("photo-file"); if (inp) { inp.value = ""; inp.click(); } },
  async onFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { if (typeof U !== "undefined") U.toast("Serve un'immagine", "err"); return; }
    const pose = this._pending || "front"; this._pending = null;
    try {
      const { blob, w, h } = await this._process(file);
      // chiedi il peso da abbinare (facoltativo), con anteprima
      const previewUrl = URL.createObjectURL(blob);
      const weight = await this._askWeight(previewUrl, pose);
      try { URL.revokeObjectURL(previewUrl); } catch (e) {}
      const now = new Date();
      const rec = { id: "p" + Date.now() + Math.floor(Math.random() * 1000), date: this._localDate(now), ts: now.getTime(), pose, blob, w, h, weight: weight };
      await this._put(rec);
      const check = await this._get(rec.id);          // verifica reale della scrittura
      if (!check || !check.blob) throw new Error("non salvata");
      if (typeof U !== "undefined") U.toast("Foto salvata 📸", "ok");
      this.renderCard();
      const ov = document.getElementById("photos-overlay");
      if (ov && ov.style.display === "flex") this.renderOverlay();
    } catch (e) { console.error("photo add:", e); if (typeof U !== "undefined") U.toast("Foto non caricata — riprova", "err"); }
  },

  _ts(r) { return r.ts || (r.date ? new Date(r.date).getTime() : 0); },
  _day(r) { return (r.date || "").split("T")[0]; },

  async renderCard() {
    const wrap = document.getElementById("photos-card"); if (!wrap) return;
    this._revoke("card");
    const all = await this._all().catch(() => []);
    const latest = ["front", "side", "back"]
      .map(p => all.filter(x => x.pose === p).sort((a, b) => this._ts(b) - this._ts(a))[0]).filter(Boolean);
    const thumbs = latest.length
      ? latest.map(r => `<div class="ph-thumb"><img src="${this._url(r.blob, "card")}" alt=""><span>${this.POSE[r.pose]}</span></div>`).join("")
      : `<div class="ph-empty">Nessuna foto. Aggiungi la prima da una posa qui sotto 👇</div>`;
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-camera"></i>Foto progressi ${all.length ? `<span class="ph-count">${all.length}</span>` : ""}
        <button class="vol-edit-btn" onclick="ProgressPhotos.openGallery()"><i class="ti ti-photo"></i> Galleria</button>
      </div>
      <div class="ph-latest">${thumbs}</div>
      <div class="ph-add-row">
        <button class="ph-add" onclick="ProgressPhotos.pick('front')"><i class="ti ti-plus"></i> Fronte</button>
        <button class="ph-add" onclick="ProgressPhotos.pick('side')"><i class="ti ti-plus"></i> Lato</button>
        <button class="ph-add" onclick="ProgressPhotos.pick('back')"><i class="ti ti-plus"></i> Schiena</button>
      </div>
      <div class="ph-note"><i class="ti ti-lock"></i> Le foto restano solo sul tuo telefono, private.</div>`;
  },

  openGallery() { const o = document.getElementById("photos-overlay"); if (!o) return; o.style.display = "flex"; this.renderOverlay(); },
  closeGallery(ev) { if (ev && ev.target !== ev.currentTarget) return; const o = document.getElementById("photos-overlay"); if (o) o.style.display = "none"; this._revoke(); this._compare = false; },
  setFilter(k) { this._filter = k; this.renderOverlay(); },
  toggleCompare() { this._compare = !this._compare; if (this._compare && this._filter === "all") this._filter = "front"; this.renderOverlay(); },

  async renderOverlay() {
    const tabsEl = document.getElementById("ph-tabs"), gal = document.getElementById("ph-gallery");
    if (!tabsEl || !gal) return;
    this._revoke();
    const all = (await this._all().catch(() => [])).sort((a, b) => this._ts(b) - this._ts(a));
    const poses = [["all", "Tutte"], ["front", "Fronte"], ["side", "Lato"], ["back", "Schiena"]];
    tabsEl.innerHTML = poses.map(([k, l]) => `<button class="ph-chip${this._filter === k ? " on" : ""}" onclick="ProgressPhotos.setFilter('${k}')">${l}</button>`).join("")
      + `<button class="ph-chip ph-cmp${this._compare ? " on" : ""}" onclick="ProgressPhotos.toggleCompare()"><i class="ti ti-arrows-diff"></i> Confronta</button>`;
    const list = this._filter === "all" ? all : all.filter(x => x.pose === this._filter);
    if (this._compare) { gal.innerHTML = this._compareHTML(list); return; }
    if (!list.length) { gal.innerHTML = `<div class="empty-state">Nessuna foto${this._filter !== "all" ? " per questa posa" : ""}.</div>`; return; }
    const groups = {};
    list.forEach(r => { const d = this._day(r); (groups[d] = groups[d] || []).push(r); });
    gal.innerHTML = Object.keys(groups).map(d => `
      <div class="ph-day">
        <div class="ph-day-h">${U.fmtDate(d)}</div>
        <div class="ph-grid">${groups[d].map(r => `
          <button class="ph-cell" onclick="ProgressPhotos.view('${r.id}')">
            <img src="${this._url(r.blob)}" alt="" loading="lazy">
            <span class="ph-cell-pose">${this.POSE[r.pose]}</span>
            ${r.weight ? `<span class="ph-cell-w">${this._fmtW(r.weight)}</span>` : ""}
          </button>`).join("")}</div>
      </div>`).join("");
  },

  _compareHTML(list) {
    if (list.length < 2) return `<div class="empty-state">Servono almeno 2 foto${this._filter === "all" ? " — scegli una posa per un confronto pulito" : " di questa posa"}.</div>`;
    const chron = [...list].sort((a, b) => this._ts(a) - this._ts(b));
    if (!this._cmpA || !chron.find(x => x.id === this._cmpA)) this._cmpA = chron[0].id;
    if (!this._cmpB || !chron.find(x => x.id === this._cmpB)) this._cmpB = chron[chron.length - 1].id;
    const A = chron.find(x => x.id === this._cmpA), B = chron.find(x => x.id === this._cmpB);
    const opt = sel => chron.map(r => `<option value="${r.id}"${r.id === sel ? " selected" : ""}>${U.fmtDate(this._day(r))}</option>`).join("");
    const col = (ph, which, lbl) => `
      <div class="ph-cmp-col">
        <div class="ph-cmp-tag">${lbl}</div>
        <div class="ph-cmp-imgwrap">
          <img src="${this._url(ph.blob)}" alt="">
          ${ph.weight ? `<span class="ph-wtag">${this._fmtW(ph.weight)}</span>` : ""}
        </div>
        <div class="ph-cmp-cap">${U.fmtDate(this._day(ph))}${ph.weight ? ` · <b>${this._fmtW(ph.weight)}</b>` : ""}</div>
        <select class="ph-cmp-sel" onchange="ProgressPhotos._cmp${which}=this.value;ProgressPhotos.renderOverlay()">${opt(which === "A" ? this._cmpA : this._cmpB)}</select>
      </div>`;
    return `<div class="ph-compare">${col(A, "A", "Prima")}${col(B, "B", "Dopo")}</div>`;
  },

  async view(id) {
    const all = await this._all(); const r = all.find(x => x.id === id); if (!r) return;
    let v = document.getElementById("ph-viewer");
    if (!v) { v = document.createElement("div"); v.id = "ph-viewer"; v.className = "ph-viewer"; document.body.appendChild(v); }
    const url = this._url(r.blob);
    v.innerHTML = `
      <div class="ph-viewer-bar">
        <span>${U.fmtDate(this._day(r))} · ${this.POSE[r.pose]}${r.weight ? ` · ${this._fmtW(r.weight)}` : ""}</span>
        <div class="ph-vbtns">
          <a class="ph-vbtn" href="${url}" download="gymos-${r.pose}-${r.date.split("T")[0]}.jpg" title="Scarica"><i class="ti ti-download"></i></a>
          <button class="ph-vbtn" onclick="ProgressPhotos.del('${r.id}', this)" title="Elimina"><i class="ti ti-trash"></i></button>
          <button class="ph-vbtn" onclick="ProgressPhotos.closeViewer()" title="Chiudi"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <img class="ph-viewer-img" src="${url}" alt="">`;
    v.style.display = "flex";
  },
  closeViewer() { const v = document.getElementById("ph-viewer"); if (v) v.style.display = "none"; },
  del(id, btn) {
    if (btn && btn.dataset.armed !== "1") {
      btn.dataset.armed = "1"; btn.classList.add("armed"); btn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { if (btn) { btn.dataset.armed = "0"; btn.classList.remove("armed"); btn.innerHTML = '<i class="ti ti-trash"></i>'; } }, 3000);
      return;
    }
    this._del(id).then(() => {
      this.closeViewer();
      const ov = document.getElementById("photos-overlay");
      if (ov && ov.style.display === "flex") this.renderOverlay();
      this.renderCard();
      if (typeof U !== "undefined") U.toast("Foto eliminata", "ok");
    }).catch(e => { console.error("photo del:", e); if (typeof U !== "undefined") U.toast("Eliminazione fallita", "err"); });
  },
};

const Dashboard = {
  async load() {
    const hour = new Date().getHours();
    document.getElementById("dash-greeting").textContent =
      hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
    document.getElementById("dash-date").textContent =
      new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

    try {
      const [sessions, checkins, sleepData, habits, todayHabit] = await Promise.all([
        API.getWorkoutSessions(14).catch(() => []),
        API.getBodyMetrics(12).catch(() => []),   // 12 (non 5): serve storia sufficiente per stimare da quanto si è nella fase attuale (diet-break)
        API.getRecentSleep(7).catch(() => []),
        API.getRecentHabits(7).catch(() => []),
        API.getTodayHabit().catch(() => null),
      ]);

      this.buildStats(sessions, checkins, sleepData, habits, todayHabit);
      this.buildWeekSplit(sessions);
      Volume.renderCard();
      Volume.loadActual(sessions);   // serie fatte davvero questa settimana (bg)
      this.buildRecentSessions(sessions);
      this.buildSemaforo(sleepData);
      try { DailyRecap.render({ sessions, checkins, sleep: sleepData, habits, todayHabit }); } catch (e) { console.error("DailyRecap:", e); }
      try { Coach.renderAll(); } catch (e) { console.error("Coach.renderAll:", e); }
    } catch(e) { console.error("Dashboard.load:", e); }
  },

  // Anima un anello SVG di progresso (frazione 0..1)
  setRing(id, frac) {
    const el = document.getElementById(id);
    if (!el) return;
    const r = el.r.baseVal.value;
    const C = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac || 0));
    el.style.strokeDasharray = C.toFixed(2);
    el.style.strokeDashoffset = (C * (1 - f)).toFixed(2);
  },

  buildStats(sessions, checkins, sleepData, habits, todayHabit) {
    const thisWeek = sessions.filter(s => {
      if (!s.date) return false;
      const d = new Date(s.date);
      const now = new Date();
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // Settimana da LUNEDÌ, allineata a Volume._weekStart: prima l'anello
      // sedute contava da domenica e il volume "fatto" da lunedì — una
      // sessione della domenica compariva in uno e non nell'altro.
      startOfWeek.setDate(startOfWeek.getDate() - ((now.getDay() + 6) % 7));
      return d >= startOfWeek;
    });

    // Denominatore = numero di sedute del programma attivo (obiettivo settimanale)
    const target = Object.keys(CONFIG.SCHEDE || {}).length || thisWeek.length;
    const done = thisWeek.filter(s => s.done).length;
    document.getElementById("d-sessions").textContent = done + "/" + target;
    document.getElementById("d-sessions-sub").textContent = done >= target && target > 0
      ? "settimana completata 🔥" : "completate questa settimana";
    this.setRing("d-sessions-ring", target ? done / target : 0);

    const last = checkins[checkins.length - 1];
    if (last) {
      document.getElementById("d-peso").textContent = U.fmt(last.peso) + " kg";
      if (checkins.length > 1) {
        const sub = document.getElementById("d-peso-sub");
        if (sub) {
          const d = Math.round((last.peso - checkins[checkins.length - 2].peso) * 10) / 10;
          sub.textContent = (d > 0 ? "+" : "") + U.fmt(d) + " kg vs prec.";
        }
      }
    } else {
      document.getElementById("d-peso").textContent = "—";
    }

    if (sleepData.length) {
      const avg = sleepData.reduce((a, s) => a + (s.ore || 0), 0) / sleepData.length;
      document.getElementById("d-sleep").textContent = avg.toFixed(1) + "h";
    } else {
      document.getElementById("d-sleep").textContent = "—";
    }

    // Habit score: oggi se c'è, altrimenti media settimana
    const hEl = document.getElementById("d-habit");
    if (todayHabit && todayHabit.score != null) {
      hEl.textContent = todayHabit.score + "%";
    } else if (habits.length) {
      const avg = Math.round(habits.reduce((a, h) => a + (h.score || 0), 0) / habits.length);
      hEl.textContent = avg + "%";
    } else {
      hEl.textContent = "—";
    }
  },

  buildRecentSessions(sessions) {
    const list = document.getElementById("today-checklist");
    if (!list) return;
    this._recentSessions = sessions;   // per il toggle "vedi tutte / mostra meno"
    list.innerHTML = "";
    const prog = document.querySelector(".checklist-progress");
    if (prog) prog.style.display = "none";
    const done = sessions.filter(s => s.done);
    if (!done.length) {
      list.innerHTML = '<div class="empty-state">Nessuna sessione registrata. Vai su Sessione per iniziare!</div>';
      return;
    }
    done.slice(0, 4).forEach(s => {
      const item = document.createElement("div");
      item.className = "recent-sess-item clickable";
      item.innerHTML = `
        <div class="rs-icon"><i class="ti ti-barbell"></i></div>
        <div class="rs-main">
          <div class="rs-name">${s.name}</div>
          <div class="rs-date">${U.fmtDate(s.date)}</div>
        </div>
        <i class="ti ti-circle-check rs-check"></i>
        <i class="ti ti-chevron-right rs-go"></i>
      `;
      item.onclick = () => Session.openById(s.id);
      list.appendChild(item);
    });
    if (done.length > 4) {
      const more = document.createElement("button");
      more.className = "recent-more-btn";
      more.innerHTML = '<i class="ti ti-search"></i> Cerca tra tutte le sessioni';
      more.onclick = () => Dashboard.openArchive();
      list.appendChild(more);
    }
  },

  // ─── Archivio sessioni: ricerca + filtri per scheda + raggruppamento per mese ───
  _archiveAll: [],
  _archiveFilter: "",

  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  _typeOf(s) { return s.type || s.name || "—"; },
  _monthLabel(date) {
    const M = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
    const d = new Date((date || "") + "T12:00:00");
    return isNaN(d) ? "—" : M[d.getMonth()] + " " + d.getFullYear();
  },

  async openArchive() {
    const modal = document.getElementById("sessions-archive");
    if (!modal) return;
    modal.style.display = "flex";
    const listEl = document.getElementById("archive-list");
    listEl.innerHTML = '<div class="empty-state">Caricamento…</div>';
    let all = [];
    try { all = await API.getWorkoutSessions(100); } catch (e) { all = this._recentSessions || []; }
    this._archiveAll = all.filter(s => s.done);
    this._archiveFilter = "";
    const q = document.getElementById("archive-q");
    if (q) q.value = "";
    // chip per ogni scheda presente, in ordine di frequenza
    const counts = {};
    this._archiveAll.forEach(s => { const t = this._typeOf(s); counts[t] = (counts[t] || 0) + 1; });
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const chips = document.getElementById("archive-chips");
    chips.innerHTML =
      `<button class="arch-chip on" onclick="Dashboard.setArchiveFilter('', this)">Tutte</button>` +
      types.map(t => `<button class="arch-chip" onclick="Dashboard.setArchiveFilter(this.dataset.t, this)" data-t="${this._esc(t)}">${this._esc(t)} <span>${counts[t]}</span></button>`).join("");
    this.renderArchive();
  },

  setArchiveFilter(t, btn) {
    this._archiveFilter = t || "";
    document.querySelectorAll("#archive-chips .arch-chip").forEach(c => c.classList.remove("on"));
    if (btn) btn.classList.add("on");
    this.renderArchive();
  },

  renderArchive() {
    const listEl = document.getElementById("archive-list");
    if (!listEl) return;
    const q = (document.getElementById("archive-q").value || "").toLowerCase().trim();
    let items = this._archiveAll.slice();
    if (this._archiveFilter) items = items.filter(s => this._typeOf(s) === this._archiveFilter);
    if (q) items = items.filter(s =>
      (s.name || "").toLowerCase().includes(q) ||
      U.fmtDate(s.date).toLowerCase().includes(q) ||
      this._monthLabel(s.date).toLowerCase().includes(q) ||
      (s.date || "").includes(q));
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!items.length) { listEl.innerHTML = '<div class="empty-state">Nessuna sessione trovata.</div>'; return; }
    let html = "", curMonth = null;
    items.forEach(s => {
      const m = this._monthLabel(s.date);
      if (m !== curMonth) { curMonth = m; html += `<div class="arch-month">${m}</div>`; }
      html += `<button class="recent-sess-item clickable arch-item" onclick="Dashboard.openArchived('${s.id}')">
        <div class="rs-icon"><i class="ti ti-barbell"></i></div>
        <div class="rs-main"><div class="rs-name">${this._esc(s.name)}</div><div class="rs-date">${U.fmtDate(s.date)}</div></div>
        <i class="ti ti-chevron-right rs-go"></i></button>`;
    });
    listEl.innerHTML = html;
  },

  openArchived(id) { this.closeArchive(); Session.openById(id); },
  closeArchive(e) { if (!e || e.target.id === "sessions-archive") document.getElementById("sessions-archive").style.display = "none"; },

  buildWeekSplit(sessions) {
    const days   = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
    const today  = new Date();
    const startW = new Date(today);
    startW.setDate(today.getDate() - today.getDay());
    const wrap = document.getElementById("week-split");
    wrap.innerHTML = "";

    for (let i = 1; i <= 7; i++) {
      const day  = new Date(startW);
      day.setDate(startW.getDate() + i);
      // Data LOCALE: toISOString() è UTC e tra mezzanotte e le 01:00/02:00
      // italiane spostava il pallino "oggi" sul giorno sbagliato.
      const p    = n => String(n).padStart(2, "0");
      const iso  = day.getFullYear() + "-" + p(day.getMonth() + 1) + "-" + p(day.getDate());
      const isT  = iso === U.today();
      // Se in un giorno ci sono più sessioni (es. una lasciata a metà + quella
      // vera completata), dà priorità a quella completata → il giorno diventa
      // verde se hai davvero allenato.
      const daySess = sessions.filter(s => s.date === iso);
      const sess    = daySess.find(s => s.done) || daySess[0];

      const col = document.createElement("div");
      col.className = "split-day";
      col.innerHTML = `
        <span class="split-day-name">${days[day.getDay()]}</span>
        <span class="split-day-num${isT ? " today" : ""}">${day.getDate()}</span>
        <div class="split-pip${isT ? " today-pip" : ""}${sess?.done ? " done" : ""}">
          <i class="ti ${sess ? "ti-barbell" : "ti-zzz"}" style="font-size:13px;color:${sess?.done ? "var(--green)" : isT ? "var(--accent)" : "var(--muted)"}"></i>
        </div>
        <span class="split-status">${sess ? (sess.done ? "✓ " : "") + sess.name.split(" ")[0] : "—"}</span>
      `;
      wrap.appendChild(col);
    }
  },

  buildChecklist(tasks) {
    const list  = document.getElementById("today-checklist");
    const doneN = document.getElementById("cl-done");
    const totN  = document.getElementById("cl-total");
    const bar   = document.getElementById("cl-bar");
    list.innerHTML = "";

    if (!tasks.length) {
      list.innerHTML = '<div class="empty-state">Nessun task pianificato per oggi</div>';
      return;
    }

    let doneCount = tasks.filter(t => t.done).length;
    doneN.textContent = doneCount;
    totN.textContent  = tasks.length;
    bar.style.width   = Math.round(doneCount / tasks.length * 100) + "%";

    tasks.forEach(t => {
      const item = document.createElement("div");
      item.className = "check-item" + (t.done ? " checked" : "");
      item.innerHTML = `
        <div class="chk${t.done ? " done" : ""}"><i class="ti ti-check" style="font-size:11px;${t.done ? "" : "display:none"}"></i></div>
        <span class="chk-text">${t.name}</span>
        ${t.type ? `<span class="chk-tag">${t.type}</span>` : ""}
      `;
      item.onclick = async () => {
        t.done = !t.done;
        item.classList.toggle("checked", t.done);
        const chk = item.querySelector(".chk");
        chk.classList.toggle("done", t.done);
        chk.querySelector("i").style.display = t.done ? "" : "none";
        doneCount = tasks.filter(x => x.done).length;
        doneN.textContent = doneCount;
        bar.style.width   = Math.round(doneCount / tasks.length * 100) + "%";
        await API.completeTask(t.id, t.done).catch(console.error);
      };
      list.appendChild(item);
    });
  },

  buildSemaforo(sleepData) {
    const card  = document.getElementById("semaforo-card");
    const icon  = document.getElementById("sem-icon");
    const title = document.getElementById("sem-title");
    const sub   = document.getElementById("sem-sub");
    if (!sleepData.length) return;

    const last = sleepData[0];
    const hrv  = last.hrv;
    const ore  = last.ore || 7;

    let level = "verde";
    if (hrv && hrv < 45) level = "rosso";
    else if (ore < 6)    level = "rosso";
    else if (ore < 7)    level = "giallo";

    const cfg = {
      verde:  { color: "#22C55E", icon: "ti-circle-check", t: "Recovery: Verde",  s: "Puoi spingere oggi" },
      giallo: { color: "#F59E0B", icon: "ti-alert-circle",  t: "Recovery: Giallo", s: "Intensità moderata" },
      rosso:  { color: "#EF4444", icon: "ti-circle-x",      t: "Recovery: Rosso",  s: "Giornata di recupero" },
    }[level];

    card.style.borderColor = cfg.color;
    icon.innerHTML = `<i class="ti ${cfg.icon}" style="color:${cfg.color}"></i>`;
    title.textContent = cfg.t;
    title.style.color = cfg.color;
    sub.textContent   = cfg.s;
    if (hrv) sub.textContent += ` · HRV ${hrv}ms`;
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Cardio module
// ═══════════════════════════════════════════════
const Cardio = {
  sessions: [],

  async load() {
    try {
      this.sessions = await API.getCardioSessions(60);
      this.buildStats();
      this.buildTable();
    } catch(e) { console.error("Cardio.load:", e); }
  },

  buildStats() {
    const strip = document.getElementById("cardio-stats");
    if (!strip) return;
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    const thisWeek = this.sessions.filter(c => c.date && new Date(c.date) >= weekStart);
    const totMin  = thisWeek.reduce((a,c) => a + (c.durata || 0), 0);
    const totKm   = thisWeek.reduce((a,c) => a + (c.dist || 0), 0);
    const totKcal = thisWeek.reduce((a,c) => a + (c.kcal || 0), 0);
    strip.innerHTML = `
      <div class="bstat"><div class="bstat-v">${thisWeek.length}</div><div class="bstat-l">Sessioni sett.</div></div>
      <div class="bstat"><div class="bstat-v">${totMin}<span class="bstat-u">min</span></div><div class="bstat-l">Tempo sett.</div></div>
      <div class="bstat"><div class="bstat-v">${U.fmt(totKm)}<span class="bstat-u">km</span></div><div class="bstat-l">Distanza sett.</div></div>
      <div class="bstat"><div class="bstat-v">${totKcal}</div><div class="bstat-l">Kcal sett.</div></div>
    `;
  },

  buildTable() {
    const tbody = document.getElementById("cardio-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!this.sessions.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nessun cardio registrato</td></tr>';
      return;
    }
    this.sessions.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${U.fmtDate(c.date)}</td>
        <td style="color:var(--text)">${c.tipo || "—"}</td>
        <td class="mono">${c.durata != null ? c.durata + " min" : "—"}</td>
        <td class="mono">${c.dist != null ? U.fmt(c.dist) + " km" : "—"}</td>
        <td class="mono">${c.kcal != null ? c.kcal : "—"}</td>
        <td class="mono">${c.incl != null ? U.fmt(c.incl) + "%" : "—"}</td>
        <td class="mono">${c.vel != null ? U.fmt(c.vel) : "—"}</td>
        <td class="note-text">${c.note || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  async add() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const tipo = document.getElementById("ca-tipo")?.value || "";
    const note = document.getElementById("ca-note")?.value || "";
    const durata = get("ca-durata");
    if (!tipo && !durata) { U.alert("Inserisci almeno tipo o durata"); return; }
    const data = {
      tipo,
      durata,
      dist: get("ca-dist"),
      kcal: get("ca-kcal"),
      incl: get("ca-incl"),
      vel:  get("ca-vel"),
      fatto: true,
      note,
      date: U.today(),   // data locale, non UTC
    };
    try {
      await API.saveCardio(data);
      ["ca-tipo","ca-durata","ca-dist","ca-kcal","ca-incl","ca-vel","ca-note"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      await this.load();
      const msg = document.getElementById("cardio-save-msg");
      if (msg) { msg.style.display = "flex"; setTimeout(() => msg.style.display = "none", 2500); }
    } catch(e) {
      console.error(e);
      U.alert("Errore nel salvataggio del cardio.");
    }
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Diary module (sonno + abitudini)
// ═══════════════════════════════════════════════
const Diary = {
  qualita: null,
  energia: null,
  umore:   null,
  habitId: null,
  habitState: { allen:false, prot:false, integ:false, mobil:false, pesoReg:false },

  HABITS: [
    { key:"allen",   label:"Allenamento",     icon:"ti-barbell" },
    { key:"prot",    label:"Proteine ok",     icon:"ti-meat" },
    { key:"integ",   label:"Integratori",     icon:"ti-pill" },
    { key:"mobil",   label:"Mobilità",        icon:"ti-stretching" },
    { key:"pesoReg", label:"Peso registrato", icon:"ti-scale" },
  ],

  // Diario libero ("giornata & sensazioni") — ON-DEVICE (localStorage, come
  // note-esercizio e foto progressi), niente nuovo schema Notion. Autosave
  // debounced mentre scrivi ("tempo reale"): il cervello IA lo legge ad ogni
  // richiesta di consiglio (Session.loadAIAdvice), niente bottone salva.
  _journalKey(d) { return `gymos_journal_${d || U.today()}`; },
  getJournal(d) { try { return localStorage.getItem(this._journalKey(d)) || ""; } catch (e) { return ""; } },
  onJournalInput(text) {
    clearTimeout(this._journalTimer);
    this._journalTimer = setTimeout(() => {
      try {
        const t = (text || "").trim();
        if (t) localStorage.setItem(this._journalKey(), t);
        else localStorage.removeItem(this._journalKey());
      } catch (e) {}
      const msg = document.getElementById("journal-save-msg");
      if (msg) { msg.style.display = "flex"; setTimeout(() => msg.style.display = "none", 1800); }
    }, 500);
  },

  async load() {
    document.getElementById("diary-date").textContent =
      new Date().toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" });
    const ta = document.getElementById("journal-ta");
    if (ta) ta.value = this.getJournal();
    this.qualita = null; this.energia = null; this.umore = null;
    this.buildRatings();
    this.buildEnergia();
    this.buildHabitChecks();
    this.renderLimitations();
    // Carica habit di oggi se esiste
    try {
      const h = await API.getTodayHabit();
      if (h) {
        this.habitId = h.id;
        this.habitState = { allen:h.allen, prot:h.prot, integ:h.integ, mobil:h.mobil, pesoReg:h.pesoReg };
        if (h.acqua != null) document.getElementById("dh-acqua").value = h.acqua;
        if (h.passi != null) document.getElementById("dh-passi").value = h.passi;
        this.umore = h.umore ? parseInt(h.umore) : null;
        this.buildHabitChecks();
        this.buildUmore();
        this.updateScoreBadge();
      }
    } catch(e) { console.error(e); }
  },

  buildRatings() {
    const row = document.getElementById("sl-qualita-row");
    if (!row) return;
    row.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.className = "rating-dot" + (this.qualita === i ? " on" : "");
      b.textContent = i;
      b.onclick = () => { this.qualita = i; this.buildRatings(); };
      row.appendChild(b);
    }
  },

  buildUmore() {
    const row = document.getElementById("dh-umore-row");
    if (!row) return;
    row.innerHTML = "";
    const faces = ["😞","😕","😐","🙂","😄"];
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.className = "rating-dot" + (this.umore === i ? " on" : "");
      b.textContent = i;
      b.onclick = () => { this.umore = i; this.buildUmore(); };
      row.appendChild(b);
    }
  },

  buildEnergia() {
    const row = document.getElementById("sl-energia-row");
    if (!row) return;
    row.innerHTML = "";
    const opts = [
      { v:"Stanco",      c:"#EF4444" },
      { v:"Nella norma", c:"#F5A623" },
      { v:"Riposato",    c:"#27D17F" },
    ];
    opts.forEach(o => {
      const b = document.createElement("button");
      b.className = "energia-btn" + (this.energia === o.v ? " on" : "");
      b.textContent = o.v;
      if (this.energia === o.v) { b.style.borderColor = o.c; b.style.color = o.c; }
      b.onclick = () => { this.energia = o.v; this.buildEnergia(); };
      row.appendChild(b);
    });
  },

  buildHabitChecks() {
    const wrap = document.getElementById("habit-checks");
    if (!wrap) return;
    wrap.innerHTML = "";
    this.HABITS.forEach(h => {
      const on = this.habitState[h.key];
      const item = document.createElement("button");
      item.className = "habit-check" + (on ? " on" : "");
      item.innerHTML = `<i class="ti ${h.icon}"></i><span>${h.label}</span><i class="ti ti-check habit-tick"></i>`;
      item.onclick = () => {
        this.habitState[h.key] = !this.habitState[h.key];
        this.buildHabitChecks();
        this.updateScoreBadge();
      };
      wrap.appendChild(item);
    });
  },

  updateScoreBadge() {
    const vals = Object.values(this.habitState);
    const score = Math.round(vals.filter(Boolean).length / vals.length * 100);
    const badge = document.getElementById("habit-score-badge");
    if (badge) badge.textContent = score + "%";
  },

  async saveSleep() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const data = {
      ore: get("sl-ore"),
      hrv: get("sl-hrv"),
      qualita: this.qualita,
      energia: this.energia,
      note: document.getElementById("sl-note")?.value || "",
    };
    if (data.ore == null) { U.alert("Inserisci almeno le ore dormite"); return; }
    try {
      await API.saveSleep(data);
      ["sl-ore","sl-hrv","sl-note"].forEach(id => { const e=document.getElementById(id); if(e) e.value=""; });
      this.qualita = null; this.energia = null;
      this.buildRatings(); this.buildEnergia();
      const msg = document.getElementById("sleep-save-msg");
      if (msg) { msg.style.display="flex"; setTimeout(()=>msg.style.display="none",2500); }
    } catch(e) { console.error(e); U.alert("Errore salvataggio sonno."); }
  },

  async saveHabit() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const data = {
      ...this.habitState,
      acqua: get("dh-acqua"),
      passi: get("dh-passi"),
      umore: this.umore,
    };
    try {
      const res = await API.saveHabit(data, this.habitId);
      if (res && res.id) this.habitId = res.id;
      const msg = document.getElementById("habit-save-msg");
      if (msg) { msg.style.display="flex"; setTimeout(()=>msg.style.display="none",2500); }
    } catch(e) { console.error(e); U.alert("Errore salvataggio abitudini."); }
  },

  // ── Limitazioni fisiche STANDING (info & esenzioni) — ON-DEVICE, distinte
  // dal diario di oggi (transitorio): "ginocchio operato" resta valido per
  // settimane/mesi, non solo per la giornata corrente. Alimentano sia il
  // consiglio automatico (Session.loadAIAdvice) sia il coach (Coach.ask), in
  // un campo SEPARATO dal diario così l'IA non le confonde con una nota
  // di oggi e non le ripete a ogni esercizio (motivo del "loop" percepito).
  LIMIT_KEY: "gymos_limitations",
  LIMIT_TAGS: [
    { key: "ginocchio", label: "Ginocchio",     icon: "ti-shoe" },
    { key: "spalla",    label: "Spalla",        icon: "ti-yoga" },
    { key: "schiena",   label: "Schiena",       icon: "ti-activity" },
    { key: "anca",      label: "Anca/bacino",   icon: "ti-walk" },
    { key: "caviglia",  label: "Caviglia/piede",icon: "ti-shoe-off" },
    { key: "polso",     label: "Polso/gomito",  icon: "ti-hand-stop" },
    { key: "altro",     label: "Altro",         icon: "ti-notes" },
  ],
  getLimitations() { try { return JSON.parse(localStorage.getItem(this.LIMIT_KEY) || "[]"); } catch (e) { return []; } },
  _saveLimitations(arr) { try { localStorage.setItem(this.LIMIT_KEY, JSON.stringify(arr)); } catch (e) {} },
  addLimitation(text, tag) {
    const t = (text || "").trim();
    if (!t) return;
    const arr = this.getLimitations();
    arr.push({ id: "lim" + Date.now(), text: t, tag: tag || "altro", ts: Date.now() });
    this._saveLimitations(arr);
    this.renderLimitations();
  },
  async removeLimitation(id) {
    if (!await U.confirm("Rimuovere questa limitazione?", { danger: true, okText: "Rimuovi" })) return;
    this._saveLimitations(this.getLimitations().filter(l => l.id !== id));
    this.renderLimitations();
  },
  // Riassunto compatto per l'IA: "Ginocchio: operato 2023, evita affondi profondi · Spalla: fastidio overhead"
  // Mandato ad OGNI chiamata /advice (ora una per serie) e /ask: senza un
  // cap, accumulare limitazioni nel tempo farebbe crescere il prompt senza
  // limite. 800 caratteri bastano ampiamente per l'uso reale (poche righe
  // per zona) e tengono il payload sotto controllo.
  standingLimitationsText() {
    const arr = this.getLimitations();
    if (!arr.length) return "";
    const byTag = {};
    arr.forEach(l => { (byTag[l.tag] = byTag[l.tag] || []).push(l.text); });
    const full = Object.keys(byTag).map(tag => {
      const lbl = (this.LIMIT_TAGS.find(t => t.key === tag) || {}).label || tag;
      return `${lbl}: ${byTag[tag].join("; ")}`;
    }).join(" · ");
    return full.length > 800 ? full.slice(0, 800) + "…" : full;
  },
  renderLimitations() {
    const wrap = document.getElementById("limitations-list");
    if (!wrap) return;
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const arr = this.getLimitations();
    if (!arr.length) { wrap.innerHTML = '<div class="limit-empty">Nessuna limitazione registrata — se hai un infortunio o un fastidio ricorrente, aggiungilo qui: il coach ne terrà conto sempre, non solo oggi.</div>'; return; }
    wrap.innerHTML = arr.map(l => {
      const tagInfo = this.LIMIT_TAGS.find(t => t.key === l.tag) || this.LIMIT_TAGS[this.LIMIT_TAGS.length - 1];
      return `<div class="limit-chip">
        <i class="ti ${tagInfo.icon}"></i>
        <div class="limit-chip-body"><span class="limit-chip-tag">${esc(tagInfo.label)}</span><span class="limit-chip-txt">${esc(l.text)}</span></div>
        <button class="limit-chip-rm" onclick="Diary.removeLimitation('${l.id}')" aria-label="Rimuovi"><i class="ti ti-x"></i></button>
      </div>`;
    }).join("");
  },
  addLimitationFromForm() {
    const ta = document.getElementById("limit-ta");
    const sel = document.getElementById("limit-tag-sel");
    if (!ta || !ta.value.trim()) return;
    this.addLimitation(ta.value, sel ? sel.value : "altro");
    ta.value = "";
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Schede module (gestione schede)
// ═══════════════════════════════════════════════
const Schede = {
  editing:   null,   // id scheda in modifica, null = nuova
  draftEx:   [],     // esercizi in editing
  draftColor:"Rosso",
  dragIdx:   null,

  COLORS: ["Rosso","Blu","Verde","Arancione","Viola","Rosa","Giallo"],

  async load() {
    await App.loadSchede();
    this.render();
  },

  escq: s => String(s).replace(/'/g, "\\'"),

  render() {
    const wrap = document.getElementById("schede-list");
    if (!wrap) return;
    wrap.innerHTML = "";
    const programmi = App.programmi || {};
    const names = Object.keys(programmi);
    if (!names.length) {
      wrap.innerHTML = '<div class="empty-state">Nessun programma. Crea il primo con "Nuovo programma"!</div>';
      return;
    }
    if (!this._expanded) this._expanded = new Set();   // di base tutti i programmi chiusi

    names.forEach(pg => {
      const sedute   = programmi[pg];
      const isActive = pg === App.activeProgram;
      const open     = this._expanded.has(pg);
      const pgEsc    = this.escq(pg);
      const card = document.createElement("div");
      card.className = "prog-card" + (isActive ? " active" : "");
      card.innerHTML = `
        <div class="prog-head" onclick="Schede.toggleProgram('${pgEsc}')">
          <i class="ti ti-chevron-right prog-chev${open ? " open" : ""}"></i>
          <div class="prog-name">${pg}</div>
          <button class="prog-rename" onclick="event.stopPropagation();Schede.renameProgram('${pgEsc}')" aria-label="Rinomina programma"><i class="ti ti-pencil"></i></button>
          ${isActive ? '<span class="prog-active-badge"><i class="ti ti-check"></i>Attiva</span>' : ""}
          <span class="prog-count">${sedute.length} sed.</span>
          ${isActive ? "" : `<button class="prog-activate" onclick="event.stopPropagation();Schede.setActive('${pgEsc}')">Rendi attiva</button>`}
        </div>
        <div class="prog-body${open ? " open" : ""}">
          ${sedute.map(s => `
            <div class="seduta-card">
              <div class="seduta-head">
                <span class="seduta-dot" style="background:${s.colore}"></span>
                <span class="seduta-name">${s.nome}</span>
                <span class="seduta-count">${s.exercises.length} es.</span>
                <button class="seduta-act" onclick="Schede.openEditor('${s.id}')" aria-label="Modifica"><i class="ti ti-pencil"></i></button>
                <button class="seduta-act del" onclick="Schede.remove('${s.id}','${s.nome.replace(/'/g,"")}')" aria-label="Elimina"><i class="ti ti-trash"></i></button>
              </div>
              <div class="seduta-list">
                ${s.exercises.length
                  ? s.exercises.map((e, i) => `
                    <div class="ex-line">
                      <span class="ex-line-num">${i + 1}</span>
                      <span class="ex-line-name">${U.exName(e)}${(U.exTec(e).length || U.exGrp(e)) ? ` <i class="ti ti-bolt ex-line-tech" title="${[...U.exTec(e), U.exGrp(e) ? "Superset " + U.exGrp(e) : ""].filter(Boolean).join(", ")}"></i>` : ""}</span>
                      <span class="ex-line-sets">${U.exSets(e)}<small>serie</small></span>
                    </div>`).join("")
                  : '<div class="ex-line empty">Nessun esercizio — tocca la matita per aggiungerli</div>'}
              </div>
            </div>`).join("")}
          <button class="prog-add-seduta" onclick="Schede.addSeduta('${pgEsc}')"><i class="ti ti-plus"></i> Aggiungi seduta</button>
        </div>
      `;
      wrap.appendChild(card);
    });
  },

  toggleProgram(pg) {
    if (!this._expanded) this._expanded = new Set();
    if (this._expanded.has(pg)) this._expanded.delete(pg);
    else this._expanded.add(pg);
    this.render();
  },

  async setActive(pg) {
    try {
      await API.setActiveProgram(pg, App.schede);
      if (this._expanded) this._expanded.add(pg);
      await this.load();
    } catch(e) { console.error(e); U.alert("Errore nel cambio programma attivo"); }
  },

  async newProgram() {
    const name = await U.prompt("Nuovo programma", { placeholder: "Es. Massa, Definizione…", okText: "Crea" });
    if (!name || !name.trim()) return;
    this._newProgram = name.trim();
    this.openEditor();   // crea la prima seduta di questo programma
  },

  // Rinomina un programma: aggiorna il campo "Programma" su tutte le sue sedute
  async renameProgram(pg) {
    const name = await U.prompt("Rinomina programma", { value: pg, okText: "Salva" });
    const newName = (name || "").trim();
    if (!newName || newName === pg) return;
    const sedute = (App.programmi && App.programmi[pg]) || [];
    try {
      await Promise.all(sedute.map(s => API.updateScheda(s.id, { programma: newName })));
      if (this._expanded && this._expanded.has(pg)) { this._expanded.delete(pg); this._expanded.add(newName); }
      if (App.activeProgram === pg) App.activeProgram = newName;
      await this.load();
      U.toast("Programma rinominato", "ok");
    } catch(e) { console.error(e); U.toast("Errore nel rinominare", "err"); }
  },

  addSeduta(pg) {
    this._newProgram = pg;
    this.openEditor();
  },

  openEditor(id) {
    this.editing = id || null;
    const titleEl = document.getElementById("scheda-editor-title");
    if (id) {
      const s = App.schede.find(x => x.id === id);
      this.draftEx = (s.exercises || []).map(e => ({ nome: U.exName(e), serie: U.exSets(e), recupero: U.exRest(e), rir: U.exRir(e), rrMin: U.exRrMin(e), rrMax: U.exRrMax(e), tecnica: U.exTec(e), cadenza: U.exCad(e), info: U.exInfo(e), gruppo: U.exGrp(e) }));
      this.draftColor = API.COLOR_REV[s.colore] || "Rosso";
      document.getElementById("sc-nome").value = s.nome;
      titleEl.innerHTML = '<i class="ti ti-pencil"></i>Modifica seduta';
    } else {
      this.draftEx = [];
      this.draftColor = "Rosso";
      document.getElementById("sc-nome").value = "";
      const pg = this._newProgram || App.activeProgram || "La mia scheda";
      titleEl.innerHTML = `<i class="ti ti-clipboard-list"></i>Nuova seduta · <span style="color:var(--accent)">${pg}</span>`;
    }
    document.getElementById("scheda-editor-msg").textContent = "";
    this.buildColorPicker();
    this.buildExList();
    document.getElementById("scheda-editor").style.display = "flex";
  },

  closeEditor(e) {
    if (!e || e.target.id === "scheda-editor") {
      document.getElementById("scheda-editor").style.display = "none";
    }
  },

  buildColorPicker() {
    const wrap = document.getElementById("sc-color-picker");
    wrap.innerHTML = "";
    this.COLORS.forEach(c => {
      const hex = API.COLOR_MAP[c];
      const b = document.createElement("button");
      b.className = "color-swatch" + (this.draftColor === c ? " on" : "");
      b.style.background = hex;
      b.onclick = () => { this.draftColor = c; this.buildColorPicker(); };
      wrap.appendChild(b);
    });
  },

  buildExList() {
    const wrap = document.getElementById("sc-ex-list");
    wrap.innerHTML = "";
    if (!this.draftEx.length) {
      wrap.innerHTML = '<div class="ex-editor-empty">Nessun esercizio. Aggiungine sotto.</div>';
      return;
    }
    this.draftEx.forEach((ex, i) => {
      const row = document.createElement("div");
      row.className = "ex-editor-item";
      row.draggable = true;
      row.innerHTML = `
        <div class="ex-editor-top">
          <i class="ti ti-grip-vertical ex-editor-grip"></i>
          <span class="ex-editor-name">${U.exName(ex)}</span>
          <button class="ex-editor-del" onclick="Schede.removeExercise(${i})"><i class="ti ti-x"></i></button>
        </div>
        <div class="ex-editor-fields">
          <div class="ex-editor-sets">
            <button type="button" onclick="Schede.bumpSets(${i},-1)">−</button>
            <span id="scsets-${i}">${U.exSets(ex)}</span>
            <button type="button" onclick="Schede.bumpSets(${i},1)">+</button>
            <small>serie</small>
          </div>
          <label class="ex-editor-f ex-editor-range"><span>Rep</span>
            <span class="range-pair">
              <input type="number" min="1" max="40" placeholder="8" value="${U.exRrMin(ex)}" onchange="Schede.setRange(${i},'rrMin',this.value)">
              <i>–</i>
              <input type="number" min="1" max="40" placeholder="12" value="${U.exRrMax(ex)}" onchange="Schede.setRange(${i},'rrMax',this.value)">
            </span></label>
          <label class="ex-editor-f"><span>Rec s</span>
            <input type="number" min="0" step="5" placeholder="90" value="${U.exRest(ex) ?? ""}" onchange="Schede.setMeta(${i},'recupero',this.value)"></label>
          <label class="ex-editor-f"><span>RIR</span>
            <input type="number" min="0" max="10" step="1" placeholder="2" value="${U.exRir(ex) ?? ""}" onchange="Schede.setMeta(${i},'rir',this.value)"></label>
        </div>
        <div class="ed-tech${(U.exTec(ex).length || U.exGrp(ex)) ? " has-tech" : ""}" id="ed-tech-${i}">
          ${this.edTechHTML(i, ex)}
        </div>
      `;
      row.addEventListener("dragstart", () => this.dragIdx = i);
      row.addEventListener("dragover", e => e.preventDefault());
      row.addEventListener("drop", e => {
        e.preventDefault();
        if (this.dragIdx === null || this.dragIdx === i) return;
        const moved = this.draftEx.splice(this.dragIdx, 1)[0];
        this.draftEx.splice(i, 0, moved);
        this.dragIdx = null;
        this.buildExList();
      });
      wrap.appendChild(row);
    });
  },

  addExercise() {
    const inp = document.getElementById("sc-new-ex");
    const val = inp.value.trim();
    if (!val) return;
    this.draftEx.push({ nome: val, serie: 3, recupero: null, rir: null, rrMin: 8, rrMax: 12, tecnica: [], cadenza: "", info: "", gruppo: "" });
    inp.value = "";
    inp.focus();
    this.buildExList();
  },

  // Aumenta/diminuisce il numero di serie (conserva recupero/rir)
  bumpSets(i, d) {
    if (!this.draftEx[i]) return;
    const next = Math.max(1, Math.min(20, U.exSets(this.draftEx[i]) + d));
    this.draftEx[i].serie = next;
    const el = document.getElementById(`scsets-${i}`);
    if (el) el.textContent = next;
  },

  // Imposta recupero/rir di un esercizio in editing
  setMeta(i, field, val) {
    if (!this.draftEx[i]) return;
    this.draftEx[i][field] = (val === "" ? null : Number(val));
  },

  // Imposta il rep range (min/max) di un esercizio in editing
  setRange(i, field, val) {
    if (!this.draftEx[i]) return;
    const n = parseInt(val);
    this.draftEx[i][field] = (val === "" || isNaN(n)) ? (field === "rrMin" ? 8 : 12) : Math.max(1, Math.min(40, n));
  },

  // ─── Tecnica di intensità nell'editor scheda (come in sessione) ───
  edPartners(i) {
    const g = U.exGrp(this.draftEx[i]);
    if (!g) return [];
    return this.draftEx.filter((e, j) => j !== i && U.exGrp(e) === g).map(e => U.exName(e));
  },
  edTechHTML(i, ex) {
    const tec = U.exTec(ex), grp = U.exGrp(ex);
    const partners = this.edPartners(i);
    const sup = grp ? `<span class="ed-tech-sup"><i class="ti ti-link"></i>Superset${partners.length ? " con " + partners.join(", ") : ""}</span>` : "";
    const tecLbl = tec.length ? `<span>${tec.join(", ")}</span>` : "";
    const summary = (sup || tecLbl) ? `<span class="ed-tech-sum">${sup}${tecLbl}</span>` : `<span class="ed-tech-sum muted">imposta…</span>`;
    const chips = (CONFIG.TECNICHE || []).map(t => {
      const on = tec.includes(t.name);
      return `<button type="button" class="tech-chip${on ? " on" : ""}" style="${on ? `--tc:${t.color}` : ""}" onclick="Schede.edToggleTec(${i},'${t.name}')">${t.name}</button>`;
    }).join("");
    const corr = this.draftEx.map((e, j) => ({ e, j })).filter(o => o.j !== i).map(o => {
      const og = U.exGrp(o.e);
      const same = grp && og === grp, other = og && og !== grp;
      return `<label class="tg-ex${other ? " off" : ""}${same ? " on" : ""}"><input type="checkbox" ${same ? "checked" : ""} ${other ? "disabled" : ""} onchange="Schede.edCorrelate(${i},${o.j},this.checked)"><span>${U.exName(o.e)}</span></label>`;
    }).join("");
    return `
      <button type="button" class="ed-tech-toggle" onclick="Schede.toggleEdTech(${i}, this)">
        <i class="ti ti-bolt"></i><span class="ed-tech-label">Tecnica di intensità</span>${summary}<i class="ti ti-chevron-down ed-tech-chev"></i>
      </button>
      <div class="ed-tech-box">
        <div class="tg-lbl">Tecnica</div>
        <div class="tech-chips">${chips}</div>
        <div class="tech-fields">
          <label class="tech-field"><span>Cadenza</span><input class="tech-in" type="text" placeholder="3-1-1" value="${U.exCad(ex)}" onchange="Schede.edSetText(${i},'cadenza',this.value)"></label>
        </div>
        <div class="tg-lbl">Info tecnica</div>
        <textarea class="tech-in tg-info" rows="2" placeholder="Es. drop al 70%, 2 cali; eccentrica 3s..." onchange="Schede.edSetText(${i},'info',this.value)">${U.exInfo(ex)}</textarea>
        <div class="tg-lbl">Superset — raggruppa con</div>
        <div class="tg-exs">${corr || '<span class="tech-empty">Nessun altro esercizio</span>'}</div>
      </div>`;
  },
  toggleEdTech(i, btn) { const w = btn.closest(".ed-tech"); if (w) w.classList.toggle("open"); },
  _reTechRow(i) {
    const w = document.getElementById(`ed-tech-${i}`);
    if (!w) return;
    const open = w.classList.contains("open");
    w.innerHTML = this.edTechHTML(i, this.draftEx[i]);
    w.classList.toggle("has-tech", !!(U.exTec(this.draftEx[i]).length || U.exGrp(this.draftEx[i])));
    if (open) w.classList.add("open");
  },
  edToggleTec(i, name) {
    const cur = new Set(U.exTec(this.draftEx[i]));
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    this.draftEx[i].tecnica = [...cur];
    this._reTechRow(i);
  },
  edSetText(i, field, val) { if (this.draftEx[i]) this.draftEx[i][field] = val; },
  edNextGroup() {
    const used = new Set(this.draftEx.map(e => U.exGrp(e)).filter(Boolean));
    return (CONFIG.GRUPPI || ["A","B","C","D","E","F"]).find(g => !used.has(g)) || "A";
  },
  edCorrelate(i, j, checked) {
    if (checked) {
      const g = U.exGrp(this.draftEx[i]) || U.exGrp(this.draftEx[j]) || this.edNextGroup();
      this.draftEx[i].gruppo = g; this.draftEx[j].gruppo = g;
    } else {
      this.draftEx[j].gruppo = "";
      const g = U.exGrp(this.draftEx[i]);
      if (g && this.draftEx.filter(e => U.exGrp(e) === g).length < 2) this.draftEx[i].gruppo = "";
    }
    this.buildExList();
  },

  removeExercise(i) {
    this.draftEx.splice(i, 1);
    this.buildExList();
  },

  async save() {
    const nome = document.getElementById("sc-nome").value.trim();
    const msg  = document.getElementById("scheda-editor-msg");
    if (!nome) { msg.textContent = "Inserisci un nome"; return; }
    if (!this.draftEx.length) { msg.textContent = "Aggiungi almeno un esercizio"; return; }
    msg.textContent = "Salvataggio...";
    try {
      if (this.editing) {
        await API.updateScheda(this.editing, { nome, colorName: this.draftColor, exercises: this.draftEx });
      } else {
        const programma = this._newProgram || App.activeProgram || "La mia scheda";
        // se non esiste ancora un programma attivo, il primo creato diventa attivo
        const progAttivo = (programma === App.activeProgram) || !App.activeProgram;
        const ordine = App.schede.length + 1;
        await API.createScheda(nome, this.draftColor, this.draftEx, ordine, programma, progAttivo);
      }
      this._newProgram = null;
      document.getElementById("scheda-editor").style.display = "none";
      await this.load();
      U.toast(this.editing ? "Seduta aggiornata" : "Seduta creata", "ok");
    } catch(e) {
      console.error(e);
      msg.textContent = "Errore nel salvataggio";
      U.toast("Errore nel salvataggio", "err");
    }
  },

  async remove(id, nome) {
    if (!await U.confirm(`Eliminare la seduta "${nome}"? Le sessioni già salvate restano.`, { danger: true, okText: "Elimina" })) return;
    try {
      await API.deleteScheda(id);
      await this.load();
      U.toast("Seduta eliminata", "ok");
    } catch(e) { console.error(e); U.alert("Errore eliminazione"); }
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Export PDF (report allenamenti + grafico progressione per esercizio)
//  #G. Nessuna libreria nuova: grafici Chart.js -> PNG, report HTML
//  self-contained, stampa via iframe (l'utente sceglie "Salva come PDF").
// ═══════════════════════════════════════════════
const ExportPDF = {
  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
  _setNum(name) { const m = (name || "").split(" – ").pop().match(/S(\d+)/); return m ? +m[1] : 99; },

  async open() {
    let all = [];
    try { all = await API.getWorkoutSessions(200); } catch (e) {}
    const done  = all.filter(s => s.done);
    const types = [...new Set(done.map(s => s.type || s.name).filter(Boolean))];
    if (!done.length) { U.toast("Nessun allenamento completato da esportare", "info"); return; }
    const ov = document.createElement("div");
    ov.className = "app-modal-overlay"; ov.style.display = "flex";
    ov.innerHTML =
      '<div class="app-modal-box exp-box" onclick="event.stopPropagation()">' +
        '<div class="exp-title"><i class="ti ti-file-download"></i> Esporta in PDF</div>' +
        '<label class="exp-lbl">Tipo di allenamento</label>' +
        '<select class="select-dark" id="exp-type"><option value="__all__">Tutti i tipi</option>' +
          types.map(t => `<option value="${this._esc(t)}">${this._esc(t)}</option>`).join("") +
        '</select>' +
        '<label class="exp-lbl">Quante sessioni (dalle più recenti)</label>' +
        '<input class="field-inp" id="exp-limit" type="number" min="1" max="100" value="12">' +
        '<div class="exp-actions">' +
          '<button class="btn-secondary" id="exp-cancel">Annulla</button>' +
          '<button class="btn-primary" id="exp-go"><i class="ti ti-file-download"></i> Genera PDF</button>' +
        '</div>' +
      '</div>';
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
    ov.querySelector("#exp-cancel").onclick = () => ov.remove();
    ov.querySelector("#exp-go").onclick = () => {
      const type  = ov.querySelector("#exp-type").value;
      const limit = Math.max(1, parseInt(ov.querySelector("#exp-limit").value) || 12);
      ov.remove();
      this.generate(type, limit);
    };
  },

  async generate(type, limit) {
    U.toast("Preparo l'export…", "info");
    let all = [];
    try { all = await API.getWorkoutSessions(200); } catch (e) { U.toast("Errore nel recupero", "err"); return; }
    let sess = all.filter(s => s.done);
    if (type && type !== "__all__") sess = sess.filter(s => (s.type || s.name) === type);
    sess.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (limit) sess = sess.slice(-limit);
    if (!sess.length) { U.toast("Nessuna sessione da esportare", "info"); return; }
    const withEx = [];
    for (const s of sess) {
      let ex = [];
      try { ex = await API.getSessionExercises(s.id); } catch (e) {}
      withEx.push({ ...s, exercises: ex });
    }
    // Progressione PER ESERCIZIO — come la zona "Progressione" dell'app: il
    // VOLUME TOTALE della seduta (peso×rep sommato su tutte le serie), non
    // il solo set migliore — stesso fix e stesso motivo (un set di punta
    // invariato ma le altre serie migliorate è comunque progresso reale).
    const perEx = {};
    withEx.forEach(s => {
      const g = {};
      s.exercises.forEach(r => { if ((r.reps || 0) <= 0) return; const k = U.exBase(r.name); (g[k] = g[k] || []).push(r); });
      Object.keys(g).forEach(k => {
        const volume = g[k].reduce((t, r) => t + (r.reps || 0) * (r.kg || 0), 0);
        const repsTot = g[k].reduce((t, r) => t + (r.reps || 0), 0);
        (perEx[k] = perEx[k] || []).push({ date: s.date, volume, repsTot });
      });
    });
    // record: il volume totale (rep totali a corpo libero) supera tutti i
    // precedenti. isBW è una decisione GLOBALE per esercizio (stesso motivo
    // di Progression.groupSessions): se una singola seduta a corpo libero
    // finisce dentro uno storico altrimenti pesato, il suo volume=0 non è un
    // vero crollo — progVal resta null (buco onesto nel grafico PDF).
    Object.values(perEx).forEach(pts => {
      const isBW = pts.every(p => p.volume === 0);
      pts.forEach(p => { p.progVal = isBW ? p.repsTot : (p.volume === 0 ? null : p.volume); });
      let run = 0;
      pts.forEach((p, i) => {
        if (p.progVal == null) { p.isPR = false; return; }
        p.isPR = i > 0 && p.progVal > run && p.progVal > 0;
        run = Math.max(run, p.progVal);
      });
    });
    const charts = {};
    for (const [name, pts] of Object.entries(perEx)) {
      if (pts.length >= 2) { try { charts[name] = this._chartURL(name, pts); } catch (e) {} }
    }
    this._printHTML(this._buildHTML(type, withEx, charts));
  },

  _chartURL(name, pts) {
    const c = document.createElement("canvas");
    c.width = 680; c.height = 240;
    const isBW = pts.every(p => p.volume === 0);
    const data = pts.map(p => p.progVal);
    const ptColors = pts.map(p => p.isPR ? "#F59E0B" : "#FF3B2F");   // record in ambra
    const ptRadius = pts.map(p => p.isPR ? 6 : 3);
    const chart = new Chart(c.getContext("2d"), {
      type: "line",
      data: {
        labels: pts.map(p => U.fmtDate(p.date)),
        datasets: [{ data, borderColor: "#FF3B2F", backgroundColor: "rgba(255,59,47,.10)", spanGaps: false,
          fill: true, tension: .3, pointRadius: ptRadius, pointBackgroundColor: ptColors, borderWidth: 2 }],
      },
      options: { responsive: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: "#666", font: { size: 10 } }, grid: { color: "#eee" } },
                  y: { ticks: { color: "#666", font: { size: 10 }, callback: v => isBW ? U.fmt(v) + " r" : U.fmtV(v) }, grid: { color: "#eee" } } } },
    });
    const url = c.toDataURL("image/png");
    chart.destroy();
    return url;
  },

  _buildHTML(type, sessions, charts) {
    const esc = this._esc.bind(this);
    const scope = (type && type !== "__all__") ? esc(type) : "Tutti i tipi";
    const range = sessions.length ? `${U.fmtDate(sessions[0].date)} – ${U.fmtDate(sessions[sessions.length - 1].date)}` : "";
    // Un grafico di progressione per ESERCIZIO (come la zona Progressione dell'app)
    const chartCards = Object.keys(charts).sort().map(n =>
      `<div class="rp-chart"><div class="rp-chart-t">${esc(n)}</div><img src="${charts[n]}" alt=""></div>`).join("");
    const chartSec = chartCards
      ? `<h2 class="rp-h2">Progressione per esercizio <span class="rp-h2s">(volume totale per seduta · <span class="rp-pr">●</span> record)</span></h2>` +
        `<div class="rp-charts">${chartCards}</div>`
      : "";
    const sessBlocks = [...sessions].reverse().map(s => {
      let exNotes = {}; try { exNotes = JSON.parse(localStorage.getItem("gymos_exnote_" + s.id) || "{}"); } catch (e) {}
      const g = {}, order = [];
      s.exercises.forEach(r => { const k = U.exBase(r.name); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(r); });
      const rows = order.map(k => {
        const sets = g[k].filter(r => (r.reps || 0) > 0).sort((a, b) => this._setNum(a.name) - this._setNum(b.name));
        if (!sets.length) return "";
        const setStr = sets.map(r => `${r.kg ? U.fmt(r.kg) + "kg" : "CL"}×${r.reps}`).join("  ·  ");
        const setNote = sets.map(r => r.note).filter(Boolean).join(" · ");
        const notes = [setNote, exNotes[k] || ""].filter(Boolean).join(" — ");
        return `<tr><td class="rp-ex">${esc(k)}</td><td class="rp-sets">${esc(setStr)}${notes ? `<div class="rp-note">${esc(notes)}</div>` : ""}</td></tr>`;
      }).join("");
      return `<div class="rp-sess"><div class="rp-sess-h"><b>${esc(s.name)}</b><span>${U.fmtDate(s.date)}${s.type ? " · " + esc(s.type) : ""}</span></div>` +
        (s.note ? `<div class="rp-snote">${esc(s.note)}</div>` : "") +
        `<table class="rp-tbl">${rows}</table></div>`;
    }).join("");
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>GymOS — Report allenamenti</title>` +
      `<style>${this._css()}</style></head><body>` +
      `<div class="rp-head"><div class="rp-logo">GYM<span>OS</span></div>` +
        `<div class="rp-meta"><div class="rp-mt">Report allenamenti</div><div>${scope} · ${sessions.length} sessioni</div><div>${range}</div></div></div>` +
      chartSec +
      `<h2 class="rp-h2">Dettaglio sessioni</h2>${sessBlocks}` +
      `<div class="rp-foot">Generato da GymOS</div></body></html>`;
  },

  _css() {
    return `*{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:22px;background:#fff;font-size:12px}
      .rp-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #FF3B2F;padding-bottom:10px;margin-bottom:16px}
      .rp-logo{font-weight:800;font-size:26px;letter-spacing:1px}.rp-logo span{color:#FF3B2F}
      .rp-meta{text-align:right;color:#555;font-size:11px;line-height:1.5}.rp-mt{font-weight:700;color:#1a1a1a;font-size:13px}
      .rp-h2{font-size:14px;margin:20px 0 10px;color:#FF3B2F;border-bottom:1px solid #eee;padding-bottom:4px}
      .rp-charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .rp-chart{border:1px solid #eee;border-radius:8px;padding:8px;break-inside:avoid}
      .rp-chart-t{font-weight:700;font-size:11px;margin-bottom:4px}.rp-chart img{width:100%;height:auto;display:block}
      .rp-h2s{font-weight:400;font-size:11px;color:#888}.rp-pr{color:#F59E0B;font-size:12px}
      .rp-sess{border:1px solid #eee;border-radius:8px;padding:10px 12px;margin-bottom:10px;break-inside:avoid}
      .rp-sess-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
      .rp-sess-h b{font-size:13px}.rp-sess-h span{color:#666;font-size:11px}
      .rp-snote{background:#f6f6f6;border-radius:6px;padding:5px 8px;font-size:11px;color:#444;margin-bottom:6px;font-style:italic}
      .rp-tbl{width:100%;border-collapse:collapse}
      .rp-tbl td{padding:4px 6px;border-top:1px solid #f0f0f0;vertical-align:top}
      .rp-ex{font-weight:700;width:38%}.rp-sets{font-family:'DM Mono',ui-monospace,monospace;color:#222}
      .rp-note{color:#888;font-size:10px;margin-top:2px;font-family:sans-serif}
      .rp-foot{margin-top:18px;text-align:center;color:#aaa;font-size:10px}
      @media print{.rp-chart,.rp-sess{break-inside:avoid}}
      @page{margin:14mm}`;
  },

  _printHTML(html) {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const fire = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { U.toast("Stampa non disponibile", "err"); }
      setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 60000);
    };
    if (iframe.contentWindow.document.readyState === "complete") setTimeout(fire, 400);
    else iframe.onload = () => setTimeout(fire, 400);
  },
};

// ═══════════════════════════════════════════════
//  GymOS — "Il punto di oggi" (#H): recap/consigli giornalieri in home.
//  Motore di insight sui segnali già disponibili (sedute, peso+fase, sonno/HRV,
//  abitudini, volume, segnale-forza). Regole evidence-based, ordinate per
//  urgenza. Niente falsa precisione: parla solo quando i dati lo giustificano.
// ═══════════════════════════════════════════════
const DailyRecap = {
  SEV: { alert: 0, warn: 1, info: 2, good: 3 },

  _weekDone(sessions) {
    // Settimana da LUNEDÌ (allineata a Volume._weekStart e a buildStats)
    const now = new Date(), sow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    sow.setDate(sow.getDate() - ((now.getDay() + 6) % 7));
    return (sessions || []).filter(s => s.done && s.date && new Date(s.date) >= sow).length;
  },

  // Trend peso: %/settimana su una finestra utile (ref = check-in più vecchio a
  // >=4 giorni). null se dati insufficienti. Coerente con Body._energyFlag.
  _weightTrend(checkins) {
    const w = (checkins || []).filter(c => c.peso != null && c.peso > 0);
    if (w.length < 2) return null;
    const last = w[w.length - 1], lastT = new Date(last.date).getTime();
    let ref = null;
    for (const c of w) { const dd = (lastT - new Date(c.date).getTime()) / 86400000; if (dd >= 4) { ref = c; break; } }
    if (!ref) ref = w[0];
    const days = (lastT - new Date(ref.date).getTime()) / 86400000;
    if (days < 4) return null;
    const dKg = Math.round((last.peso - ref.peso) * 10) / 10;
    return { rate: (dKg / ref.peso) * 100 / (days / 7), dKg, days, peso: last.peso };
  },

  _fmtRate(r) { const v = Math.round(r * 10) / 10; return `${v > 0 ? "+" : ""}${String(v).replace(".", ",")}%/sett`; },
  _protein(peso) { return peso ? `${Math.round(peso * 1.6)}–${Math.round(peso * 2.2)} g/die` : "1,6–2,2 g/kg"; },

  // Quanti check-in CONSECUTIVI (dal più recente a ritroso) sono nella stessa
  // fase attuale — stima grezza di "da quanto sei in questa fase" usando solo
  // dati già tracciati (fase per check-in), niente nuovo campo. Non è un
  // conteggio esatto di settimane (dipende da quanto spesso ti pesi), solo un
  // segnale per capire se una fase si sta protraendo.
  _phaseStreak(checkins, re) {
    let n = 0;
    for (let i = (checkins || []).length - 1; i >= 0; i--) {
      if (re.test(checkins[i].fase || "")) n++; else break;
    }
    return n;
  },
  // Giorni di calendario coperti dallo streak (dal primo check-in della
  // sequenza all'ultimo) — un utente che si pesa più volte nello stesso
  // giorno farebbe salire `_phaseStreak` senza che sia passato tempo reale;
  // questo evita di scattare il diet-break dopo pochi giorni scambiati per
  // "8 settimane" solo perché i check-in sono frequenti.
  _phaseStreakDays(checkins, re) {
    const arr = checkins || [];
    let start = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!re.test(arr[i].fase || "")) break;
      start = arr[i];
    }
    if (!start || !arr.length) return 0;
    const last = arr[arr.length - 1];
    return (new Date(last.date).getTime() - new Date(start.date).getTime()) / 86400000;
  },

  build(d) {
    const ins = [];
    const add = (sev, icon, title, msg) => ins.push({ sev, icon, title, msg });

    // ── ALLENAMENTO — frequenza ──
    const done = this._weekDone(d.sessions);
    const target = Object.keys((typeof CONFIG !== "undefined" && CONFIG.SCHEDE) || {}).length || 3;
    const dow = new Date().getDay();   // 0 = domenica
    if (target > 0 && done >= target) add("good", "ti-flame", "Settimana completata", `${done}/${target} sedute fatte: ottima costanza.`);
    else if (done === 0 && (dow >= 4 || dow === 0)) add("info", "ti-barbell", "Settimana ancora ferma", "Nessuna seduta finora: se puoi, recuperane almeno una.");
    else add("info", "ti-barbell", "Allenamenti", `${done}/${target} sedute questa settimana: tieni il ritmo.`);

    // ── ALLENAMENTO — volume sotto il minimo ──
    if (d.volume && d.volume.vol) {
      const low = Object.keys(d.volume.vol).filter(m => d.volume.vol[m] > 0 && d.volume.vol[m] < 10);
      if (low.length) add("info", "ti-chart-bar", "Volume basso", `Sotto le 10 serie/sett su: ${low.slice(0, 3).join(", ")}.`);
    }

    // ── SPINTA / FATICA — segnale forza diffuso ──
    const sig = d.strengthSig;
    const sigFresh = sig && sig.ts && (Date.now() - sig.ts) < 21 * 86400000;
    const strDown = sigFresh && sig.down;
    if (strDown) add("warn", "ti-battery-2", "Forza in calo diffuso", "Cali su più esercizi: stai accumulando fatica. Valuta una seduta più leggera o un giorno di stacco, e cura sonno e cibo.");

    // ── SCARICO PROATTIVO (calendario, non reattivo) — soft, informativo:
    // non sostituisce/contraddice lo scarico reattivo (basato su calo reale),
    // è solo un'idea se non ci sono già segnali e non ne parli da un po'.
    const DELOAD_CALENDAR_DAYS = 56;   // ~8 settimane (Nippard: ogni ~2 mesi)
    const deloadDue = !strDown && d.lastDeloadTs > 0 && (Date.now() - d.lastDeloadTs) >= DELOAD_CALENDAR_DAYS * 86400000;
    if (deloadDue) add("info", "ti-refresh", "Scarico proattivo?", "Non hai avuto segnali di calo da un po': una settimana leggera ogni tanto (-25/50% carico-volume) aiuta tecnica e articolazioni anche senza bisogno reale — solo un'idea, non un obbligo.");

    // ── RECUPERO — sonno / HRV ──
    const sl = d.sleep && d.sleep[0];
    const avgSleep = d.sleep && d.sleep.length ? d.sleep.reduce((a, s) => a + (s.ore || 0), 0) / d.sleep.length : null;
    if (sl) {
      if ((sl.hrv && sl.hrv < 45) || (sl.ore || 7) < 6)
        add("alert", "ti-zzz", "Recupero basso oggi", `${sl.hrv && sl.hrv < 45 ? `HRV ${sl.hrv}ms basso` : "hai dormito poco"}: oggi meglio alleggerire o recuperare.`);
      else if ((sl.ore || 7) < 7)
        add("warn", "ti-zzz", "Recupero moderato", "Notte corta: tieni un'intensità controllata oggi.");
    }
    if (avgSleep != null && avgSleep < 6.5)
      add("warn", "ti-moon", "Dormi poco", `Media ${avgSleep.toFixed(1)}h a notte: il sonno è il primo motore di recupero e crescita. Punta a 7–8h.`);

    // ── FASE & NUTRIZIONE — peso vs fase (la parte "calorie") ──
    const wt = this._weightTrend(d.checkins);
    const fase = (d.checkins && d.checkins.length) ? (d.checkins[d.checkins.length - 1].fase || "") : "";
    if (wt && fase) {
      const r = wt.rate, prot = this._protein(wt.peso);
      if (/cut|defin|tagl/i.test(fase)) {
        if (r > -0.15) {
          const cutRe = /cut|defin|tagl/i;
          const longCut = this._phaseStreak(d.checkins, cutRe) >= 8 && this._phaseStreakDays(d.checkins, cutRe) >= 40;
          const dietBreak = longCut ? " Sei in questa fase da un po': oltre a tagliare le calorie, una pausa di 1-2 settimane a mantenimento può aiutare aderenza e fame senza rovinare i progressi." : "";
          add("warn", "ti-flame", "Definizione ferma", `In definizione ma il peso non scende (${this._fmtRate(r)}). Se resta fermo 1–2 settimane, taglia un po' le calorie.${dietBreak}`);
        }
        else if (r < -1.0 && strDown) add("alert", "ti-bolt", "Taglio troppo aggressivo", `Peso giù in fretta (${this._fmtRate(r)}) e forza in calo: rischio RED-S. Alza le calorie, tieni le proteine (~${prot}) e rallenta.`);
        else if (r < -1.0) add("warn", "ti-flame", "Taglio veloce", `Perdi in fretta (${this._fmtRate(r)}): occhio a non perdere muscolo. Proteine alte (~${prot}).`);
        else add("good", "ti-flame", "Definizione on track", `Perdi ~${this._fmtRate(r)}: ritmo giusto per tenere il muscolo.`);
      } else if (/bulk|massa|surplus/i.test(fase)) {
        if (r < 0.1) add("warn", "ti-trending-up", "Massa ferma", `In massa ma il peso non sale (${this._fmtRate(r)}): per crescere serve un lieve surplus, aumenta un po' le calorie.`);
        else if (r > 1.0) add("warn", "ti-trending-up", "Massa troppo rapida", `Sali in fretta (${this._fmtRate(r)}): modera il surplus per limitare il grasso (più sei avanzato, più conviene restare vicino a ~0,5–1%/mese).`);
        else add("good", "ti-trending-up", "Massa on track", `Cresci di ~${this._fmtRate(r)}: ritmo pulito.`);
      } else {
        if (Math.abs(r) < 0.3) add("good", "ti-equal", "Peso stabile", `Mantenimento ok (${this._fmtRate(r)}).`);
        else add("info", "ti-scale", "Peso in movimento", `${this._fmtRate(r)} in mantenimento: se non è voluto, rivedi le calorie.`);
      }
    }

    ins.sort((a, b) => this.SEV[a.sev] - this.SEV[b.sev]);
    const strTrend = strDown ? "giù" : (sigFresh ? "su" : "—");
    return {
      insights: ins,
      headline: ins[0] || null,
      stats: { done, target, avgSleep, rate: wt ? wt.rate : null, fase, strTrend, deloadFired: deloadDue, strDown },
    };
  },

  render(data) {
    const wrap = document.getElementById("daily-recap");
    if (!wrap) return;
    let strengthSig = null;
    try { strengthSig = JSON.parse(localStorage.getItem("gymos_strength_signal") || "null"); } catch (e) {}
    let volume = null;
    try { volume = (typeof Volume !== "undefined") ? Volume.compute() : null; } catch (e) {}
    // Scarico calendario: timestamp on-device dell'ultimo nudge/segnale, per
    // non ripetere il consiglio ogni giorno. Al primissimo utilizzo (mai
    // scritto prima) si "semina" senza mostrare nulla — evita di accogliere
    // un utente nuovo con un consiglio di scarico al primo avvio.
    let lastDeloadTs = 0;
    try { lastDeloadTs = parseInt(localStorage.getItem("gymos_last_deload_nudge_ts") || "0", 10) || 0; } catch (e) {}
    const r = this.build({ ...data, volume, strengthSig, lastDeloadTs });
    try {
      // Usa `r.stats.strDown` (calcolato in build(), già verificato per
      // freschezza entro 21gg) invece del `strengthSig.down` grezzo — un
      // segnale vecchio di settimane non deve resettare il timer all'infinito.
      if (!lastDeloadTs || r.stats.deloadFired || r.stats.strDown) localStorage.setItem("gymos_last_deload_nudge_ts", String(Date.now()));
    } catch (e) {}
    if (!r.insights.length) { wrap.innerHTML = ""; return; }
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hd = r.headline;
    // strip analitiche
    const chips = [];
    chips.push(`<div class="rc-chip"><span class="rc-cv">${r.stats.done}/${r.stats.target}</span><span class="rc-cl">sedute</span></div>`);
    if (r.stats.avgSleep != null) chips.push(`<div class="rc-chip"><span class="rc-cv">${r.stats.avgSleep.toFixed(1)}h</span><span class="rc-cl">sonno</span></div>`);
    if (r.stats.rate != null) chips.push(`<div class="rc-chip"><span class="rc-cv">${this._fmtRate(r.stats.rate).replace("/sett", "")}</span><span class="rc-cl">peso/sett</span></div>`);
    const trIc = r.stats.strTrend === "giù" ? "↓" : r.stats.strTrend === "su" ? "↑" : "→";
    chips.push(`<div class="rc-chip"><span class="rc-cv">${trIc}</span><span class="rc-cl">forza</span></div>`);
    // altre insight (oltre l'headline)
    const rest = r.insights.slice(1);
    const cards = rest.map(i => `
      <div class="rc-item rc-${i.sev}">
        <i class="ti ${i.icon}"></i>
        <div class="rc-txt"><span class="rc-it">${esc(i.title)}</span><span class="rc-im">${esc(i.msg)}</span></div>
      </div>`).join("");
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-sparkles"></i>Il punto di oggi</div>
      ${hd ? `<div class="rc-head rc-${hd.sev}">
        <i class="ti ${hd.icon}"></i>
        <div class="rc-txt"><span class="rc-it">${esc(hd.title)}</span><span class="rc-im">${esc(hd.msg)}</span></div>
      </div>` : ""}
      <div class="rc-strip">${chips.join("")}</div>
      ${cards ? `<div class="rc-list">${cards}</div>` : ""}
      <div class="rc-foot">Sintesi automatica dai tuoi dati · non è un consiglio medico</div>`;
  },
};

// ═══════════════════════════════════════════════
//  GymOS — "Come si esegue?" (free-exercise-db, pubblico dominio)
//  Indice leggero locale (EXERCISE_GUIDE_IDX, ~65KB) per il matching;
//  istruzioni+immagine caricate ON-DEMAND via CDN jsdelivr (mai scaricate in
//  anticipo, l'app resta leggera). Matching onesto: se ambiguo, SEMPRE un
//  selettore per l'utente — mai una scelta indovinata in silenzio.
// ═══════════════════════════════════════════════
const ExerciseGuide = {
  BASE: "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main",
  _idx: null,

  _load() {
    if (!this._idx) this._idx = (typeof EXERCISE_GUIDE_IDX !== "undefined") ? EXERCISE_GUIDE_IDX : [];
    return this._idx;
  },
  _norm(s) { return String(s == null ? "" : s).toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " "); },
  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },

  // Match esatto prima (alta confidenza); altrimenti "contenuto per intero"
  // in entrambe le direzioni, solo se la query ha almeno 5 caratteri (sotto
  // quella soglia il rischio di falsi positivi è troppo alto).
  find(name) {
    const idx = this._load();
    const q = this._norm(name);
    if (!q || q.length < 3) return [];
    const exact = idx.filter(e => this._norm(e.n) === q);
    if (exact.length) return exact;
    if (q.length < 5) return [];
    return idx.filter(e => { const en = this._norm(e.n); return en.includes(q) || q.includes(en); });
  },

  async open(exName) {
    const candidates = this.find(exName);
    const overlay = this._ensureOverlay();
    if (!candidates.length) {
      overlay.innerHTML = this._shell(`<div class="eg-empty"><i class="ti ti-search-off"></i> «${this._esc(exName)}» non trovato nel database (873 esercizi, in inglese).</div>`);
      overlay.style.display = "flex";
      return;
    }
    if (candidates.length === 1) { await this._showDetail(candidates[0]); return; }
    // Ambiguo: MAI scegliere da solo, mostra sempre il selettore.
    overlay.innerHTML = this._shell(`
      <div class="eg-pick-lbl">${candidates.length} varianti trovate — quale intendevi?</div>
      <div class="eg-pick-list">${candidates.slice(0, 14).map(c =>
        `<button class="eg-pick-item" onclick="ExerciseGuide._showDetailById('${c.id}')">${this._esc(c.n)}${c.m ? `<span>${this._esc(c.m)}</span>` : ""}</button>`).join("")}</div>`);
    overlay.style.display = "flex";
  },

  async _showDetailById(id) {
    const c = this._load().find(e => e.id === id);
    if (c) await this._showDetail(c);
  },

  async _showDetail(cand) {
    const overlay = this._ensureOverlay();
    overlay.innerHTML = this._shell(`<div class="eg-loading"><i class="ti ti-loader-2"></i> Carico la guida…</div>`);
    overlay.style.display = "flex";
    try {
      // Timeout 10s: su rete lenta lo spinner restava appeso per minuti
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${this.BASE}/exercises/${cand.id}.json`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error("fetch fallita");
      const d = await res.json();
      const img = (d.images && d.images[0]) ? `${this.BASE}/exercises/${d.images[0]}` : null;
      const steps = (d.instructions || []).map(s => `<li>${this._esc(s)}</li>`).join("");
      overlay.innerHTML = this._shell(`
        <div class="eg-title">${this._esc(d.name)}</div>
        ${cand.m ? `<div class="eg-muscle">${this._esc(cand.m)}</div>` : ""}
        ${img ? `<img class="eg-img" src="${img}" alt="" loading="lazy">` : ""}
        <ol class="eg-steps">${steps || "<li>Nessuna istruzione disponibile.</li>"}</ol>
        <div class="eg-src">Istruzioni originali in inglese · fonte: free-exercise-db (pubblico dominio)</div>`);
    } catch (e) {
      overlay.innerHTML = this._shell(`<div class="eg-empty"><i class="ti ti-wifi-off"></i> Non sono riuscito a caricare la guida: serve connessione.</div>`);
    }
  },

  _ensureOverlay() {
    let el = document.getElementById("eg-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "eg-overlay";
      el.className = "eg-overlay";
      el.onclick = e => { if (e.target === el) this.close(); };
      document.body.appendChild(el);
    }
    return el;
  },
  _shell(inner) {
    return `<div class="eg-box" onclick="event.stopPropagation()">
      <button class="eg-close" onclick="ExerciseGuide.close()"><i class="ti ti-x"></i></button>
      ${inner}
    </div>`;
  },
  close() { const el = document.getElementById("eg-overlay"); if (el) el.style.display = "none"; },
};

// ═══════════════════════════════════════════════
//  GymOS — "Chiedi al coach" (Q&A scienza-based, ricerca Google reale via
//  Gemini grounding). Feature SEPARATA dal consiglio veloce per-serie:
//  qui l'attesa (10-20s) è accettabile — la chiede l'utente, non blocca
//  l'allenamento. Errori mostrati esplicitamente (non silenziosi come il
//  consiglio automatico): l'utente ha chiesto attivamente, deve saperlo.
//  Modale riusabile da OVUNQUE (Home E Sessione, mentre ti alleni) —
//  stesso pattern di ExerciseGuide (overlay creato al volo, niente HTML
//  statico duplicato per contesto).
// ═══════════════════════════════════════════════
const Coach = {
  HISTORY_KEY: "gymos_coach_history",
  MAX_STORED: 60,      // storico on-device tenuto (localStorage)
  RELEVANT_K: 8,        // quanti scambi passati recuperare per SIMILARITÀ semantica (embedding)
  RECENT_KEEP: 3,       // ultimi scambi SEMPRE inclusi per continuità conversazionale
  CONTEXT_CAP: 14,      // tetto totale mandato a Gemini (rilevanti + recenti, deduplicati)

  // Include l'escape delle virgolette: le fonti (`s.uri`/`s.title`, da Google
  // Search grounding — contenuto web esterno, non fidato) finiscono anche
  // dentro un attributo `href="..."` in _renderList, non solo come testo. Un
  // URI con una `"` romperebbe l'attributo e permetterebbe di iniettare altri
  // attributi (XSS) senza questo escape.
  _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  // Markdown-lite → HTML per le risposte del coach (grassetto, corsivo,
  // codice, liste, tabelle semplici). Opera SEMPRE su testo GIÀ escapato
  // (_esc prima), quindi aggiunge solo tag sicuri attorno a testo che non può
  // più contenere `<`/`>`/`&` grezzi — niente XSS anche su risposte Gemini
  // "creative" o contenuto di fonti web nella risposta.
  _inlineMd(s) {
    return s
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Dopo aver consumato i ** (bold), i singoli * rimasti sono corsivo —
      // niente lookaround necessario, non restano più coppie doppie.
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>");
  },
  _md(raw) {
    const esc = this._esc(raw);
    const blocks = esc.split(/\n{2,}/);
    return blocks.map(block => {
      const lines = block.split("\n").filter(l => l.length);
      if (!lines.length) return "";
      if (lines.length >= 2 && /\|/.test(lines[0]) && /^[\s|:-]+$/.test(lines[1]) && lines[1].includes("-")) {
        const cells = l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        const head = cells(lines[0]);
        const rows = lines.slice(2).map(cells);
        return `<div class="coach-table-wrap"><table class="coach-table"><thead><tr>${head.map(h => `<th>${this._inlineMd(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${this._inlineMd(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines.map(l => `<li>${this._inlineMd(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every(l => /^\s*\d+\.\s+/.test(l))) {
        return `<ol>${lines.map(l => `<li>${this._inlineMd(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${lines.map(l => this._inlineMd(l)).join("<br>")}</p>`;
    }).join("");
  },

  // ── Memoria persistente on-device (come diario/note-esercizio: niente
  // nuovo schema Notion). Condivisa tra la zona in Home e il modale in
  // Sessione — stessa conversazione ovunque la apri. ──
  _loadHistory() { try { return JSON.parse(localStorage.getItem(this.HISTORY_KEY) || "[]"); } catch (e) { return []; } },
  _saveHistory(arr) { try { localStorage.setItem(this.HISTORY_KEY, JSON.stringify(arr.slice(-this.MAX_STORED))); } catch (e) {} },
  _pushHistory(entry) { const arr = this._loadHistory(); arr.push(entry); this._saveHistory(arr); },

  // ── Memoria "a cervello" — retrieval semantico via embedding, non solo
  // gli ultimi N messaggi in ordine cronologico. Ogni scambio passato ha un
  // embedding (calcolato in background dopo la risposta); una nuova domanda
  // viene confrontata via cosine similarity con TUTTO lo storico salvato
  // (fino a 60 scambi) per trovare cosa è davvero collegato, non solo cosa
  // è recente. Ricerca fatta interamente lato client (istantanea, nessun
  // server/DB) — il worker calcola solo il vettore via Gemini embeddings.
  _cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return -1;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return -1;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  },
  async _embed(texts) {
    try {
      const res = await fetch(`${CONFIG.AI_WORKER_URL}/embed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data && Array.isArray(data.embeddings)) ? data.embeddings : null;
    } catch (e) { return null; }
  },
  // Costruisce la selezione di storico da mandare a Gemini per una domanda:
  // top-K per similarità semantica + ultimi RECENT_KEEP per continuità,
  // deduplicati e riordinati cronologicamente. Fallback onesto: se
  // l'embedding fallisce (offline/errore), usa solo la recency (comportamento
  // precedente), niente eccezioni propagate.
  async _relevantHistory(question) {
    const all = this._loadHistory();
    if (!all.length) return [];
    let qEmb = null;
    try { const r = await this._embed([question]); qEmb = r && r[0]; } catch (e) {}
    if (!qEmb) return all.slice(-this.RECENT_KEEP * 2);   // fallback: solo recency
    const scored = all.map(e => ({ e, score: e.embedding ? this._cosine(qEmb, e.embedding) : -1 }));
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, this.RELEVANT_K).map(s => s.e);
    const recent = all.slice(-this.RECENT_KEEP);
    const seen = new Set(); const merged = [];
    recent.concat(topK).forEach(e => { if (!seen.has(e.id)) { seen.add(e.id); merged.push(e); } });
    merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return merged.slice(-this.CONTEXT_CAP);
  },
  // Calcola e salva (in background, mai bloccante) l'embedding di uno
  // scambio appena risposto, così diventa recuperabile per similarità nelle
  // domande future. Silenzioso su qualunque errore — è arricchimento, non
  // funzionalità critica.
  async _embedAndStore(id, question, answer) {
    try {
      const r = await this._embed([`${question}\n${answer}`]);
      const emb = r && r[0];
      if (!emb) return;
      const arr = this._loadHistory();
      const idx = arr.findIndex(e => e.id === id);
      if (idx === -1) return;
      arr[idx].embedding = emb;
      this._saveHistory(arr);
    } catch (e) {}
  },
  async clearHistory() {
    const ok = await U.confirm("Cancellare tutta la conversazione col coach? Non si può annullare.", { title: "Cancellare la conversazione?", danger: true, okText: "Sì, cancella" });
    if (!ok) return;
    try { localStorage.removeItem(this.HISTORY_KEY); } catch (e) {}
    this.renderAll();
  },

  // Momento della giornata: in sessione / post-allenamento (fatto oggi) /
  // pre-allenamento-giorno normale. Solo contesto per il coach, best-effort —
  // se Session.sessions non è ancora caricato, ripiega senza inventare nulla.
  _dayContext() {
    try {
      if (typeof Session !== "undefined" && Session.activeId && !Session.viewMode) return "in sessione";
      const today = (typeof U !== "undefined") ? U.today() : new Date().toISOString().slice(0, 10);
      const doneToday = ((typeof Session !== "undefined" && Session.sessions) || []).some(s => s.date === today && s.done);
      return doneToday ? "post-allenamento (fatto oggi)" : "pre-allenamento / giorno normale";
    } catch (e) { return ""; }
  },
  _fmtWhen(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const isToday = d.toDateString() === new Date().toDateString();
    return isToday ? time : `${d.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} ${time}`;
  },

  // Ridisegna sia la zona fissa in Home sia il modale (se aperto) dalla
  // STESSA memoria — così restano sempre in sincronia indipendentemente da
  // dove hai fatto l'ultima domanda.
  renderAll() {
    this._renderList("coach-list-home", this._loadHistory());
    if (document.getElementById("coach-overlay")) this._renderList("coach-list-modal", this._loadHistory().slice(-4));
  },
  _renderList(containerId, entries) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!entries.length) { el.innerHTML = '<div class="coach-empty">Ancora nessuna domanda — chiedimi qualcosa.</div>'; return; }
    el.innerHTML = entries.map(e => {
      const meta = [this._fmtWhen(e.ts), e.dayContext, e.exercise].filter(Boolean).map(m => this._esc(m)).join(" · ");
      const sources = (e.sources || []).map(s =>
        `<a class="coach-source" href="${this._esc(s.uri)}" target="_blank" rel="noopener">${this._esc(s.title)}</a>`).join("");
      return `<div class="coach-msg">
        <div class="coach-msg-meta">${meta}</div>
        <div class="coach-bubble coach-bubble-q">${this._esc(e.question)}</div>
        <div class="coach-bubble coach-bubble-a">${this._md(e.answer)}${sources ? `<div class="coach-sources"><i class="ti ti-link"></i>${sources}</div>` : ""}</div>
      </div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  },

  open() {
    const overlay = this._ensureOverlay();
    let exHint = "";
    try {
      if (typeof Session !== "undefined" && Session.activeId && !Session.viewMode) {
        const focused = document.querySelector("#exercises-container .ex-block.ex-focused");
        const exName = focused ? focused.dataset.ex : null;
        if (exName) exHint = `<div class="coach-ex-hint"><i class="ti ti-barbell"></i>Contesto: stai facendo <b>${this._esc(exName)}</b></div>`;
      }
    } catch (e) {}
    overlay.innerHTML = `
      <div class="coach-box" onclick="event.stopPropagation()">
        <button class="coach-close" onclick="Coach.close()"><i class="ti ti-x"></i></button>
        <div class="coach-title"><i class="ti ti-message-chatbot"></i>Chiedi al coach</div>
        ${exHint}
        <div class="coach-chat-list coach-chat-list-modal" id="coach-list-modal"></div>
        <textarea class="field-inp coach-ta" id="coach-q-modal" rows="2" placeholder="Es. ha senso allenare le gambe 3 volte a settimana?"></textarea>
        <div class="form-actions">
          <button class="btn-primary" id="coach-btn-modal" onclick="Coach.ask('modal')"><i class="ti ti-send"></i>Chiedi</button>
        </div>
      </div>`;
    overlay.style.display = "flex";
    this._renderList("coach-list-modal", this._loadHistory().slice(-4));
    setTimeout(() => { const ta = document.getElementById("coach-q-modal"); if (ta) ta.focus(); }, 60);
  },
  close() { const el = document.getElementById("coach-overlay"); if (el) el.style.display = "none"; },
  _ensureOverlay() {
    let el = document.getElementById("coach-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "coach-overlay";
      el.className = "coach-overlay";
      el.onclick = e => { if (e.target === el) this.close(); };
      document.body.appendChild(el);
    }
    return el;
  },

  // target: "home" | "modal" — due input separati (zona fissa + modale),
  // stessa memoria condivisa sotto.
  async ask(target) {
    target = target || "home";
    const ta = document.getElementById(`coach-q-${target}`);
    const question = (ta?.value || "").trim();
    if (!question) return;
    const btn = document.getElementById(`coach-btn-${target}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> Cerco...'; }

    let phase = "", diary = "", standingLimitations = "";
    try { if (typeof Body !== "undefined" && Body.checkins && Body.checkins.length) phase = Body.checkins[Body.checkins.length - 1].fase || ""; } catch (e) {}
    try { if (typeof Diary !== "undefined") diary = Diary.getJournal(); } catch (e) {}
    try { if (typeof Diary !== "undefined") standingLimitations = Diary.standingLimitationsText(); } catch (e) {}
    const inSession = !!(typeof Session !== "undefined" && Session.activeId && !Session.viewMode);
    let exercise = null;
    try {
      if (inSession) {
        const focused = document.querySelector("#exercises-container .ex-block.ex-focused");
        exercise = (focused && focused.dataset.ex) || null;
      }
    } catch (e) {}
    const dayContext = this._dayContext();

    const context = {};
    if (phase) context.phase = phase;
    if (diary) context.diary = diary;
    if (standingLimitations) context.standingLimitations = standingLimitations;
    if (typeof Session !== "undefined" && Session._sleepInfo) context.sleep = Session._sleepInfo;
    if (exercise) context.currentExercise = exercise;
    if (dayContext) context.dayContext = dayContext;
    // Programma attivo + sedute/esercizi: così il coach può incrociare i suoi
    // consigli con l'allenamento REALE dell'utente, non parlare in astratto.
    try {
      if (typeof App !== "undefined" && App.activeProgram) context.activeProgram = App.activeProgram;
      if (typeof CONFIG !== "undefined" && CONFIG.SCHEDE) {
        context.schedaExercises = Object.keys(CONFIG.SCHEDE).map(nome => ({
          nome,
          esercizi: (CONFIG.SCHEDE[nome].exercises || []).slice(0, 8).map(it => ({
            nome: U.exName(it), serie: U.exSets(it), rrMin: U.exRrMin(it), rrMax: U.exRrMax(it),
          })),
        }));
      }
    } catch (e) {}
    // Andamento recente dell'esercizio a fuoco (se in sessione): stessi dati
    // già caricati per il consiglio automatico, riusati qui senza nuove fetch.
    try {
      if (exercise && typeof Session !== "undefined" && Session._exStats && Session._exStats[exercise]) {
        context.exerciseTrend = Session._exStats[exercise].slice(-3).flatMap(g =>
          (g.sets || []).map(s => ({ date: g.date, kg: s.kg, reps: s.reps })));
      }
    } catch (e) {}

    // bolla "sto pensando" temporanea — MAI persistita, solo mentre si aspetta
    const listId = target === "home" ? "coach-list-home" : "coach-list-modal";
    const listEl = document.getElementById(listId);
    if (listEl) {
      listEl.insertAdjacentHTML("beforeend", `<div class="coach-msg" id="coach-thinking-${target}"><div class="coach-bubble coach-bubble-q">${this._esc(question)}</div><div class="coach-loading"><i class="ti ti-loader-2"></i> Ricerca in corso, qualche secondo...</div></div>`);
      listEl.scrollTop = listEl.scrollHeight;
    }

    try {
      // Memoria VERA per Gemini: scambi passati selezionati per RILEVANZA
      // semantica (embedding) + gli ultimi per continuità, come turni
      // multi-turno nativi (contents role user/model), non testo ripetuto.
      const relevant = await this._relevantHistory(question);
      const history = relevant.map(e => ({ question: e.question, answer: e.answer }));

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${CONFIG.AI_WORKER_URL}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: Object.keys(context).length ? context : undefined, history }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error("Il coach non ha risposto (errore " + res.status + ")");
      const data = await res.json();
      if (!data || !data.answer) throw new Error("Risposta vuota dal coach");
      const id = "c" + Date.now();
      this._pushHistory({ id, ts: Date.now(), question, answer: data.answer, sources: data.sources || [], inSession, phase: phase || null, exercise, dayContext });
      if (ta) ta.value = "";
      this.renderAll();
      this._embedAndStore(id, question, data.answer);   // background, non bloccante
    } catch (e) {
      const think = document.getElementById(`coach-thinking-${target}`);
      const msg = `<div class="coach-error"><i class="ti ti-alert-triangle"></i> ${this._esc(e.message || "Errore di rete")}. Riprova.</div>`;
      if (think) think.outerHTML = `<div class="coach-msg">${msg}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i>Chiedi'; }
    }
  },
};
