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
      if (typeof Recovery !== "undefined") Recovery.renderCard(sleepData, checkins, sessions);
      if (typeof JointLog !== "undefined") JointLog.renderCard();
      if (typeof PatternBalance !== "undefined") PatternBalance.renderCard();
      this.buildRecentSessions(sessions);
      API.getTodayTasks().then(tasks => this.buildChecklist(tasks)).catch(() => {
        const host = document.getElementById("planner-list");
        if (host) host.textContent = "Planner non disponibile: riprova dalla Home.";
      });
      this.buildSemaforo(sleepData);
      try { DailyRecap.render({ sessions, checkins, sleep: sleepData, habits, todayHabit }); } catch (e) { console.error("DailyRecap:", e); }
      try { Coach.renderAll(); } catch (e) { console.error("Coach.renderAll:", e); }
      // Riepilogo settimanale: silenzioso se non ci sono le condizioni (>=7gg
      // dall'ultimo report + >=1 seduta nella settimana appena chiusa), non
      // blocca il resto della dashboard se fallisce (rete, worker AI down).
      try { WeeklyReport.checkAndGenerate(); } catch (e) { console.error("WeeklyReport:", e); }
      // Coach predittivo di fine mesociclo: stesso principio, silenzioso e
      // non bloccante — gira al più una volta ogni ~4 settimane (vedi RUN_EVERY_DAYS).
      try { PredictiveCoach.checkAndGenerate(); } catch (e) { console.error("PredictiveCoach:", e); }
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
          <div class="rs-name">${U.escape(s.name)}</div>
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

  _esc(s) { return U.escape(s); },
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
      html += `<button class="recent-sess-item clickable arch-item" onclick="Dashboard.openArchived(${U.arg(s.id)})">
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
    // Settimana da LUNEDÌ, allineata a Volume._weekStart/buildStats (prima era
    // domenica-based: la domenica stessa restava fuori dal range mostrato,
    // che diventava per intero giorni futuri della settimana successiva).
    const startW = new Date(today);
    startW.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 1);
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
        <span class="split-status">${sess ? (sess.done ? "✓ " : "") + U.escape(sess.name.split(" ")[0]) : "—"}</span>
      `;
      wrap.appendChild(col);
    }
  },

  buildChecklist(tasks) {
    const list  = document.getElementById("planner-list");
    const doneN = document.getElementById("planner-done");
    const totN  = document.getElementById("planner-total");
    const bar   = document.getElementById("planner-bar");
    if (!list) return;
    doneN.textContent = tasks.filter(t => t.done).length;
    totN.textContent = tasks.length;
    bar.style.width = tasks.length ? Math.round(tasks.filter(t => t.done).length / tasks.length * 100) + "%" : "0%";
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
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("aria-pressed", String(t.done));
      item.className = "check-item" + (t.done ? " checked" : "");
      item.innerHTML = `
        <div class="chk${t.done ? " done" : ""}"><i class="ti ti-check" style="font-size:11px;${t.done ? "" : "display:none"}"></i></div>
        <span class="chk-text">${U.escape(t.name)}</span>
        ${t.type ? `<span class="chk-tag">${U.escape(t.type)}</span>` : ""}
      `;
      item.onclick = async () => {
        const wasDone = t.done;
        item.disabled = true;
        t.done = !t.done;
        item.classList.toggle("checked", t.done);
        const chk = item.querySelector(".chk");
        chk.classList.toggle("done", t.done);
        chk.querySelector("i").style.display = t.done ? "" : "none";
        doneCount = tasks.filter(x => x.done).length;
        doneN.textContent = doneCount;
        bar.style.width   = Math.round(doneCount / tasks.length * 100) + "%";
        try { await API.completeTask(t.id, t.done); }
        catch (_) { t.done = wasDone; U.toast("Task non salvato: riprova", "err"); }
        this.buildChecklist(tasks);
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

// ═══════════════════════════════════════════════════════════════════════════
//  GymOS — Riepilogo settimanale
//  Generato all'apertura app, quando la settimana LUN-DOM appena chiusa ha
//  almeno una seduta fatta e non è già stata coperta da un report precedente.
//  Storage: localStorage (non un nuovo DB Notion — volume basso, 1 oggetto a
//  settimana, e non richiede setup manuale su Notion). Cap a 26 (mezzo anno).
// ═══════════════════════════════════════════════════════════════════════════
