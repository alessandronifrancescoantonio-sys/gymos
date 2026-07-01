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
      this.buildChart();
      this.buildTable();
    } catch(e) { console.error("Progression.loadHistory:", e); }
  },

  buildChart() {
    const h = this.history;
    if (!h.length) return;
    const color   = CONFIG.SCHEDE[this.activeScheda].color;
    const labels  = h.map(s => U.fmtDate(s.date));
    const data    = h.map(s => s.kg || s.reps);
    const isBW    = h.every(s => !s.kg);
    const minD    = Math.min(...data), maxD = Math.max(...data);
    const pad     = (maxD - minD) * 0.3 || 3;
    const maxPrev = i => i === 0 ? -Infinity : Math.max(...h.slice(0, i).map(s => s.kg || 0));

    const ptColors = h.map((s, i) => (i > 0 && s.kg > maxPrev(i)) ? "#F59E0B" : color);
    const ptRadius = h.map((s, i) => (i > 0 && s.kg > maxPrev(i)) ? 8 : 5);
    const ttEl = document.getElementById("prog-tt");

    if (this.chart) this.chart.destroy();
    const ctx = document.getElementById("prog-chart").getContext("2d");
    const opts = U.baseChartOptions(ttEl, idx => {
      const s = h[idx];
      const isPR = idx > 0 && s.kg > maxPrev(idx);
      const prTag = isPR ? '<span class="tt-pr">PR</span>' : "";
      const noteHTML = s.note ? `<div class="tt-note">${s.note}</div>` : "";
      return `
        <div class="tt-date">Wk ${U.weekNum(s.date)} — ${U.fmtDate(s.date)}</div>
        <div class="tt-main" style="color:${color}">${isBW ? s.reps + " rep" : U.fmt(s.kg) + " kg"}${prTag}</div>
        <div class="tt-sub">${s.sets}×${s.reps} rep · vol ${U.fmtV(U.vol(s.sets, s.reps, s.kg))}</div>
        ${noteHTML}
      `;
    }, ".card");

    opts.scales.y.min = Math.max(0, minD - pad);
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => U.fmt(v) + (isBW ? " r" : " kg");

    this.chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: color, backgroundColor: "transparent",
        borderWidth: 2.5, pointRadius: ptRadius, pointBackgroundColor: ptColors,
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 9, tension: .35 }] },
      options: opts,
    });
  },

  buildTable() {
    const h = this.history;
    const tbody = document.getElementById("prog-tbody");
    tbody.innerHTML = "";
    const maxPrev = i => i === 0 ? -Infinity : Math.max(...h.slice(0, i).map(s => s.kg || 0));

    h.forEach((s, i) => {
      const v     = U.vol(s.sets, s.reps, s.kg);
      const prevV = i > 0 ? U.vol(h[i-1].sets, h[i-1].reps, h[i-1].kg) : null;
      const dv    = prevV !== null ? v - prevV : null;
      const isPR  = i > 0 && s.kg > maxPrev(i);
      const prTag = isPR ? '<span class="pr-tag">PR</span>' : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${U.fmtDate(s.date)}</td>
        <td><span class="week-badge">Wk ${U.weekNum(s.date)}</span></td>
        <td class="mono">${s.sets}×${s.reps}</td>
        <td class="mono">${s.kg ? U.fmt(s.kg) + " kg" : "BW"}${prTag}</td>
        <td class="mono">${s.kg ? U.fmtV(v) : "—"}</td>
        <td>${U.deltaHTML(dv)}</td>
        <td class="note-text">${s.note || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
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
      const sess = sessions.find(s => s.date === iso);

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
    if (!this._expanded) this._expanded = new Set([App.activeProgram]);

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
