const PredictiveCoach = {
  LAST_RUN_KEY: "gymos_predictive_last_run",
  RUN_EVERY_DAYS: 28,
  proposals: [],
  errorMsg: null,
  busy: false,

  _esc(s) { return U.escape(s); },

  async _fetchWithTimeout(url, opts, ms = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await AIClient.fetch(url, { ...(opts || {}), signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  },

  // ─── TRIGGER client-side (stesso pattern di WeeklyReport.checkAndGenerate):
  // nessun cron lato worker, gira quando l'utente apre l'app e sono passati
  // >= RUN_EVERY_DAYS giorni dall'ultimo tentativo. Silenzioso su ogni errore
  // o dato insufficiente: non è una feature core, non deve mai disturbare. ───
  async checkAndGenerate() {
    // Stessa guardia anti-doppio-avvio di WeeklyReport: LAST_RUN_KEY viene
    // scritto solo dopo l'await di getWorkoutSessions — un secondo
    // Dashboard.load() partito nel frattempo (doppio tap sul tab durante il
    // boot) superava lo stesso controllo temporale e finiva per lanciare due
    // /predictive-run per lo stesso ciclo.
    if (this._checking) return;
    this._checking = true;
    try {
      const last = parseInt(localStorage.getItem(this.LAST_RUN_KEY) || "0", 10);
      const now = Date.now();
      if (last && (now - last) < this.RUN_EVERY_DAYS * 86400000) return;   // non è ancora tempo

      const sessions = await API.getWorkoutSessions(150).catch(() => []);
      const done = sessions.filter(s => s.done && s.date);
      if (!done.length) return;
      const oldest = done.reduce((min, s) => (!min || new Date(s.date) < new Date(min.date)) ? s : min, null);
      const weeksOfHistory = Math.floor((now - new Date(oldest.date).getTime()) / (7 * 86400000));
      if (weeksOfHistory < 8) return;   // meno di 8 settimane di storico: dati insufficienti per un mesociclo

      // Segna il tentativo SUBITO, prima ancora di sapere se andrà a buon
      // fine: se la rete/Gemini falliscono non deve riprovare ad ogni apertura
      // app (quota Gemini condivisa e limitata, vedi commento in worker.js).
      localStorage.setItem(this.LAST_RUN_KEY, String(now));

      const data = await this._buildData(done);
      if (!data) return;
      await this._fetchWithTimeout(`${CONFIG.AI_WORKER_URL}/predictive-run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      }, 25000);
      // Non serve leggere la risposta qui: la proposta (se generata) è già
      // salvata lato worker in KV, la sezione Schede la mostra al prossimo load().
    } catch (e) { console.error("PredictiveCoach.checkAndGenerate:", e); }
    finally { this._checking = false; }
  },

  // ─── AGGREGAZIONE DATI (client-side) — riusa Progression._computeSessions,
  // Volume.MUSCLES/musclesFor/mrvFor e WeeklyReport._aggregate/_streak dove
  // possibile, invece di reinventare la stessa logica con bug diversi. ───
  async _buildData(doneSessions) {
    const now = new Date();
    const w8  = new Date(now); w8.setDate(w8.getDate() - 56);
    const w16 = new Date(now); w16.setDate(w16.getDate() - 112);
    const recentSessions = doneSessions.filter(s => new Date(s.date) >= w8);
    const prevSessions   = doneSessions.filter(s => new Date(s.date) >= w16 && new Date(s.date) < w8);
    if (!recentSessions.length) return null;

    const [recentAgg, prevAgg] = await Promise.all([
      WeeklyReport._aggregate(recentSessions), WeeklyReport._aggregate(prevSessions),
    ]);

    // Volume per gruppo muscolare: ultime 8 vs precedenti 8 settimane, con le
    // stesse soglie MEV/MRV usate dal resto dell'app (Volume module).
    const volumeTrend = Volume.MUSCLES
      .filter(m => (recentAgg.vol[m] || 0) > 0 || (prevAgg.vol[m] || 0) > 0)
      .map(m => ({
        muscle: m,
        sets8w: Math.round((recentAgg.vol[m] || 0) * 10) / 10,
        prevSets8w: Math.round((prevAgg.vol[m] || 0) * 10) / 10,
        mev: Volume.MEV, mrv: Volume.mrvFor(m),
      }));

    // Dolore ricorrente su 8 settimane: soglia più alta di WeeklyReport (2)
    // perché la finestra è 8x più larga — 3 sedute su 8 settimane è un
    // pattern reale, non rumore di una singola settimana storta.
    const recurringPain = Object.keys(recentAgg.painCount).filter(ex => recentAgg.painCount[ex] >= 3);

    // Trend carico/e1RM per esercizio: PIATTO = nessun record E variazione
    // dell'e1RM del top set entro il rumore (±3%) nelle ultime 8 settimane —
    // stessa logica/PR di Progression._computeSessions, non ricalcolata a mano.
    const exerciseTrends = [];
    for (const name of (recentAgg.exNames || [])) {
      try {
        const history = await API.getExerciseHistory(name);
        const sessions = Progression._computeSessions(history);
        const inWindow = sessions.filter(g => g.date && new Date(g.date) >= w8);
        if (inWindow.length < 3) continue;   // troppo pochi dati per giudicare un plateau
        const hasPR = inWindow.some(g => g.isPR);
        const e1First = inWindow[0].topE1 || 0, e1Last = inWindow[inWindow.length - 1].topE1 || 0;
        const pctChangeE1 = e1First > 0 ? Math.round(((e1Last - e1First) / e1First) * 1000) / 10 : null;
        const flat = !hasPR && pctChangeE1 != null && Math.abs(pctChangeE1) <= 3;
        exerciseTrends.push({ exercise: name, sessionsInWindow: inWindow.length, pctChangeE1, hasPR, flat });
      } catch (e) { /* esercizio singolo non leggibile: ignora, non bloccare l'aggregazione */ }
    }

    const streakWeeks = WeeklyReport._streak(doneSessions, WeeklyReport._mondayOf(now));

    // Fase attuale (bulk/cut/mant.) dall'ultimo check-in corporeo, se disponibile.
    let phase = null;
    try { const checkins = await API.getBodyMetrics(1); if (checkins.length) phase = checkins[checkins.length - 1].fase || null; } catch (e) {}

    // Programma/sedute ATTIVE con id Notion reale: il worker/Gemini può
    // scegliere schedaId/oldExercise SOLO da questa lista — validati di nuovo
    // lato client (vedi _applyToNotion) prima di scrivere, mai inventati.
    const schedaExercises = (App.schede || []).filter(s => s.progAttivo).map(s => ({
      schedaId: s.id, sedutaName: s.nome,
      exercises: (s.exercises || []).map(e => U.exName(e)).filter(Boolean),
    }));
    if (!schedaExercises.some(s => s.exercises.length)) return null;   // niente scheda attiva utile

    return { volumeTrend, recurringPain, exerciseTrends, streakWeeks, phase,
      activeProgram: App.activeProgram || null, schedaExercises };
  },

  // ─── UI ───
  async load() {
    const wrap = document.getElementById("pred-list");
    if (!wrap) return;
    this.errorMsg = null;
    try {
      const res = await this._fetchWithTimeout(`${CONFIG.AI_WORKER_URL}/predictive-proposals`);
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j && j.error ? j.error : ""; } catch (e) {}
        throw new Error(detail || `Errore ${res.status}`);
      }
      const j = await res.json();
      this.proposals = Array.isArray(j.proposals) ? j.proposals : [];
      this.render();
    } catch (e) {
      console.error("PredictiveCoach.load:", e);
      this.errorMsg = String(e && e.message || e);
      this.render();
    }
  },

  render() {
    const wrap = document.getElementById("pred-list");
    if (!wrap) return;
    if (this.errorMsg) {
      wrap.innerHTML = `<div class="empty-state sci-error"><i class="ti ti-plug-connected-x"></i><span class="es-title">Coach predittivo non disponibile</span><span class="es-sub">${this._esc(this.errorMsg)}</span></div>`;
      return;
    }
    const pending = this.proposals.filter(p => p.status === "pending");
    const decided = this.proposals.filter(p => p.status !== "pending")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 6);
    let html = "";
    if (pending.length) {
      html += pending.map(p => this._cardHTML(p, true)).join("");
    } else {
      html += `<div class="empty-state"><i class="ti ti-brain"></i><span class="es-title">Nessuna proposta al momento</span><span class="es-sub">Gira una volta al mese, e solo se i dati mostrano un segnale chiaro (stallo, dolore ricorrente, volume fuori target) — niente proposte "tanto per".</span></div>`;
    }
    if (decided.length) {
      html += `<div class="sci-sub" style="margin-top:16px">Storico decisioni</div>`;
      html += decided.map(p => this._cardHTML(p, false)).join("");
    }
    wrap.innerHTML = html;
  },

  _changeLabel(p) {
    const d = p.details || {};
    if (p.changeType === "sostituisci_esercizio") return `Sostituire "${d.oldExercise || "?"}" con "${d.newExercise || "?"}"`;
    return p.changeType || "Modifica proposta";
  },

  _cardHTML(p, actionable) {
    const statusClass = p.status === "rejected" ? "sci-rejected" : (p.status === "approved" && !p.applied) ? "pred-not-applied" : (p.status === "approved" ? "sci-approved" : "");
    const statusTag = p.status === "rejected"
      ? '<div class="sci-status-tag"><i class="ti ti-circle-x"></i>Rifiutata</div>'
      : p.status === "approved"
        ? (p.applied
            ? '<div class="sci-status-tag"><i class="ti ti-circle-check"></i>Applicata su Notion</div>'
            : `<div class="sci-status-tag" style="color:var(--red)"><i class="ti ti-alert-triangle"></i>Approvata ma NON scritta su Notion${p.applyError ? " — " + this._esc(p.applyError) : ""}</div>`)
        : "";
    const actions = actionable
      ? `<div class="sci-actions">
          <button class="btn-secondary" onclick="PredictiveCoach.decide(${U.arg(p.id)}, false)"><i class="ti ti-x"></i>Rifiuta</button>
          <button class="btn-primary" onclick="PredictiveCoach.decide(${U.arg(p.id)}, true)"><i class="ti ti-check"></i>Approva</button>
        </div>`
      : statusTag;
    return `
      <div class="sci-card ${statusClass}">
        <div class="sci-card-head">
          <span class="sci-area">${this._esc(p.sedutaName || p.schedaName || "Scheda attiva")}</span>
        </div>
        <div class="sci-claim">${this._esc(this._changeLabel(p))}</div>
        <div class="sci-fonte"><i class="ti ti-bulb"></i>${this._esc(p.reasoning || "")}</div>
        ${actions}
      </div>`;
  },

  async decide(id, approved) {
    if (this.busy) return;
    const p = this.proposals.find(x => x.id === id);
    if (!p) return;
    this.busy = true;
    try {
      let applied = false, applyError = null;
      if (approved) {
        // La SCRITTURA VERA su Notion avviene qui, e solo qui: se fallisce, la
        // proposta resta "approvata ma non applicata" — mai persa in silenzio,
        // mai marcata come fatta se non lo è davvero.
        try { await this._applyToNotion(p); applied = true; }
        catch (e) { console.error("PredictiveCoach._applyToNotion:", e); applyError = String(e && e.message || e); }
      }
      const res = await this._fetchWithTimeout(`${CONFIG.AI_WORKER_URL}/predictive-proposals/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approved, applied, applyError }),
      });
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j && j.error ? j.error : ""; } catch (e) {}
        throw new Error(detail || `Errore ${res.status}`);
      }
      if (approved && applied) U.toast("Modifica applicata alla scheda", "ok");
      else if (approved && !applied) U.toast("Approvata ma la scrittura su Notion è fallita" + (applyError ? ": " + applyError : ""), "err", 4000);
      else U.toast("Proposta rifiutata", "ok");
      await this.load();
      // La scheda è cambiata su Notion: ricarica lo stato locale così Schede/
      // Sessione/Progressioni vedono subito l'esercizio nuovo, non quello vecchio in cache.
      if (approved && applied) {
        await App.loadSchede();
        if (typeof Schede !== "undefined") Schede.render();
      }
    } catch (e) {
      console.error("PredictiveCoach.decide:", e);
      U.toast("Errore: " + (e && e.message || e), "err");
    } finally { this.busy = false; }
  },

  // Applica DAVVERO la sostituzione esercizio→esercizio sulla seduta indicata
  // (API.updateScheda su Notion). Rilegge lo stato FRESCO delle schede e
  // valida schedaId/oldExercise contro la realtà attuale prima di scrivere:
  // se la seduta o l'esercizio non esistono più (rinominati/eliminati dopo la
  // generazione della proposta, che può essere vecchia di giorni), fallisce
  // esplicitamente invece di scrivere dati inconsistenti su dati REALI dell'utente.
  async _applyToNotion(p) {
    if (p.changeType !== "sostituisci_esercizio") throw new Error("Tipo di modifica non supportato in questa versione");
    const d = p.details || {};
    if (!d.schedaId || !d.oldExercise || !d.newExercise) throw new Error("Proposta incompleta");
    await App.loadSchede();
    const scheda = (App.schede || []).find(s => s.id === d.schedaId);
    if (!scheda) throw new Error("Seduta non trovata (forse eliminata o rinominata)");
    const idx = (scheda.exercises || []).findIndex(e => U.exName(e) === d.oldExercise);
    if (idx === -1) {
      // Idempotenza: se il worker aveva già scritto su Notion (updateScheda
      // riuscito) ma la POST che segna la proposta "approved" falliva subito
      // dopo (rete flaky), un secondo tap su "Approva" ripartiva da qui e
      // trovava oldExercise già sostituito — throw fuorviante "non più
      // presente" anche se il cambio era in realtà già andato a buon fine.
      // Se il NUOVO esercizio è già lì, considera il cambio già applicato.
      const already = (scheda.exercises || []).some(e => U.exName(e) === d.newExercise);
      if (already) return;
      throw new Error(`Esercizio "${d.oldExercise}" non più presente in questa seduta`);
    }
    // Conserva TUTTI gli altri parametri dell'esercizio (serie, rep range,
    // recupero, RIR, tecnica, cadenza...): è un cambio di esercizio a parità
    // di programmazione, non una riscrittura della scheda.
    const newExercises = scheda.exercises.map((e, i) => {
      if (i !== idx) return e;
      return (typeof e === "string") ? d.newExercise : { ...e, nome: d.newExercise };
    });
    await API.updateScheda(scheda.id, { exercises: newExercises });
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Cardio module
// ═══════════════════════════════════════════════
