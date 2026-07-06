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
      g.topKg   = g.series.length ? Math.max(...g.series.map(s => s.kg)) : 0;
      g.topReps = g.series.length ? Math.max(...g.series.map(s => s.reps)) : 0;
      g.volume  = g.series.reduce((t, s) => t + s.reps * (s.kg || 0), 0);
      g.repsTot = g.series.reduce((t, s) => t + s.reps, 0);
      return g;
    }).filter(g => g.series.length)
      .sort((a, b) => new Date(a.date) - new Date(b.date));   // dal più vecchio al più recente
    // Record: il top set supera il massimo di TUTTE le sessioni precedenti
    let running = 0;
    out.forEach((g, i) => { g.isPR = i > 0 && g.topKg > running && g.topKg > 0; running = Math.max(running, g.topKg); });
    return out;
  },

  buildChart() {
    const s = this.sessions || [];
    const canvas = document.getElementById("prog-chart");
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    if (!s.length || !canvas) return;
    const color = CONFIG.SCHEDE[this.activeScheda].color;
    const isBW  = s.every(g => g.topKg === 0);
    const labels = s.map(g => U.fmtDate(g.date));
    const data   = s.map(g => isBW ? g.topReps : g.topKg);
    const minD = Math.min(...data), maxD = Math.max(...data);
    const pad  = (maxD - minD) * 0.3 || 3;
    const ptColors = s.map(g => g.isPR ? "#F59E0B" : color);
    const ptRadius = s.map(g => g.isPR ? 8 : 5);
    const ttEl = document.getElementById("prog-tt");
    const opts = U.baseChartOptions(ttEl, idx => {
      const g = s[idx];
      const prTag = g.isPR ? '<span class="tt-pr">Record</span>' : "";
      const setsStr = g.series.map(x => isBW ? x.reps + "r" : U.fmt(x.kg) + "×" + x.reps).join("  ");
      return `
        <div class="tt-date">Sett. ${U.weekNum(g.date)} — ${U.fmtDate(g.date)}</div>
        <div class="tt-main" style="color:${color}">${isBW ? g.topReps + " rep" : U.fmt(g.topKg) + " kg"}${prTag}</div>
        <div class="tt-sub">${g.series.length} serie · ${setsStr}</div>
      `;
    }, ".card");
    opts.scales.y.min = Math.max(0, minD - pad);
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => U.fmt(v) + (isBW ? " r" : " kg");
    this.chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: "transparent",
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
    this.buildPesoChart();
    this.buildMisureGrid();
    this.buildMisuraChart();
    this.buildFaseRow();
    this.buildHistTable();
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
    if (t(/shoulder press|overhead press|military|lento avanti|arnold|spalle/)) return { Spalle: 1, Tricipiti: 0.5 };
    if (t(/row|pulley|rematore|low row|lat mach|pulldown|trazion|pull ?up|upper back|dorso/)) return { Dorso: 1, Bicipiti: 0.5 };
    // Croci/fly: il gomito non si estende → niente tricipiti
    if (t(/croci|fly|pec deck/)) return { Petto: 1, Spalle: 0.5 };
    if (t(/pec|chest|panca|bench|dist |piegament|push ?up|press/)) return { Petto: 1, Spalle: 0.5, Tricipiti: 0.5 };
    return {};   // sconosciuto → l'utente assegna a mano
  },

  _overrides: null,
  loadOverrides() {
    if (!this._overrides) {
      try { this._overrides = JSON.parse(localStorage.getItem("gymos_muscle_map") || "{}"); }
      catch(e) { this._overrides = {}; }
    }
    return this._overrides;
  },
  saveOverrides() { try { localStorage.setItem("gymos_muscle_map", JSON.stringify(this._overrides || {})); } catch(e){} },
  musclesFor(name) {
    const ov = this.loadOverrides()[name];
    if (ov) { const m = { [ov.p]: 1 }; (ov.s || []).forEach(x => { if (x !== ov.p) m[x] = 0.5; }); return m; }
    return this.classify(name);
  },
  setPrimary(name, muscle) {
    const ov = this.loadOverrides();
    if (!muscle || muscle === "—") { delete ov[name]; }   // torna all'automatico
    else {
      const auto = this.classify(name);
      const sec = Object.keys(auto).filter(m => auto[m] < 1 && m !== muscle);
      ov[name] = { p: muscle, s: sec };
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
          const name = (row.name || "").split(" – ")[0];
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

  openEditor() { document.getElementById("vol-modal").style.display = "flex"; this.renderEditor(); },
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
      const isOpen = this._openSeds && this._openSeds.has(nome);
      return `
        <div class="vol-sed${isOpen ? " open" : ""}" data-sed="${String(nome).replace(/"/g, "&quot;")}">
          <button class="vol-sed-hd" onclick="Volume.toggleSed(this)" style="border-left:3px solid ${sc.color || "var(--accent)"}">
            <span class="vol-sed-name">${this._esc(nome)}</span>
            <span class="vol-sed-count">${exs.length} eserc.${toFix ? ` · <span class="vz-low">${toFix} da assegnare</span>` : ""}</span>
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
      <div class="vol-hint">Apri una seduta del programma e correggi il muscolo dove l'automatico sbaglia. Primario = 1 serie, secondari = ½.</div>
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
    const isAuto = !this.loadOverrides()[ex];
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
        API.getBodyMetrics(5).catch(() => []),
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
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
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
        const d = Math.round((last.peso - checkins[checkins.length - 2].peso) * 10) / 10;
        document.getElementById("d-peso-sub").textContent = (d > 0 ? "+" : "") + U.fmt(d) + " kg vs prec.";
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
      const iso  = day.toISOString().split("T")[0];
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
      date: new Date().toISOString().split("T")[0],
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

  async load() {
    document.getElementById("diary-date").textContent =
      new Date().toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" });
    this.qualita = null; this.energia = null; this.umore = null;
    this.buildRatings();
    this.buildEnergia();
    this.buildHabitChecks();
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
