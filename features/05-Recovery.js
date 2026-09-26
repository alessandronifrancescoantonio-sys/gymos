const Recovery = {
  KEY: "gymos_recovery",
  STATES: [
    { id: "early", lbl: "Era già passato",     ic: "ti-battery-4", tone: "up" },
    { id: "just",  lbl: "Passato in tempo",    ic: "ti-battery-2", tone: "ok" },
    { id: "still", lbl: "Ancora indolenzito",  ic: "ti-battery-1", tone: "bad" },
  ],
  _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch (e) { return {}; } },
  _save(o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (e) {} },
  set(date, muscle, state) {
    const o = this._load();
    (o[date] = o[date] || {})[muscle] = state;
    this._save(o);
  },
  get(date, muscle) { const o = this._load(); return (o[date] || {})[muscle] || null; },
  // Ultimo feedback registrato per un muscolo, a qualunque data.
  latest(muscle) {
    const o = this._load();
    const dates = Object.keys(o).filter(d => o[d] && o[d][muscle]).sort();
    if (!dates.length) return null;
    const d = dates[dates.length - 1];
    return { date: d, state: o[d][muscle] };
  },
  // Quanto è "fresco" il feedback: oltre ~10 giorni non descrive più l'oggi.
  STALE_DAYS: 10,
  latestFresh(muscle) {
    const l = this.latest(muscle);
    if (!l) return null;
    const days = Math.round((Date.now() - new Date(l.date).getTime()) / 86400000);
    return days <= this.STALE_DAYS ? { ...l, days } : null;
  },
  stateOf(id) { return this.STATES.find(s => s.id === id) || null; },
  _esc(s) { return U.escape(s); },

  // ═══ MAPPA DI RECUPERO (semaforo per muscolo) ═════════════════════════════
  // Rosso  = arrivi ancora indolenzito, OPPURE sei già al tetto MRV stimato
  // Giallo = indolenzimento passato giusto in tempo (sei al punto giusto)
  // Verde  = recuperato con margine: c'è spazio per crescere
  // Grigio = nessun feedback recente: NON inventiamo uno stato, lo chiediamo
  //
  // Onestà: senza il tuo feedback questa mappa non ha niente da dire. Preferiamo
  // un "non lo so" a un semaforo dedotto dal calendario, che sembrerebbe una
  // misura e sarebbe un'ipotesi.
  status(muscle) {
    const dir = (Volume._actualDir && Volume._actualDir[muscle]) || 0;
    const mrv = Volume.mrvFor(muscle);
    const fb = this.latestFresh(muscle);
    if (!fb) return { tone: "none", lbl: "Nessun dato", dir, mrv, doms: null };
    if (dir >= mrv) return { tone: "bad", lbl: "Al tetto di volume", dir, mrv, doms: fb.state };
    if (fb.state === "still") return { tone: "bad", lbl: "Non recuperato", dir, mrv, doms: fb.state };
    if (fb.state === "just")  return { tone: "ok",  lbl: "Recupero al limite", dir, mrv, doms: fb.state };
    return { tone: "up", lbl: "Recuperato", dir, mrv, doms: fb.state };
  },

  // ═══ ANALISI INTER-CICLO: la fatica si sta accumulando? ═══════════════════
  // Israetel: il segnale di fatica ACCUMULATA non è una brutta giornata, è il
  // recupero che si ALLUNGA nel tempo a parità di lavoro. Qui confrontiamo la
  // quota di "ancora indolenzito" nelle ultime 4 settimane contro le 4 prima.
  //
  // Serve tempo per dire qualcosa di vero: sotto le 6 risposte su ≥28 giorni
  // NON ci pronunciamo. Meglio "servono più dati" che una tendenza inventata
  // su tre risposte — che è esattamente il modo di sembrare scientifici senza
  // esserlo.
  MIN_FEEDBACK: 6,
  MIN_SPAN_DAYS: 28,
  systemicTrend() {
    const o = this._load();
    const pts = [];
    Object.keys(o).forEach(d => {
      Object.keys(o[d] || {}).forEach(m => pts.push({ date: d, state: o[d][m] }));
    });
    if (pts.length < this.MIN_FEEDBACK) return { enough: false, have: pts.length, need: this.MIN_FEEDBACK };
    pts.sort((a, b) => a.date.localeCompare(b.date));
    const spanDays = Math.round((new Date(pts[pts.length - 1].date) - new Date(pts[0].date)) / 86400000);
    if (spanDays < this.MIN_SPAN_DAYS) return { enough: false, have: pts.length, need: this.MIN_FEEDBACK, spanDays };

    const cut = Date.now() - 28 * 86400000;
    const recent = pts.filter(p => new Date(p.date).getTime() >= cut);
    const older  = pts.filter(p => new Date(p.date).getTime() <  cut);
    if (!recent.length || older.length < 3) return { enough: false, have: pts.length, need: this.MIN_FEEDBACK, spanDays };

    const frac = arr => arr.filter(p => p.state === "still").length / arr.length;
    const fRec = frac(recent), fOld = frac(older);
    const delta = fRec - fOld;
    // +20 punti percentuali di "ancora indolenzito" = il recupero si sta
    // allungando davvero, non è rumore.
    if (delta >= 0.20) {
      return { enough: true, worsening: true, recentPct: Math.round(fRec * 100), olderPct: Math.round(fOld * 100),
        msg: `Il recupero si sta allungando: nell'ultimo mese arrivi ancora indolenzito il ${Math.round(fRec * 100)}% delle volte, contro il ${Math.round(fOld * 100)}% di prima. È fatica che si accumula: valuta uno scarico più lungo (una settimana intera leggera), non solo una seduta più morbida.` };
    }
    if (delta <= -0.20) {
      return { enough: true, worsening: false, recentPct: Math.round(fRec * 100), olderPct: Math.round(fOld * 100),
        msg: `Stai recuperando meglio di un mese fa (${Math.round(fRec * 100)}% di sedute con indolenzimento residuo, contro il ${Math.round(fOld * 100)}%): il carico attuale è sostenibile, c'è margine.` };
    }
    return { enough: true, worsening: false, stable: true, recentPct: Math.round(fRec * 100), olderPct: Math.round(fOld * 100),
      msg: `Il tuo recupero è stabile rispetto al mese scorso: il carico che porti è sostenibile.` };
  },

  // Fase corporea ATTUALE: ultimo check-in Misurazioni con una fase indicata,
  // non la selezione di default del form (Body.activeFase è solo l'ultima
  // pillola cliccata nel form, non lo stato reale dell'utente). Stesso punto
  // dati che PredictiveCoach._buildData già legge allo stesso modo.
  _currentPhase(checkins) {
    if (!Array.isArray(checkins) || !checkins.length) return null;
    for (let i = checkins.length - 1; i >= 0; i--) {
      if (checkins[i] && checkins[i].fase) return checkins[i].fase;
    }
    return null;
  },

  // Parole di stanchezza/spossatezza scritte dall'utente stesso — nel diario
  // di oggi (Diary.getJournal, aggiornato quasi ogni giorno) o nelle note
  // delle ultime sedute (stesso campo "Note sessione" che l'utente compila da
  // solo). Stile della regex coerente con painLevel/hard in session.js (parole
  // chiave italiane, non un sentiment model): fatica GENERALE, non dolore
  // (quello è già gestito altrove, JointLog/painLevel) — copre anche "stanco
  // per il caldo" perché la parola-chiave è "stanco", non "caldo" da solo
  // (l'app non traccia la temperatura: non inventiamo un dato che non ha).
  FATIGUE_RE: /stanch\w*|sfinit\w*|esaurit\w*|sfiancat\w*|spossat\w*|distrutt\w*|a pezzi|provat\w*|senza energie|giornata pesante|molto caldo|troppo caldo|afa\b/i,
  RECENT_NOTE_DAYS: 4,
  _recentFatigueNote(sessions) {
    let txt = "";
    try { if (typeof Diary !== "undefined") txt += " " + (Diary.getJournal() || ""); } catch (e) {}
    if (Array.isArray(sessions)) {
      const cutoff = Date.now() - this.RECENT_NOTE_DAYS * 86400000;
      sessions.forEach(s => {
        if (s && s.note && s.date && new Date(s.date).getTime() >= cutoff) txt += " " + s.note;
      });
    }
    return this.FATIGUE_RE.test(txt);
  },

  // `sleepData`: stesso array che Dashboard già carica per il semaforo sonno
  // (API.getRecentSleep) — riusato qui, non una seconda chiamata. Stessa
  // soglia di Dashboard.buildSemaforo: HRV<45 o <6h = rosso.
  // `checkins`/`sessions`: stessi array già caricati da Dashboard.load() per
  // le stat/il weekly split — nessuna nuova chiamata a Notion per questa card.
  renderCard(sleepData, checkins, sessions) {
    const wrap = document.getElementById("dash-recovery");
    if (!wrap || typeof Volume === "undefined") return;
    const title = `<div class="card-title"><i class="ti ti-heartbeat"></i>Recupero muscolare</div>`;
    const lastSleep = Array.isArray(sleepData) && sleepData.length ? sleepData[0] : null;
    const sleepBad = !!(lastSleep && ((lastSleep.hrv && lastSleep.hrv < 45) || (lastSleep.ore || 7) < 6));
    const phase = this._currentPhase(checkins);
    const diaryFatigue = this._recentFatigueNote(sessions);
    // Segnale forza-in-calo REALE (già scritto altrove, vedi Body._energyFlag/
    // DailyRecap), letto qui invece di essere passato hardcoded a `false` — i
    // rami "perfDropped" di nextVolume (scarico/−1 serie) erano irraggiungibili
    // dal vivo, anche quando il segnale era genuinamente attivo.
    let perfDropped = false;
    try {
      const sig = JSON.parse(localStorage.getItem("gymos_strength_signal") || "null");
      perfDropped = !!(sig && sig.down && (!sig.ts || (Date.now() - sig.ts) <= 28 * 86400000));
    } catch (e) {}
    // Muscoli con volume reale questa settimana (o pianificato se il "fatto"
    // non è ancora stato caricato): non ha senso un semaforo su ciò che non alleni.
    const dirMap = Volume._actualDir || Volume.compute().dir || {};
    const rows = Volume.MUSCLES.filter(m => (dirMap[m] || 0) > 0)
      .sort((a, b) => (dirMap[b] || 0) - (dirMap[a] || 0));
    if (!rows.length) {
      wrap.innerHTML = `${title}<div class="empty-state">Nessun muscolo allenato questa settimana.</div>`;
      return;
    }
    const items = rows.map(m => {
      const st = this.status(m);
      const adv = Volume.nextVolume(m, st.dir, st.doms, perfDropped, sleepBad, phase, diaryFatigue);
      const advTxt = adv
        ? `<div class="rmap-adv rm-${adv.tone}">${adv.deload ? "Scarico consigliato" : (adv.delta > 0 ? "+1 serie" : adv.delta < 0 ? "−1 serie" : "Tieni così")} — ${this._esc(adv.why)}</div>`
        : `<div class="rmap-adv rm-none">Dimmi come ci arrivi alla prossima seduta e ti dico se salire o scendere di volume.</div>`;
      return `
        <div class="rmap-row">
          <div class="rmap-head">
            <span class="rmap-dot rm-${st.tone}"></span>
            <span class="rmap-mus">${this._esc(m)}</span>
            <span class="rmap-state rm-${st.tone}">${this._esc(st.lbl)}</span>
            <span class="rmap-vol">${Volume.fmt(st.dir)}<small>/${st.mrv}</small></span>
          </div>
          ${advTxt}
        </div>`;
    }).join("");
    // Andamento della fatica nel tempo (mese su mese): la parte che nessun
    // semaforo istantaneo può dire.
    const tr = this.systemicTrend();
    const trend = tr.enough
      ? `<div class="rtrend ${tr.worsening ? "rt-bad" : "rt-ok"}">
           <i class="ti ${tr.worsening ? "ti-trending-down" : "ti-trending-up"}"></i>
           <span>${this._esc(tr.msg)}</span>
         </div>`
      : `<div class="rtrend rt-none">
           <i class="ti ti-hourglass"></i>
           <span>Per dirti se la fatica si sta accumulando mi servono ancora un po' di risposte (${tr.have || 0}/${tr.need}, su almeno 4 settimane). Finché non ne ho abbastanza preferisco tacere che inventarmi una tendenza.</span>
         </div>`;

    wrap.innerHTML = `${title}
      ${trend}
      <div class="rmap-list">${items}</div>
      <div class="rmap-foot">Serie dirette fatte questa settimana / tetto stimato che recupereresti (MRV). Il semaforo viene dal tuo feedback a inizio seduta, non dal calendario.</div>`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  LOG DELLE INCOMPATIBILITÀ BIOMECCANICHE
//
//  L'avviso in sessione è DERIVATO dallo storico (si azzera da solo quando il
//  dolore smette). Ma quel calcolo vive solo dentro una sessione aperta: in
//  dashboard non c'è nulla da cui derivarlo. Quindi qui registriamo gli EVENTI
//  — "rilevato il giorno X", "sostituito", "tenuto comunque" — che sono fatti
//  accaduti, non uno stato da tenere sincronizzato.
//
//  Onestà: questo è un DIARIO, non una diagnosi. Se un esercizio non ti dà più
//  fastidio, "Dimentica" lo toglie e ricomincia da zero.
// ═══════════════════════════════════════════════════════════════════════════
