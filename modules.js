// ═══════════════════════════════════════════════
//  GymOS — progression.js
// ═══════════════════════════════════════════════
const Progression = {
  activeScheda: Object.keys(CONFIG.SCHEDE)[0],
  activeEx:     null,
  history:      [],
  chart:        null,

  async load() {
    this.activeEx = CONFIG.SCHEDE[this.activeScheda].exercises[0];
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
        this.activeEx = CONFIG.SCHEDE[name].exercises[0];
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
    scheda.exercises.forEach(exName => {
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
      const [sessions, checkins, tasks, sleepData] = await Promise.all([
        API.getWorkoutSessions(14).catch(() => []),
        API.getBodyMetrics(5).catch(() => []),
        API.getTodayTasks().catch(() => []),
        API.getRecentSleep(7).catch(() => []),
      ]);

      this.buildStats(sessions, checkins, sleepData);
      this.buildWeekSplit(sessions);
      this.buildChecklist(tasks);
      this.buildPRs(sessions);
      this.buildSemaforo(sleepData);
    } catch(e) { console.error("Dashboard.load:", e); }
  },

  buildStats(sessions, checkins, sleepData) {
    const thisWeek = sessions.filter(s => {
      if (!s.date) return false;
      const d = new Date(s.date);
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      return d >= startOfWeek;
    });

    document.getElementById("d-sessions").textContent = thisWeek.filter(s => s.done).length + "/" + thisWeek.length;
    document.getElementById("d-sessions-sub").textContent = "completate questa settimana";

    const last = checkins[checkins.length - 1];
    if (last) {
      document.getElementById("d-peso").textContent = U.fmt(last.peso) + " kg";
      if (checkins.length > 1) {
        const d = Math.round((last.peso - checkins[checkins.length - 2].peso) * 10) / 10;
        document.getElementById("d-peso-sub").textContent = (d > 0 ? "+" : "") + U.fmt(d) + " kg vs check-in prec.";
      }
    }

    if (sleepData.length) {
      const avg = sleepData.reduce((a, s) => a + (s.ore || 0), 0) / sleepData.length;
      document.getElementById("d-sleep").textContent = avg.toFixed(1) + "h";
    }

    document.getElementById("d-habit").textContent = "—";
  },

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

  buildPRs(sessions) {
    const wrap = document.getElementById("recent-prs");
    wrap.innerHTML = '<div class="empty-state">Carica i PR dalla sezione Progressioni</div>';
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
    if (!tipo && !durata) { alert("Inserisci almeno tipo o durata"); return; }
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
      alert("Errore nel salvataggio del cardio.");
    }
  },
};
