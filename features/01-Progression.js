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

  _esc(s) { return U.escape(s); },

  // Raggruppa le righe (una per serie) in SESSIONI, con tutte le serie ordinate,
  // scartando quelle vuote (rep 0). Calcola top set, volume e record (PR).
  groupSessions() {
    return Progression._computeSessions(this.history);
  },

  // Estratto da groupSessions per riuso fuori dalla pagina Progressioni (es.
  // riepilogo settimanale, che deve rilevare gli stessi PR con la STESSA
  // logica, non una riscritta ad-hoc — vedi WeeklyReport._detectPRs).
  _computeSessions(history) {
    // Epley — tenuta solo per topKg/topReps (mostrati nella tooltip come "top
    // set" e usati da "I tuoi record"), NON per la linea del grafico: la
    // progressione della SEDUTA è il lavoro totale fatto (tutte le serie),
    // non una stima del massimale su un singolo set (l'utente ha chiarito:
    // più peso e più rep nella totalità delle 3 serie = progresso, anche a
    // parità di set di punta — l'1RM stimato da solo lo nascondeva).
    const e1 = (kg, reps) => (kg > 0 && reps > 0) ? kg * (1 + reps / 30) : reps;
    const groups = {};
    (history || []).forEach(r => {
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
    // hasPrior: c'è già stato un punto REALE (non-null) prima di questo. Senza
    // questo flag, la prima seduta pesata dopo un buco corpo-libero (i>0 ma
    // `running` mai aggiornato) risultava un falso "Record" — non stava
    // battendo nulla, era solo il primo dato confrontabile.
    let running = 0, hasPrior = false;
    out.forEach(g => {
      if (g.progVal == null) { g.isPR = false; return; }
      g.isPR = hasPrior && g.progVal > running && g.progVal > 0;
      running = Math.max(running, g.progVal);
      hasPrior = true;
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
