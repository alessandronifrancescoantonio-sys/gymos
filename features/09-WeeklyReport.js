const WeeklyReport = {
  KEY: "gymos_weekly_reports",
  LAST_COVERED_KEY: "gymos_weekly_report_last_covered",
  CAP: 26,

  _esc(s) { return U.escape(s); },
  _iso(d) { const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
  // Lunedì (00:00 locale) della settimana di `d` — stesso schema di
  // Volume._weekStart / DailyRecap._weekDone: settimana fissa LUN-DOM, non rolling.
  _mondayOf(d) {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  },
  _inRange(dateStr, from, to) {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    return t >= from.getTime() && t < to.getTime();
  },

  // ─── STORAGE ───
  _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); } catch (e) { return []; } },
  _saveAll(list) { try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch (e) {} },
  save(report) {
    // Dedupe difensivo per weekStart: la guardia _checking in checkAndGenerate
    // previene il caso comune, ma senza questo un report duplicato residuo
    // (già scritto prima del fix, o da un altro percorso) resterebbe per
    // sempre nello storico.
    const list = this._load().filter(r => r.weekStart !== report.weekStart);
    list.push(report);
    list.sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
    // Cap: droppa i più vecchi, non gli ultimi generati.
    while (list.length > this.CAP) list.shift();
    this._saveAll(list);
    return report;
  },
  dismiss(weekStart) {
    const list = this._load();
    const r = list.find(x => x.weekStart === weekStart);
    if (r) { r.dismissed = true; this._saveAll(list); }
    const banner = document.getElementById("weekly-report-banner");
    if (banner) banner.remove();
  },

  // ─── TRIGGER ───
  // Chiamato da Dashboard.load(): silenzioso se le condizioni non scattano
  // (nessun banner, nessuna chiamata rete).
  async checkAndGenerate() {
    // Guardia anti-doppio-avvio: LAST_COVERED_KEY viene scritto solo a fine
    // funzione, DOPO vari await (query sessioni, aggregazioni, chiamata
    // coach) — un secondo Dashboard.load() partito mentre il primo è ancora
    // in volo (es. doppio tap sul tab Home durante il boot) superava lo
    // stesso controllo e produceva due report duplicati per la stessa
    // settimana. Flag sincrono, valido prima di qualunque await.
    if (this._checking) return;
    this._checking = true;
    try {
      const now = new Date();
      const thisMonday = this._mondayOf(now);
      const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
      const lastSundayEnd = new Date(thisMonday);   // esclusivo: fine della settimana scorsa = inizio di questa
      const weekStartStr = this._iso(lastMonday);

      // Dedupe: già coperta questa settimana → al più ri-mostra il banner se
      // non è stato chiuso (utente riapre l'app più volte nello stesso giorno).
      if (localStorage.getItem(this.LAST_COVERED_KEY) === weekStartStr) {
        const list = this._load();
        const existing = list.find(r => r.weekStart === weekStartStr);
        if (existing && !existing.dismissed) this.renderBanner(existing);
        return;
      }

      // Storico ampio (~4 mesi a 4 sedute/sett.) per streak, volume prec./mese
      // scorso e rilevamento PR — un'unica query, riusata per tutto il calcolo.
      const sessions = await API.getWorkoutSessions(90).catch(() => []);
      const doneLastWeek = sessions.filter(s => s.done && this._inRange(s.date, lastMonday, lastSundayEnd));
      if (!doneLastWeek.length) return;   // nessuna seduta nella finestra: niente banner, niente rete

      const report = await this._build(sessions, lastMonday, lastSundayEnd, weekStartStr);
      this.save(report);
      localStorage.setItem(this.LAST_COVERED_KEY, weekStartStr);
      this.renderBanner(report);
    } catch (e) { console.error("WeeklyReport.checkAndGenerate:", e); }
    finally { this._checking = false; }
  },

  // ─── CALCOLO AGGREGATI (punti 1-8, client-side) ───
  async _build(allSessions, weekMonday, weekEnd, weekStartStr) {
    const prevMonday = new Date(weekMonday); prevMonday.setDate(prevMonday.getDate() - 7);
    const monthAgoStart = new Date(weekMonday); monthAgoStart.setDate(monthAgoStart.getDate() - 28);
    const monthBeforeStart = new Date(weekMonday); monthBeforeStart.setDate(monthBeforeStart.getDate() - 56);

    const weekSessions   = allSessions.filter(s => s.done && this._inRange(s.date, weekMonday, weekEnd));
    const prevSessions   = allSessions.filter(s => s.done && this._inRange(s.date, prevMonday, weekMonday));
    const monthSessions  = allSessions.filter(s => s.done && this._inRange(s.date, monthAgoStart, weekEnd));
    const prevMonthSess  = allSessions.filter(s => s.done && this._inRange(s.date, monthBeforeStart, monthAgoStart));

    const [weekAgg, prevAgg, monthAgg, prevMonthAgg] = await Promise.all([
      this._aggregate(weekSessions), this._aggregate(prevSessions),
      this._aggregate(monthSessions), this._aggregate(prevMonthSess),
    ]);

    // 1 — sessioni fatte vs pianificate
    const sessionsPlanned = Object.keys(CONFIG.SCHEDE || {}).length || weekSessions.length;
    const sessionsDone = weekSessions.length;

    // 2 — volume per muscolo + trend vs settimana precedente
    const volumeTrend = Volume.MUSCLES.filter(m => (weekAgg.vol[m] || 0) > 0 || (prevAgg.vol[m] || 0) > 0).map(m => {
      const sets = Math.round((weekAgg.vol[m] || 0) * 10) / 10;
      const prevSets = prevAgg.vol[m] || 0;
      const deltaPct = prevSets > 0 ? Math.round(((sets - prevSets) / prevSets) * 100) : null;
      return { muscle: m, sets, prevSets: Math.round(prevSets * 10) / 10, deltaPct };
    }).sort((a, b) => b.sets - a.sets);

    // 3 — PR nuovi questa settimana (stessa logica di Progression.groupSessions/isPR)
    const prs = await this._detectPRs(weekAgg.exNames, weekMonday, weekEnd);

    // 4 — dolore ricorrente (2+ sedute con dolore moderato/alto sullo stesso esercizio)
    const recurringPain = Object.keys(weekAgg.painCount).filter(ex => weekAgg.painCount[ex] >= 2);

    // 5 — peso corporeo: trend ultimi check-in
    const checkins = await API.getBodyMetrics(20).catch(() => []);
    const weightTrend = this._weightTrend(checkins, weekMonday, weekEnd);

    // 6 — confronto vs mese scorso (stessi indicatori, finestra più ampia)
    const monthComparison = {
      sessionsThisMonth: monthSessions.length,
      sessionsPrevMonth: prevMonthSess.length,
      sessionsDelta: monthSessions.length - prevMonthSess.length,
      volumeDeltaPct: this._totalVolDeltaPct(monthAgg.vol, prevMonthAgg.vol),
    };

    // 7 — suggerimento prossima settimana: scarico solo con segnali CONVERGENTI
    // (stesso principio già usato in DailyRecap/session.js — mai da un singolo dato isolato).
    const volumeDownOverall = this._totalVolDeltaPct(weekAgg.vol, prevAgg.vol);
    const signals = [
      recurringPain.length > 0,
      sessionsDone < sessionsPlanned * 0.6,
      volumeDownOverall != null && volumeDownOverall <= -20,
    ].filter(Boolean).length;
    const deloadSuggested = signals >= 2;

    // 8 — streak: settimane consecutive (da questa a ritroso) con >=1 seduta fatta
    const streakWeeks = this._streak(allSessions, weekMonday);

    const report = {
      weekStart: weekStartStr,
      weekEnd: this._iso(new Date(weekEnd.getTime() - 86400000)),
      generatedAt: new Date().toISOString(),
      dismissed: false,
      data: {
        sessionsDone, sessionsPlanned,
        volumeTrend, prs, recurringPain,
        weightTrend, monthComparison,
        deloadSuggested, streakWeeks,
        coachText: null,   // punto 9, riempito sotto se il worker risponde
      },
    };

    // 9 — consiglio coach (Gemini). Se fallisce: banner comunque con 1-8, si
    // omette solo il testo (vincolo esplicito: un servizio esterno che fallisce
    // non deve bloccare la feature core).
    try { report.data.coachText = await this._askCoach(report.data); } catch (e) { /* omesso, non bloccante */ }

    return report;
  },

  // Aggrega volume/muscolo (serie DIRETTE, stesso schema di Volume.loadActual),
  // nomi esercizio unici e conteggio dolore per esercizio, su un set di sessioni.
  async _aggregate(sessionList) {
    const vol = {}; Volume.MUSCLES.forEach(m => vol[m] = 0);
    const exNames = new Set();
    const painSessions = {};   // nome esercizio -> Set di session id con dolore (dedup: più serie dolenti nella STESSA seduta contano 1 volta)
    for (const s of sessionList) {
      try {
        const ex = await API.getSessionExercises(s.id);
        ex.forEach(row => {
          if ((row.reps || 0) <= 0) return;
          const name = U.exBase(row.name);
          exNames.add(name);
          const m = Volume.musclesFor(name);
          Object.keys(m).forEach(mus => { vol[mus] = (vol[mus] || 0) + m[mus]; });
          // Dolore: SOLO nota della serie/esercizio, non la nota di sessione
          // (generica, condivisa da tutti gli esercizi della seduta) — usarla
          // qui marcherebbe come "dolore ricorrente" ogni esercizio della
          // sessione per una nota che magari riguardava un solo esercizio.
          // Riusa Session.painLevel (session.js) invece di reinventare la scala 0-3.
          const txt = String(row.note || "").toLowerCase();
          const lvl = (typeof Session !== "undefined") ? Session.painLevel(txt) : 0;
          if (lvl >= 2) {
            if (!painSessions[name]) painSessions[name] = new Set();
            painSessions[name].add(s.id);   // dedup per seduta: N serie dolenti nella stessa sessione = 1 sola occorrenza "ricorrente"
          }
        });
      } catch (e) { /* sessione singola non leggibile: ignora, non bloccare il resto */ }
    }
    const painCount = {};
    Object.keys(painSessions).forEach(name => { painCount[name] = painSessions[name].size; });
    return { vol, exNames: Array.from(exNames), painCount };
  },

  // PR = stessa identica logica di Progression (_computeSessions/isPR), solo
  // applicata a un sottoinsieme di esercizi (quelli fatti nella settimana
  // coperta) invece che a quello selezionato nella pagina Progressioni.
  async _detectPRs(exNames, weekMonday, weekEnd) {
    const out = [];
    for (const name of (exNames || [])) {
      try {
        const history = await API.getExerciseHistory(name);
        const sessions = Progression._computeSessions(history);
        const inWeek = sessions.filter(g => this._inRange(g.date, weekMonday, weekEnd));
        if (inWeek.some(g => g.isPR)) out.push({ exercise: name });
      } catch (e) { /* esercizio singolo non leggibile: ignora */ }
    }
    return out;
  },

  _totalVolDeltaPct(volA, volB) {
    const totA = Object.values(volA || {}).reduce((a, b) => a + b, 0);
    const totB = Object.values(volB || {}).reduce((a, b) => a + b, 0);
    if (totB <= 0) return null;
    return Math.round(((totA - totB) / totB) * 100);
  },

  // Media peso nella settimana coperta vs media della settimana precedente
  // (con dati disponibili) — variazione onesta, non serve un solo check-in.
  _weightTrend(checkins, weekMonday, weekEnd) {
    const w = (checkins || []).filter(c => c.peso != null && c.peso > 0);
    if (!w.length) return null;
    const inWeek = w.filter(c => this._inRange(c.date, weekMonday, weekEnd));
    const before = w.filter(c => new Date(c.date) < weekMonday);
    const last = inWeek.length ? inWeek[inWeek.length - 1] : w[w.length - 1];
    const avg = arr => arr.reduce((a, c) => a + c.peso, 0) / arr.length;
    const refAvg = before.length ? avg(before.slice(-3)) : null;
    const deltaKg = refAvg != null ? Math.round((last.peso - refAvg) * 10) / 10 : null;
    return { last: last.peso, deltaKg, checkins: inWeek.length };
  },

  // Settimane consecutive (a ritroso da `weekMonday`) con almeno una seduta fatta.
  _streak(allSessions, weekMonday) {
    let n = 0;
    let cursor = new Date(weekMonday);
    for (let i = 0; i < 104; i++) {   // cap di sicurezza: 2 anni
      const from = new Date(cursor), to = new Date(cursor); to.setDate(to.getDate() + 7);
      const hasSession = allSessions.some(s => s.done && this._inRange(s.date, from, to));
      if (!hasSession) break;
      n++;
      cursor.setDate(cursor.getDate() - 7);
    }
    return n;
  },

  // ─── PUNTO 9 — consiglio coach via worker AI (stesso pattern di /advice) ───
  async _askCoach(data) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await AIClient.fetch(`${CONFIG.AI_WORKER_URL}/weekly-report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionsDone: data.sessionsDone, sessionsPlanned: data.sessionsPlanned,
          streakWeeks: data.streakWeeks, volumeTrend: data.volumeTrend,
          prs: data.prs, recurringPain: data.recurringPain,
          weightTrend: data.weightTrend, monthComparison: data.monthComparison,
          deloadSuggested: data.deloadSuggested,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const j = await res.json();
      return (j && j.text) ? j.text : null;
    } finally { clearTimeout(timer); }
  },

  // ─── UI: BANNER ───
  renderBanner(report) {
    const host = document.getElementById("weekly-report-host");
    if (!host || report.dismissed) return;
    const old = document.getElementById("weekly-report-banner");
    if (old) old.remove();
    const el = document.createElement("div");
    el.id = "weekly-report-banner";
    el.className = "wr-banner";
    el.innerHTML = this._summaryHTML(report, true);
    host.prepend(el);
  },

  _fmtDate(d) { try { return new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "short" }); } catch (e) { return d || "—"; } },

  // Contenuto compatto punti 1-9, usato sia dal banner che dallo storico.
  _summaryHTML(report, withClose) {
    const d = report.data;
    const closeBtn = withClose
      ? `<button class="wr-close" onclick="WeeklyReport.dismiss(${U.arg(report.weekStart)})" title="Chiudi"><i class="ti ti-x"></i></button>`
      : "";
    const volRows = (d.volumeTrend || []).slice(0, 6).map(v => `
      <div class="wr-vol-row">
        <span class="wr-vol-name">${this._esc(v.muscle)}</span>
        <span class="wr-vol-val">${U.fmt(v.sets)} serie${v.deltaPct != null ? ` <span class="${v.deltaPct >= 0 ? 'wr-up' : 'wr-dn'}">${v.deltaPct > 0 ? "+" : ""}${v.deltaPct}%</span>` : ""}</span>
      </div>`).join("");
    const prsTxt = (d.prs || []).length ? d.prs.map(p => this._esc(p.exercise)).join(", ") : "Nessuno questa settimana";
    const painTxt = (d.recurringPain || []).length ? `<div class="wr-item wr-pain"><i class="ti ti-alert-triangle"></i>Dolore ricorrente su: ${(d.recurringPain || []).map(this._esc).join(", ")}</div>` : "";
    const weightTxt = d.weightTrend ? `${U.fmt(d.weightTrend.last)} kg${d.weightTrend.deltaKg != null ? ` (${d.weightTrend.deltaKg > 0 ? "+" : ""}${U.fmt(d.weightTrend.deltaKg)} kg vs prima)` : ""}` : "—";
    const mc = d.monthComparison || {};
    const monthTxt = `${mc.sessionsThisMonth ?? "—"} sedute nell'ultimo mese (${mc.sessionsDelta > 0 ? "+" : ""}${mc.sessionsDelta ?? 0} vs mese prec.)${mc.volumeDeltaPct != null ? `, volume ${mc.volumeDeltaPct > 0 ? "+" : ""}${mc.volumeDeltaPct}%` : ""}`;
    return `
      <div class="wr-head">
        <div class="wr-title"><i class="ti ti-report"></i>Riepilogo settimana ${this._fmtDate(report.weekStart)} – ${this._fmtDate(report.weekEnd)}</div>
        ${closeBtn}
      </div>
      <div class="wr-strip">
        <div class="wr-chip"><span class="wr-cv">${d.sessionsDone}/${d.sessionsPlanned}</span><span class="wr-cl">Sedute</span></div>
        <div class="wr-chip"><span class="wr-cv">${d.streakWeeks}</span><span class="wr-cl">Streak sett.</span></div>
        <div class="wr-chip"><span class="wr-cv">${(d.prs || []).length}</span><span class="wr-cl">Record</span></div>
      </div>
      <div class="wr-section"><div class="wr-sub">Volume per muscolo</div>${volRows || '<div class="wr-item">Nessun dato di volume questa settimana.</div>'}</div>
      <div class="wr-section"><div class="wr-sub">Record nuovi</div><div class="wr-item">${prsTxt}</div></div>
      ${painTxt}
      <div class="wr-section"><div class="wr-sub">Peso corporeo</div><div class="wr-item">${weightTxt}</div></div>
      <div class="wr-section"><div class="wr-sub">Vs mese scorso</div><div class="wr-item">${monthTxt}</div></div>
      ${d.deloadSuggested ? `<div class="wr-item wr-deload"><i class="ti ti-refresh"></i>Più segnali insieme suggeriscono una settimana più leggera: valuta di scaricare un po' il carico.</div>` : ""}
      ${d.coachText ? `<div class="wr-coach"><i class="ti ti-message-chatbot"></i><span>${this._esc(d.coachText)}</span></div>` : ""}
    `;
  },

  // ─── UI: STORICO ───
  async loadHistory() {
    const wrap = document.getElementById("wr-history-list");
    if (!wrap) return;
    const list = this._load().slice().sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    if (!list.length) { wrap.innerHTML = `<div class="wr-empty"><i class="ti ti-report"></i>Nessun riepilogo ancora — torna qui dopo la prossima settimana di allenamento.</div>`; return; }
    wrap.innerHTML = list.map(r => `
      <details class="wr-hist-item">
        <summary>
          <span class="wr-hist-range">${this._fmtDate(r.weekStart)} – ${this._fmtDate(r.weekEnd)}</span>
          <span class="wr-hist-mini">${r.data.sessionsDone}/${r.data.sessionsPlanned} sedute · ${(r.data.prs || []).length} record</span>
        </summary>
        <div class="wr-hist-body">${this._summaryHTML(r, false)}</div>
      </details>
    `).join("");
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Aggiornamenti scientifici (motore mensile lato worker)
//  Stesso stile/pattern di WeeklyReport: la sezione mostra le proposte
//  generate dalla pipeline a 5 stadi sul worker (ricerca → filtro →
//  confronto → verifica avversariale → assemblaggio), l'utente decide se
//  approvare (entra nel prompt del coach) o rifiutare ogni proposta.
// ═══════════════════════════════════════════════
