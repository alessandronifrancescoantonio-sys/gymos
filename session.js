// ═══════════════════════════════════════════════
//  GymOS — session.js
//  + Aggiungi serie | Drag & drop ordine | × Rimuovi serie
// ═══════════════════════════════════════════════

const Session = {
  sessions:     [],
  activeId:     null,
  exercises:    [],
  prevExercises:[],
  exOrder:      [],
  dragging:     null,
  selectedScheda: null,

  _pendingId: null,
  _pendingHistory: false,   // la prossima loadSession arriva dallo storico?
  _fromHistory: false,      // la sessione corrente è stata aperta dallo storico
  viewMode: false,          // sola lettura: nessuna modifica accidentale a kg/rep/serie
  sessionDone: false,       // la sessione caricata è già salvata/completata

  // Apre una sessione specifica dalla Home (Sessioni recenti) in SOLA LETTURA.
  // Il toggle view/edit appare SOLO in questo caso (sessioni passate).
  openById(id) {
    this._pendingId = id;
    this._pendingHistory = true;
    App.navigate("session");
  },

  // Attiva/disattiva la modalità sola lettura
  toggleViewMode() {
    this.viewMode = !this.viewMode;
    this.applyViewMode();
    // Gli esercizi sono costruiti UNA volta con lo stato viewMode di allora
    // (banner "Obiettivo di oggi", hint per-serie, chip "Usa" sono gated a
    // render-time): senza ri-renderizzare restano nascosti anche sbloccando.
    if (this.exercises && this.exercises.length) this.renderExercises();
    U.toast(this.viewMode ? "Sola visualizzazione — modifiche bloccate" : "Modifica attiva",
            this.viewMode ? "info" : "ok");
  },

  // Applica lo stato view/edit al DOM (classe sulla pagina + etichetta del bottone)
  applyViewMode() {
    const page = document.getElementById("page-session");
    if (page) page.classList.toggle("view-mode", this.viewMode);
    document.body.classList.toggle("session-view", this.viewMode);
    const btn = document.getElementById("view-toggle");
    if (btn) {
      // il toggle esiste SOLO per le sessioni passate aperte dalla Home
      btn.style.display = this._fromHistory ? "" : "none";
      btn.classList.toggle("is-view", this.viewMode);
      btn.innerHTML = this.viewMode
        ? '<i class="ti ti-pencil"></i><span class="vt-label">Abilita modifica</span>'
        : '<i class="ti ti-lock"></i><span class="vt-label">Blocca</span>';
    }
  },

  async load() {
    const target = this._pendingId;
    this._pendingId = null;

    // Sessione IN CORSO già caricata in memoria (non salvata, non dallo storico):
    // cambiando pagina e tornando qui NON si resetta — resta sull'allenamento.
    if (!target && this.activeId && !this.sessionDone && !this._fromHistory) {
      const pg = document.getElementById("page-session");
      if (pg) pg.classList.remove("session-empty");
      document.body.classList.remove("sess-landing");
      return;
    }

    try {
      this.sessions = await API.getWorkoutSessions(20);
      if (target && !this.sessions.find(s => s.id === target)) {
        this.sessions = await API.getWorkoutSessions(50);   // allarga per una sessione specifica
      }
      this.buildSelect();

      if (target && this.sessions.find(s => s.id === target)) {
        // apertura specifica (dalla Home → sessione passata)
        this.activeId = target;
        const sel = document.getElementById("sess-select");
        if (sel) sel.value = target;
        await this.loadSession(target);
        return;
      }

      // Dopo un reload della pagina: se c'era un allenamento in corso (non ancora
      // salvato), riprendilo invece di ripartire dal pulsante.
      const resume = localStorage.getItem("gymos_active");
      if (resume) {
        // Come per `target`: se la sessione in corso non è tra le 20 più recenti
        // (capita con più sessioni/giorni in mezzo), allarga la ricerca a 50 prima
        // di considerarla "non più valida" — altrimenti un allenamento in corso
        // sparisce e riparte da zero senza motivo.
        if (!this.sessions.find(x => x.id === resume)) {
          try { this.sessions = await API.getWorkoutSessions(50); this.buildSelect(); } catch (e) {}
        }
        const s = this.sessions.find(x => x.id === resume);
        if (s && s.done === false) {
          this.activeId = resume;
          const sel = document.getElementById("sess-select");
          if (sel) sel.value = resume;
          await this.loadSession(resume);
          return;
        }
        localStorage.removeItem("gymos_active");   // riferimento non più valido
      }

      // navigazione normale → schermata iniziale (solo il pulsante "nuovo allenamento")
      this.showLanding();
    } catch(e) { console.error("Session.load:", e); this.showLanding(); }
  },

  // Mostra la schermata iniziale (nessuna sessione caricata)
  showLanding() {
    clearTimeout(this._autoStartTimer);
    clearTimeout(this._autoSaveTimer);
    if (this.activeId) {
      localStorage.removeItem(`gymos_created_${this.activeId}`);
      localStorage.removeItem(`gymos_autosave_${this.activeId}`);
    }
    this.activeId = null;
    this._fromHistory = false;
    this.viewMode = false;
    this.sessionDone = false;
    localStorage.removeItem("gymos_active");   // niente più allenamento "in corso"
    const page = document.getElementById("page-session");
    if (page) page.classList.add("session-empty");
    document.body.classList.add("sess-landing");
    document.body.classList.remove("session-view");
  },

  buildSelect() {
    const sel = document.getElementById("sess-select");
    sel.innerHTML = "";
    this.sessions.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} — ${U.fmtDate(s.date)}`;
      sel.appendChild(opt);
    });
  },

  async loadSession(id) {
    this.activeId = id;
    // esci dalla schermata iniziale: mostra il contenuto della sessione
    const _pg = document.getElementById("page-session");
    if (_pg) _pg.classList.remove("session-empty");
    document.body.classList.remove("sess-landing");
    // Aperta dallo storico (Home)? → sola lettura + toggle. Altrimenti modifica, niente toggle.
    this._fromHistory = this._pendingHistory === true;
    this._pendingHistory = false;
    this.viewMode = this._fromHistory;
    const sess = this.sessions.find(s => s.id === id);
    if (!sess) return;
    this.sessionDone = sess.done === true;   // sessione già salvata/completata
    // Ricorda l'allenamento in corso, così sopravvive a cambi pagina e reload
    if (!this.sessionDone && !this._fromHistory) localStorage.setItem("gymos_active", id);

    document.getElementById("sess-title").textContent = sess.name.toUpperCase();
    document.getElementById("sess-meta").textContent =
      `${U.fmtDate(sess.date)} · ${sess.type || "—"}`;

    // Inizializza il timer durata (NON parte da solo, lo avvia l'utente col bottone)
    if (typeof DurationTimer !== "undefined") DurationTimer.init(id);

    this.exercises = await API.getSessionExercises(id);

    // Stato "serie completata" (locale per sessione)
    this._done = new Set(JSON.parse(localStorage.getItem(`gymos_done_${id}`) || "[]"));
    // Serie che hanno segnato un record in questa sessione (per tenere il badge PR)
    this._prSets = new Set(JSON.parse(localStorage.getItem(`gymos_pr_${id}`) || "[]"));

    // Riallinea la sessione IN CORSO alla sua seduta (aggiunge esercizi nuovi
    // della scheda; toglie quelli rimossi dalla scheda solo se senza dati).
    if (sess.done === false) await this.reconcileWithScheda(sess).catch(console.error);

    // Ordine esercizi. Priorità:
    //  1) ordine che TU hai dato a questa sessione (gymos_order_<id>);
    //  2) altrimenti l'ordine FISSO della seduta del programma attivo → così ogni
    //     nuova sessione parte identica alla scorsa corrispondente e le
    //     progressioni non sono "casuali" per ordini diversi;
    //  3) altrimenti l'ordine di arrivo da Notion.
    const grouped = this.groupByExercise(this.exercises);
    const keys = Object.keys(grouped);
    const savedOrder = JSON.parse(localStorage.getItem(`gymos_order_${id}`) || "null");
    const scheda = (typeof CONFIG !== "undefined" && CONFIG.SCHEDE) ? CONFIG.SCHEDE[sess.name] : null;
    const progOrder = scheda ? (scheda.exercises || []).map(it => U.exName(it)).filter(Boolean) : [];
    const byOrder = ord => { const on = ord.map(n => U.exBase(n)); return on.filter(n => keys.includes(n)).concat(keys.filter(k => !on.includes(k))); };
    if (savedOrder && savedOrder.length)      this.exOrder = byOrder(savedOrder);
    else if (progOrder.length)                this.exOrder = byOrder(progOrder);
    else                                      this.exOrder = keys;

    // Sessione precedente stesso tipo
    const sameType = this.sessions.filter(s => s.id !== id && s.type === sess.type);
    this.prevExercises = sameType.length > 0
      ? await API.getSessionExercises(sameType[0].id)
      : [];
    // Ordine esercizi della sessione precedente (una volta sola per sessione,
    // non ad ogni esercizio): usato da _orderShift per il #3.
    this._prevOrder = [];
    this.prevExercises.forEach(s => { const n = U.exBase(s.name); if (!this._prevOrder.includes(n)) this._prevOrder.push(n); });

    // Note della SESSIONE (intera): nota corrente + nota della precedente corrispondente
    this.renderSessionNote(sess, sameType[0]);

    this.renderExercises();
    this.renderDiaryBanner();   // nota/limitazioni mostrate UNA VOLTA qui, non ripetute ad ogni esercizio dall'IA
    this.updateStats();
    this.applyViewMode();
    this.armSessionTimers();   // auto-avvio durata + eventuale auto-salvataggio
    // Carica lo storico di ogni esercizio (background): alimenta gli obiettivi
    // intelligenti e semina i record personali. Non blocca l'UI.
    this.loadExerciseIntel(Object.keys(grouped)).then(() => this.loadAIAdvice(Object.keys(grouped)));
    // Sonno di stanotte (background): dà contesto ai consigli per-esercizio.
    this.loadSleepContext();
  },

  // Banner UNA TANTUM (diario di oggi + limitazioni standing) in cima alla
  // sessione: prima il diario veniva ri-letto e potenzialmente ri-menzionato
  // dall'IA per OGNI esercizio, sentito come "ripetitivo/a loop" — ora
  // l'utente lo vede una volta qui, e il motore IA lo cita solo se davvero
  // pertinente all'esercizio specifico (vedi system prompt worker).
  renderDiaryBanner() {
    const wrap = document.getElementById("diary-banner");
    if (!wrap) return;
    let diary = "", limits = "";
    try { if (typeof Diary !== "undefined") diary = Diary.getJournal(); } catch (e) {}
    try { if (typeof Diary !== "undefined") limits = Diary.standingLimitationsText(); } catch (e) {}
    if (!diary && !limits) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    wrap.style.display = "flex";
    wrap.innerHTML = `
      <i class="ti ti-notebook"></i>
      <div class="db-txt">
        ${diary ? `<div class="db-line"><b>Oggi:</b> ${esc(diary)}</div>` : ""}
        ${limits ? `<div class="db-line"><b>Da tenere a mente:</b> ${esc(limits)}</div>` : ""}
      </div>
      <button class="db-close" onclick="this.parentElement.style.display='none'" aria-label="Chiudi"><i class="ti ti-x"></i></button>`;
  },

  // Cervello IA (Gemini via Worker Cloudflare separato) — ADDITIVO, mai
  // sostituisce il motore a regole. Silenzioso su qualunque errore/offline:
  // se fallisce, l'utente vede solo il consiglio del motore a regole, punto.
  // Timeout breve per non far percepire l'app come lenta.
  async loadAIAdvice(exNames) {
    const token = (this._aiToken = (this._aiToken || 0) + 1);
    // Letto UNA volta prima del loop (non ad ogni esercizio): stessa chiamata
    // batch, coerente per tutti gli esercizi che riceve invece di poter
    // cambiare a metà se l'utente scrive al coach mentre il loop è in corso.
    // Filtro anti-banalità: lunghezza minima, MA lascia passare comunque le
    // menzioni di dolore anche se brevi ("spalla", "male al ginocchio") —
    // proprio i segnali brevi più clinicamente rilevanti da non perdere.
    let coachNotes;
    try {
      if (typeof Coach !== "undefined") {
        const painRe = /dolor|\bmale\b|fastidi|infortun|strapp/i;
        coachNotes = Coach._loadHistory()
          .filter(e => { const q = (e.question || "").trim(); return q.length >= 12 || painRe.test(q); })
          .slice(-3).map(e => ({ question: e.question, answer: e.answer }));
      }
    } catch (e) {}
    // Limitazioni fisiche STANDING (Diario → Info & esenzioni): distinte dal
    // diario di oggi, valgono finché non le rimuovi. Lette una volta per il
    // batch, come coachNotes.
    let standingLimitations = "";
    try { if (typeof Diary !== "undefined") standingLimitations = Diary.standingLimitationsText(); } catch (e) {}
    for (const exName of (exNames || [])) {
      if (!exName) continue;
      try {
        const grouped = this.groupByExercise(this.exercises);
        const sets = grouped[exName] || [];
        const rrMin = sets[0]?.rrMin || 8, rrMax = sets[0]?.rrMax || 12, rir = sets[0]?.rir ?? null;
        const stats = (this._exStats && this._exStats[exName]) || [];
        const history = stats.slice(-8).map(g => ({ date: g.date, sets: (g.sets || []).map(s => ({ kg: s.kg, reps: s.reps })), notes: g.notes || [] }));
        // Diario libero di oggi ("Diario" → Giornata & sensazioni): testo
        // scritto dall'utente, autosalvato in tempo reale. Letto FRESCO ad
        // ogni chiamata (non cache-ato), così un aggiornamento a metà
        // giornata si riflette sul prossimo consiglio richiesto.
        let diary = "";
        try { if (typeof Diary !== "undefined") diary = Diary.getJournal(); } catch (e) {}
        // Fase attuale (Cut/Bulk/Mant., da Misurazioni) — contesto per il consiglio.
        let phase = "";
        try { if (typeof Body !== "undefined" && Body.checkins && Body.checkins.length) phase = Body.checkins[Body.checkins.length - 1].fase || ""; } catch (e) {}
        // Esercizi già fatti OGGI in QUESTA sessione (esclude quello corrente):
        // ogni serie completata prima alimenta il consiglio degli esercizi
        // successivi — ricalcolato fresco ad ogni chiamata, non cache-ato.
        const todaySession = this._todaySessionSummary(exName);
        const payload = { exercise: exName, rrMin, rrMax, rir, history, sleep: this._sleepInfo || null, systemicDown: !!this._systemicDown, diary: diary || undefined, standingLimitations: standingLimitations || undefined, phase: phase || undefined, todaySession: todaySession.length ? todaySession : undefined, coachNotes: (coachNotes && coachNotes.length) ? coachNotes : undefined };

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`${CONFIG.AI_WORKER_URL}/advice`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        if (token !== this._aiToken) return;   // sessione cambiata: abbandona
        if (!res.ok) continue;
        const data = await res.json();
        if (!data || !data.advice) continue;
        this._renderAIAdvice(exName, data);
      } catch (e) { /* offline o worker down: niente, il motore a regole basta */ }
    }
  },

  // Riepilogo degli esercizi già FATTI oggi in questa sessione (serie con
  // reps>0), esclude `excludeExName`. Alimenta il consiglio IA degli esercizi
  // successivi con ciò che è appena successo in sessione, non solo lo storico.
  _todaySessionSummary(excludeExName) {
    const grouped = this.groupByExercise(this.exercises);
    const out = [];
    for (const name of this.exOrder || []) {
      if (name === excludeExName) continue;
      const sets = (grouped[name] || []).filter(s => (s.reps || 0) > 0);
      if (!sets.length) continue;
      out.push({ name, sets: sets.map(s => ({ kg: s.kg || 0, reps: s.reps })), notes: sets.map(s => s.note).filter(Boolean) });
    }
    return out;
  },

  _renderAIAdvice(exName, data) {
    const sid = this.sanitize(exName);
    const el = document.getElementById(`ai-${sid}`);
    if (!el) return;
    const tone = ["go", "hold", "warn"].includes(data.tone) ? data.tone : "go";
    const ic = tone === "warn" ? "ti-sparkles" : tone === "hold" ? "ti-sparkles" : "ti-sparkles";
    const confLbl = data.confidence === "bassa" ? " · poca certezza" : "";
    el.innerHTML = `
      <div class="ai-advice-box ai-${tone}">
        <i class="ti ${ic}"></i>
        <div class="ai-txt"><span class="ai-lbl">IA${confLbl}</span><span class="ai-main">${this._escAI(data.advice)}</span></div>
      </div>`;
  },
  _escAI(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },

  // #F — Note per singolo esercizio, per sessione, salvate ON-DEVICE
  // (localStorage), come le foto progressi. Non toccano lo schema Notion.
  _exNoteKey() { return `gymos_exnote_${this.activeId || "none"}`; },
  _exNoteMap() { try { return JSON.parse(localStorage.getItem(this._exNoteKey()) || "{}"); } catch (e) { return {}; } },
  getExNote(exName) { return this._exNoteMap()[U.exBase(exName)] || ""; },
  // Un timer di debounce PER ESERCIZIO (non uno condiviso): col timer unico,
  // scrivere la nota di un esercizio e passare entro 400ms alla textarea di
  // un altro cancellava il salvataggio pendente del primo — nota persa.
  _exNoteTimers: {},
  setExNote(exName, text) {
    const k = U.exBase(exName);
    clearTimeout(this._exNoteTimers[k]);
    this._exNoteTimers[k] = setTimeout(() => {
      delete this._exNoteTimers[k];
      const map = this._exNoteMap(), t = (text || "").trim();
      if (t) map[k] = t; else delete map[k];
      try { localStorage.setItem(this._exNoteKey(), JSON.stringify(map)); } catch (e) {}
    }, 400);
  },

  groupByExercise(entries) {
    const map = {};
    entries.forEach(e => {
      const name = U.exBase(e.name) || e.name;
      if (!map[name]) map[name] = [];
      map[name].push(e);
    });
    return map;
  },

  saveOrder() {
    if (this.activeId) {
      localStorage.setItem(`gymos_order_${this.activeId}`, JSON.stringify(this.exOrder));
    }
  },

  // #3 — Rileva se l'esercizio si è spostato di posizione rispetto alla sessione
  // precedente corrispondente (volontario o no, es. "macchinario occupato" ti fa
  // scambiare due esercizi). Un esercizio spostato molto più avanti arriva con
  // più fatica accumulata: il motore deve saperlo per non leggere un calo come
  // vero calo di forza.
  _orderShift(exName) {
    const prevOrder = this._prevOrder || [];   // calcolato una volta in loadSession
    const todayIdx = this.exOrder.indexOf(exName), prevIdx = prevOrder.indexOf(exName);
    if (todayIdx < 0 || prevIdx < 0 || prevOrder.length < 2) return null;
    const shift = todayIdx - prevIdx;
    if (Math.abs(shift) < 2) return null;   // spostamenti minimi: irrilevanti
    return { shift, laterThanUsual: shift > 0 };
  },

  // #5 — Diretto vs indiretto NELLA STESSA SEDUTA: se il muscolo primario di
  // questo esercizio è già stato colpito DIRETTAMENTE da un altro esercizio
  // fatto prima oggi (stesso allenamento), conta come fatica locale già
  // accumulata — utile per non aspettarsi lo stesso rendimento del "primo".
  _sameMuscleDirect(exName) {
    if (typeof Volume === "undefined") return null;
    const mine = Volume.musclesFor(exName);
    const primary = Object.keys(mine).find(k => mine[k] >= 1);
    if (!primary) return null;
    const before = this.exOrder.slice(0, this.exOrder.indexOf(exName));
    const others = before.filter(n => {
      const m = Volume.musclesFor(n);
      return (m[primary] || 0) >= 1;   // diretto sullo stesso muscolo, prima di oggi
    });
    if (!others.length) return null;
    return { muscle: primary, count: others.length, names: others };
  },

  renderExercises() {
    const container = document.getElementById("exercises-container");
    container.innerHTML = "";
    const grouped     = this.groupByExercise(this.exercises);
    const prevGrouped = this.groupByExercise(this.prevExercises);

    this.exOrder.forEach((exName, exIdx) => {
      const sets    = grouped[exName] || [];
      const prevSets= prevGrouped[exName] || [];
      const rrMin   = sets[0]?.rrMin || 8;
      const rrMax   = sets[0]?.rrMax || 12;
      const rest    = sets[0]?.recupero ?? "";
      const rir     = sets[0]?.rir ?? "";
      const prevMax = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
      const sid     = this.sanitize(exName);
      const ex      = sets[0] || {};   // i campi tecnica vivono a livello esercizio (su tutte le serie)

      const block = document.createElement("div");
      block.className  = "ex-block collapsed";
      block.dataset.ex = exName;

      block.innerHTML = `
        <div class="ex-hd" onclick="Session.toggleEx(this, event)">
          <span class="drag-handle" aria-label="Trascina"><i class="ti ti-grip-vertical"></i></span>
          <span class="ex-num">${exIdx + 1}</span>
          <div class="ex-hd-main">
            <div class="ex-name">${exName}
              <button type="button" class="ex-howto-btn" title="Come si esegue?" onclick="event.stopPropagation();ExerciseGuide.open('${exName.replace(/'/g, "\\'")}')"><i class="ti ti-help-circle"></i></button>
            </div>
            <div class="ex-sub">
              <span class="ex-target-inline">Target
                <input class="rr-in-sm" type="number" value="${rrMin}" min="1" max="40"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRR('${exName}','min',this.value)">–<input class="rr-in-sm" type="number" value="${rrMax}" min="1" max="40"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRR('${exName}','max',this.value)"> rep
              </span>
              <span class="ex-target-inline">· rec
                <input class="rr-in-sm" type="number" value="${rest}" min="0" step="5" placeholder="90"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRest('${exName}',this.value)"> s
              </span>
              <span class="ex-target-inline">· RIR
                <input class="rr-in-sm" type="number" value="${rir}" min="0" max="10" step="1" placeholder="2"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRIR('${exName}',this.value)">
              </span>
              ${prevMax > 0 ? `<span>· max ${U.fmt(prevMax)} kg</span>` : ""}
            </div>
          </div>
          <span class="ex-setcount" id="setcount-${sid}">${sets.length}<small>serie</small></span>
          <i class="ti ti-circle-dot ex-todo-check"></i>
          <i class="ti ti-circle-check-filled ex-done-check"></i>
          <i class="ti ti-chevron-down ex-chevron"></i>
        </div>
        <div class="ex-body">
          ${(!this.viewMode && !this.sessionDone) ? this.progressionGoalHTML(exName, prevSets, rrMin, rrMax, rir, this._orderShift(exName), this._sameMuscleDirect(exName)) : ""}
          ${(!this.viewMode && !this.sessionDone) ? this.warmupRampHTML(exName, prevMax) : ""}
          ${(!this.viewMode && !this.sessionDone) ? `<div class="ai-advice" id="ai-${sid}"></div>` : ""}
          ${this.prevNotesHTML(prevSets)}
          <div id="sets-${sid}"></div>
          <div class="add-set-row">
            <button class="add-set-btn" onclick="Session.addSet('${exName}')">
              <i class="ti ti-plus"></i> Aggiungi serie
            </button>
          </div>
          ${(() => {
            // #F — nota per singolo esercizio (per QUESTA sessione, on-device).
            const n = this.getExNote(exName);
            if (this.viewMode && !n) return "";                 // in sola-lettura mostra solo se c'è
            const esc = String(n).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<div class="ex-note-wrap">
              <i class="ti ti-note ex-note-ic"></i>
              <textarea class="ex-note-in" rows="1" ${this.viewMode ? "readonly" : ""} placeholder="Nota su questo esercizio (solo oggi)…" oninput="Session.setExNote('${exName}', this.value)">${esc}</textarea>
            </div>`;
          })()}
          <div class="ex-tech${(ex.tecnica && ex.tecnica.length) || ex.gruppo ? " has-tech" : ""}" id="extech-${sid}">
            ${this.exTechInnerHTML(exName, ex)}
          </div>
          <button class="del-ex-btn" onclick="Session.deleteExercise('${exName}')">
            <i class="ti ti-trash"></i> Rimuovi esercizio dalla scheda
          </button>
        </div>
      `;

      // ─── DRAG: long-press (mobile) + mouse (desktop) ───
      const handle = block.querySelector(".drag-handle");
      this.attachDrag(block, handle, container);

      container.appendChild(block);

      const setsContainer = document.getElementById(`sets-${sid}`);
      // apri di default la prima serie non ancora completata; se sono tutte
      // fatte, restano tutte chiuse
      let firstTodo = sets.findIndex(s => !this._done.has(s.id));
      sets.forEach((set, si) => {
        const prevSet = prevSets[si] || null;
        setsContainer.appendChild(this.buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax, sets.length, si === firstTodo));
      });
    });
    this.refreshAllDone();
  },

  // Applica un patch a TUTTE le serie dell'esercizio (la tecnica vive su ogni serie)
  applyTechToSets(exName, patch) {
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    sets.forEach(s => Object.assign(s, patch));
    return sets;
  },

  // ═══ TECNICHE DI INTENSITÀ — dentro ogni esercizio (bottone a tendina) ═══
  // I campi (tecnica/cadenza/recupero/info) vivono sulle serie dell'esercizio.
  // "Gruppo" lega 2+ esercizi in un superset.

  // Altri esercizi nello stesso superset (per indicare "in superset con …")
  supersetPartners(exName) {
    const grouped = this.groupByExercise(this.exercises);
    const g = (grouped[exName]?.[0] || {}).gruppo;
    if (!g) return [];
    return Object.keys(grouped).filter(n => n !== exName && (grouped[n][0] || {}).gruppo === g);
  },

  // Contenuto della tendina (bottone + box) per un esercizio
  exTechInnerHTML(exName, ex) {
    const partners = this.supersetPartners(exName);
    const sup = ex.gruppo
      ? `<span class="ex-tech-sup"><i class="ti ti-link"></i>Superset${partners.length ? " con " + partners.join(", ") : ""}</span>`
      : "";
    const tecLbl = (ex.tecnica && ex.tecnica.length) ? `<span>${ex.tecnica.join(", ")}</span>` : "";
    const summary = (sup || tecLbl)
      ? `<span class="ex-tech-summary">${sup}${tecLbl}</span>`
      : `<span class="ex-tech-summary muted">imposta…</span>`;
    return `
      <button type="button" class="ex-tech-toggle" onclick="Session.toggleTechBox('${exName}', this)">
        <i class="ti ti-bolt"></i><span class="ex-tech-label">Tecnica di intensità</span>
        ${summary}
        <i class="ti ti-chevron-down ex-tech-chev"></i>
      </button>
      ${this.exTechBoxHTML(exName, ex)}`;
  },

  exTechBoxHTML(exName, ex) {
    const active = ex.tecnica || [];
    const chips = CONFIG.TECNICHE.map(t => {
      const on = active.includes(t.name);
      return `<button type="button" class="tech-chip${on ? " on" : ""}" style="${on ? `--tc:${t.color}` : ""}"
        onclick="event.stopPropagation();Session.setExTec('${exName}','${t.name}')">${t.name}</button>`;
    }).join("");
    const grouped = this.groupByExercise(this.exercises);
    const others  = Object.keys(grouped).filter(n => n !== exName);
    const corr = others.map(n => {
      const og    = (grouped[n][0] || {}).gruppo || "";
      const same  = ex.gruppo && og === ex.gruppo;
      const other = og && og !== ex.gruppo;   // già in un altro superset
      return `<label class="tg-ex${other ? " off" : ""}${same ? " on" : ""}">
        <input type="checkbox" ${same ? "checked" : ""} ${other ? "disabled" : ""}
          onchange="event.stopPropagation();Session.correlate('${exName}','${n}',this.checked)"><span>${n}</span></label>`;
    }).join("");
    return `
      <div class="ex-tech-box" onclick="event.stopPropagation()">
        <div class="tg-lbl">Tecnica</div>
        <div class="tech-chips">${chips}</div>
        <div class="tech-fields">
          <label class="tech-field"><span>Cadenza</span>
            <input class="tech-in" type="text" placeholder="3-1-1" value="${ex.cadenza || ""}"
              onchange="Session.setExField('${exName}','cadenza',this.value)"></label>
        </div>
        <div class="tg-lbl">Info tecnica</div>
        <textarea class="tech-in tg-info" rows="2" placeholder="Es. drop al 70%, 2 cali; eccentrica 3s..."
          onchange="Session.setExField('${exName}','info',this.value)">${ex.info || ""}</textarea>
        <div class="tg-lbl">Superset — raggruppa con</div>
        <div class="tg-exs">${corr || '<span class="tech-empty">Nessun altro esercizio</span>'}</div>
      </div>`;
  },

  toggleTechBox(exName, btn) {
    const wrap = btn.closest(".ex-tech");
    if (wrap) wrap.classList.toggle("open");
  },

  setExTec(exName, name) {
    const cur = new Set((this.groupByExercise(this.exercises)[exName][0] || {}).tecnica || []);
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    this.applyTechToSets(exName, { tecnica: [...cur] });
    this.saveTech(exName);
    this.refreshExTech(exName);
  },

  setExField(exName, field, val) {
    const value = (field === "recupero") ? (val === "" ? null : Number(val)) : val;
    this.applyTechToSets(exName, { [field]: value });
    this.saveTech(exName);
    this.refreshExTech(exName);
  },

  // Forma/disfa il superset correlando un altro esercizio
  correlate(exName, other, checked) {
    const grouped = this.groupByExercise(this.exercises);
    const ex = grouped[exName][0] || {};
    if (checked) {
      const g = ex.gruppo || (grouped[other][0] || {}).gruppo || this.nextFreeGroup();
      this.applyTechToSets(exName, { gruppo: g }); this.saveTech(exName);
      this.applyTechToSets(other,  { gruppo: g }); this.saveTech(other);
      // sposta l'esercizio correlato SUBITO DOPO quello di partenza
      this.reorderAfter(other, exName);
    } else {
      this.applyTechToSets(other, { gruppo: "" }); this.saveTech(other);
      // se l'esercizio resta solo nel gruppo, sciogli anche lui
      if (this.countInGroup(ex.gruppo) < 2) { this.applyTechToSets(exName, { gruppo: "" }); this.saveTech(exName); }
    }
    this.refreshAllTech();
  },

  // Sposta moveName subito dopo afterName, nell'ordine logico e nel DOM
  reorderAfter(moveName, afterName) {
    if (moveName === afterName) return;
    const order = this.exOrder.filter(n => n !== moveName);
    const idx = order.indexOf(afterName);
    if (idx === -1) order.push(moveName);
    else order.splice(idx + 1, 0, moveName);
    this.exOrder = order;
    // Spostamento nel DOM: confronto dataset.ex (niente selettori, robusto con
    // nomi che contengono spazi o caratteri speciali)
    const container = document.getElementById("exercises-container");
    if (container) {
      const blocks = [...container.querySelectorAll(".ex-block")];
      const moveBlock  = blocks.find(b => b.dataset.ex === moveName);
      const afterBlock = blocks.find(b => b.dataset.ex === afterName);
      if (moveBlock && afterBlock) container.insertBefore(moveBlock, afterBlock.nextSibling);
    }
    this.saveOrder();
    this.renumberBlocks();
  },

  nextFreeGroup() {
    const used = new Set(Object.values(this.groupByExercise(this.exercises)).map(a => (a[0] || {}).gruppo).filter(Boolean));
    return CONFIG.GRUPPI.find(g => !used.has(g)) || "A";
  },

  countInGroup(g) {
    if (!g) return 0;
    return Object.values(this.groupByExercise(this.exercises)).filter(a => (a[0] || {}).gruppo === g).length;
  },

  // Ridisegna la tendina di un esercizio mantenendo lo stato aperto/chiuso
  refreshExTech(exName) {
    const wrap = document.getElementById(`extech-${this.sanitize(exName)}`);
    if (!wrap) return;
    const ex = (this.groupByExercise(this.exercises)[exName] || [])[0] || {};
    const wasOpen = wrap.classList.contains("open");
    wrap.innerHTML = this.exTechInnerHTML(exName, ex);
    wrap.classList.toggle("has-tech", !!((ex.tecnica && ex.tecnica.length) || ex.gruppo));
    if (wasOpen) wrap.classList.add("open");
  },

  refreshAllTech() {
    Object.keys(this.groupByExercise(this.exercises)).forEach(n => this.refreshExTech(n));
  },

  saveTech(exName) {
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    if (!sets.length) return;
    const ex = sets[0];
    const tech = {
      tecnica:  ex.tecnica || [],
      cadenza:  ex.cadenza || "",
      gruppo:   ex.gruppo || "",
      recupero: ex.recupero ?? null,
      info:     ex.info || "",
    };
    this.setSyncState("saving");
    clearTimeout(this._saveTimers["tech_" + exName]);
    this._saveTimers["tech_" + exName] = setTimeout(async () => {
      try {
        await Promise.all(sets.map(s => API.updateExerciseTech(s.id, tech)));
        this.setSyncState("saved");
        this.syncSedutaMeta(exName);   // riflette la tecnica sulla scheda
      } catch(e) { console.error("saveTech:", e); this.setSyncState("error"); }
    }, 800);
  },

  toggleEx(hd, event) {
    if (event && (event.target.closest(".drag-handle") || event.target.closest("input"))) return;
    // Se è appena avvenuto un drag, non fare il toggle
    if (this._justDragged) { this._justDragged = false; return; }
    const block = hd.parentElement;
    const willOpen = block.classList.contains("collapsed");
    if (willOpen) {
      // FOCUS: apri solo questo, chiudi e "spegni" (grigio) tutti gli altri
      document.querySelectorAll("#exercises-container .ex-block").forEach(b => {
        b.classList.add("collapsed");
        b.classList.toggle("ex-focused", b === block);
        b.classList.toggle("ex-dimmed", b !== block);
      });
      block.classList.remove("collapsed");
      this.scrollToBlock(block);
    } else {
      // chiudo l'esercizio aperto → niente più focus, tutti tornano normali
      document.querySelectorAll("#exercises-container .ex-block").forEach(b => {
        b.classList.remove("ex-focused", "ex-dimmed");
      });
      block.classList.add("collapsed");
    }
  },

  // Scorre fino al blocco tenendo conto dell'header sticky in cima
  scrollToBlock(block) {
    requestAnimationFrame(() => {
      const header = document.querySelector(".sess-header");
      const offset = (header ? header.offsetHeight : 0) + 10;
      const y = block.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    });
  },

  // Vista compatta delle note della sessione precedente (chiusa di default)
  prevNotesHTML(prevSets) {
    const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const notes = (prevSets || [])
      .map((s, i) => {
        const m = (s.name || "").split(" – ").pop().match(/S(\d+)/);
        return { n: m ? parseInt(m[1]) : i + 1, t: (s.note || "").trim() };
      })
      .filter(o => o.t);
    if (!notes.length) return "";
    const body = notes.map(o => `<div class="pn-line"><b>S${o.n}</b><span>${esc(o.t)}</span></div>`).join("");
    return `<div class="prev-notes">
      <button type="button" class="prev-notes-toggle" onclick="Session.togglePrevNotes(this, event)">
        <i class="ti ti-notes"></i><span>Note scorsa volta</span><em>${notes.length}</em>
        <i class="ti ti-chevron-down pn-chev"></i>
      </button>
      <div class="prev-notes-body">${body}</div>
    </div>`;
  },
  togglePrevNotes(btn, event) {
    if (event) event.stopPropagation();
    const wrap = btn.closest(".prev-notes");
    if (wrap) wrap.classList.toggle("open");
  },

  // Aggiorna lo stato "completato" di un esercizio: se tutte le serie sono fatte
  // il blocco si schiarisce/rimpicciolisce con una spunta, così l'occhio cade
  // subito su quelli ancora da fare.
  refreshExDone(exName) {
    const sid = this.sanitize(exName);
    const block = [...document.querySelectorAll("#exercises-container .ex-block")]
      .find(b => b.dataset.ex === exName);
    if (!block) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    // Durante l'allenamento: completato = tutte le serie con "Serie fatta" (_done).
    // Su una sessione GIÀ SALVATA (done): completato = ha dati reali (rep registrate),
    // perché il flag locale "_done" non c'è quando la riapri (magari da altro device).
    const doneViaTracking = sets.length > 0 && sets.every(s => this._done.has(s.id));
    const doneViaData     = this.sessionDone && sets.some(s => (s.reps || 0) > 0);
    block.classList.toggle("ex-done", doneViaTracking || doneViaData);
  },

  refreshAllDone() {
    Object.keys(this.groupByExercise(this.exercises)).forEach(n => this.refreshExDone(n));
  },

  // #batch2 — quando l'ULTIMA serie di un esercizio viene segnata fatta, chiudi
  // la sua tendina e apri automaticamente quella dell'esercizio successivo
  // (stesso comportamento del tap manuale su un header, ma automatico). Solo
  // se l'esercizio corrente era quello aperto (focus mode) — non forzare il
  // focus su chi sta guardando qualcos'altro.
  autoAdvanceExercise(exName) {
    const blocks = [...document.querySelectorAll("#exercises-container .ex-block")];
    const block = blocks.find(b => b.dataset.ex === exName);
    if (!block || block.classList.contains("collapsed")) return;
    const idx = this.exOrder.indexOf(exName);
    const nextName = idx >= 0 ? this.exOrder[idx + 1] : null;
    const nextBlock = nextName ? blocks.find(b => b.dataset.ex === nextName) : null;
    if (nextBlock) {
      blocks.forEach(b => {
        b.classList.add("collapsed");
        b.classList.toggle("ex-focused", b === nextBlock);
        b.classList.toggle("ex-dimmed", b !== nextBlock);
      });
      nextBlock.classList.remove("collapsed");
      this.scrollToBlock(nextBlock);
      // Ri-analizza col cervello IA per l'esercizio in cui stai entrando: ora
      // include quello appena finito nel "fatto oggi" — consiglio aggiornato
      // con l'informazione più fresca possibile, non quella di inizio sessione.
      this.loadAIAdvice([nextName]);
    } else {
      // ultimo esercizio della scheda: chiudi e torna alla vista normale
      blocks.forEach(b => b.classList.remove("ex-focused", "ex-dimmed"));
      block.classList.add("collapsed");
    }
  },

  renumberBlocks() {
    document.querySelectorAll(".ex-block").forEach((b, i) => {
      const num = b.querySelector(".ex-num");
      if (num) num.textContent = i + 1;
    });
  },

  // Aggiorna il contatore di serie nell'header di un esercizio
  updateSetCount(exName) {
    const n = (this.groupByExercise(this.exercises)[exName] || []).length;
    const el = document.getElementById(`setcount-${this.sanitize(exName)}`);
    if (el) el.innerHTML = `${n}<small>serie</small>`;
  },

  // ─── DRAG con long-press (touch) e mouse (desktop) ───
  attachDrag(block, handle, container) {
    const self = this;
    let pressTimer = null;
    let active = false;
    let startY = 0;
    let blockStartTop = 0;
    let placeholder = null;
    let scrollEl = null;
    let rafScroll = null;
    let lastClientY = 0;

    const getEvY = e => e.touches ? e.touches[0].clientY : e.clientY;

    // Trova l'elemento scrollabile (main su desktop, window su mobile)
    function getScroller() {
      const main = document.getElementById("main");
      if (main && main.scrollHeight > main.clientHeight) return main;
      return document.scrollingElement || document.documentElement;
    }

    function begin(e) {
      if (self.viewMode) return;   // in sola lettura gli esercizi restano fissi
      active = true;
      scrollEl = getScroller();
      const rect = block.getBoundingClientRect();
      blockStartTop = rect.top;

      block.classList.add("dragging");
      if (navigator.vibrate) navigator.vibrate(25);

      // Placeholder che occupa lo spazio
      placeholder = document.createElement("div");
      placeholder.className = "drag-placeholder";
      placeholder.style.height = block.offsetHeight + "px";
      block.parentNode.insertBefore(placeholder, block.nextSibling);

      // Blocco "staccato" che segue il dito
      block.style.position = "fixed";
      block.style.left = rect.left + "px";
      block.style.top = rect.top + "px";
      block.style.width = rect.width + "px";
      block.style.zIndex = "1000";
      block.style.pointerEvents = "none";

      startAutoScroll();
    }

    function move(e) {
      if (!active) return;
      if (e.cancelable) e.preventDefault();
      const y = getEvY(e);
      lastClientY = y;
      const dy = y - startY;
      block.style.top = (blockStartTop + dy) + "px";
      reorder(y);
    }

    function reorder(y) {
      const siblings = [...container.querySelectorAll(".ex-block:not(.dragging)")];
      const blockMidY = y; // usiamo il dito come riferimento

      let placed = false;
      for (const other of siblings) {
        const rect = other.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (blockMidY < mid) {
          if (placeholder.nextSibling !== other || placeholder.previousSibling === other) {
            animateReposition(() => container.insertBefore(placeholder, other));
          }
          placed = true;
          break;
        }
      }
      if (!placed) {
        // va in fondo
        if (container.lastElementChild !== placeholder) {
          animateReposition(() => container.appendChild(placeholder));
        }
      }
    }

    // FLIP animation: anima lo spostamento dei fratelli
    function animateReposition(mutate) {
      const movers = [...container.querySelectorAll(".ex-block:not(.dragging)")];
      const first = new Map();
      movers.forEach(m => first.set(m, m.getBoundingClientRect().top));
      mutate();
      movers.forEach(m => {
        const last = m.getBoundingClientRect().top;
        const delta = first.get(m) - last;
        if (delta) {
          m.style.transition = "none";
          m.style.transform = `translateY(${delta}px)`;
          requestAnimationFrame(() => {
            m.style.transition = "transform .18s ease";
            m.style.transform = "";
          });
        }
      });
    }

    // Auto-scroll quando il dito è vicino ai bordi
    function startAutoScroll() {
      cancelAnimationFrame(rafScroll);
      const step = () => {
        if (!active) return;
        const margin = 90;
        const vh = window.innerHeight;
        let speed = 0;
        if (lastClientY < margin) speed = -Math.ceil((margin - lastClientY) / 8);
        else if (lastClientY > vh - margin) speed = Math.ceil((lastClientY - (vh - margin)) / 8);
        if (speed !== 0 && scrollEl) {
          scrollEl.scrollBy(0, speed);
          blockStartTop -= speed; // compensa così il blocco resta sotto il dito
          block.style.top = (blockStartTop + (lastClientY - startY)) + "px";
          reorder(lastClientY);
        }
        rafScroll = requestAnimationFrame(step);
      };
      rafScroll = requestAnimationFrame(step);
    }

    function end() {
      clearTimeout(pressTimer);
      cancelAnimationFrame(rafScroll);
      if (!active) { cleanupListeners(); return; }
      active = false;

      // Pulisci stile dei movers
      container.querySelectorAll(".ex-block").forEach(m => { m.style.transition = ""; m.style.transform = ""; });

      // Rimetti il blocco nel flusso, dove c'è il placeholder
      block.classList.remove("dragging");
      block.style.position = "";
      block.style.left = "";
      block.style.top = "";
      block.style.width = "";
      block.style.zIndex = "";
      block.style.pointerEvents = "";
      block.style.transform = "";

      if (placeholder) {
        container.insertBefore(block, placeholder);
        placeholder.remove();
        placeholder = null;
      }

      self.exOrder = [...container.querySelectorAll(".ex-block")].map(b => b.dataset.ex);
      self.saveOrder();
      self.renumberBlocks();
      self._justDragged = true;
      setTimeout(() => { self._justDragged = false; }, 50);
      if (navigator.vibrate) navigator.vibrate(12);
      cleanupListeners();
    }

    function cleanupListeners() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    }

    // Verifica se il punto toccato è un controllo interattivo (allora NON parte il drag)
    function isInteractive(target) {
      return target.closest("button, input, textarea, select, a, .adj, .rm-set-btn, .add-set-btn, .note-inp, .rr-in-sm, .ex-tech, .stepper-val, .set-card");
    }

    let touchStartX = 0;

    // TOUCH — long press 200ms su QUALSIASI punto della card (tranne controlli)
    block.addEventListener("touchstart", e => {
      if (isInteractive(e.target)) return; // lascia funzionare bottoni/input
      startY = getEvY(e);
      touchStartX = e.touches[0].clientX;
      lastClientY = startY;
      pressTimer = setTimeout(() => {
        begin(e);
        document.addEventListener("touchmove", move, { passive: false });
        document.addEventListener("touchend", end);
        document.addEventListener("touchcancel", end);
      }, 200);
    }, { passive: true });

    block.addEventListener("touchend", () => clearTimeout(pressTimer));
    block.addEventListener("touchmove", e => {
      if (active) return;
      // Se muove il dito prima del long-press → sta scrollando, annulla
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      const dy = Math.abs(getEvY(e) - startY);
      if (dx > 10 || dy > 10) clearTimeout(pressTimer);
    }, { passive: true });

    // MOUSE (desktop) — sulla manina parte subito; sul resto della card serve long-press 200ms
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      startY = getEvY(e);
      lastClientY = startY;
      begin(e);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
    });

    block.addEventListener("mousedown", e => {
      if (isInteractive(e.target) || e.target.closest(".drag-handle")) return;
      startY = getEvY(e);
      lastClientY = startY;
      pressTimer = setTimeout(() => {
        begin(e);
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", end);
      }, 200);
      const cancelPress = () => { clearTimeout(pressTimer); document.removeEventListener("mouseup", cancelPress); };
      document.addEventListener("mouseup", cancelPress);
    });
  },

  // ═══ SUGGERIMENTO DI PROGRESSIONE (doppia progressione) ═══════════════════
  // Prima aggiungi rep dentro il range; raggiunto il top del range, aumenti il
  // peso e riparti dal basso. Guarda la seduta precedente (prevSets).
  // #5 PT scientifico — RAMPA di RISCALDAMENTO. Onestà scientifica: la
  // potenziazione (PAP) ha effetto piccolo e riguarda la potenza ESPLOSIVA
  // (salto/sprint), NON il tipico lavoro in palestra per forza/ipertrofia. La
  // rampa serve ad arrivare al peso di lavoro in SICUREZZA e a tarare tecnica e
  // sensazioni del giorno — non ad "aumentare la performance". Solo per compound
  // pesanti; isolamento e macchine leggere non ne hanno bisogno.
  warmupRampHTML(exName, W) {
    try {
      if (this._suppressWarmup) return "";   // oggi è scarico o dolore: niente rampa
      if (typeof Volume === "undefined" || !Volume.pattern) return "";
      const pat = Volume.pattern(exName);
      if (!["squat", "hinge", "push", "pull"].includes(pat)) return "";   // no isolamento
      W = Math.round(W || 0);
      if (W < 30) return "";   // troppo leggero / corpo libero: la rampa non serve
      // Frazioni del peso di lavoro; più step quanto più è pesante il compound.
      const plan = W >= 120 ? [[0.4, 5], [0.55, 4], [0.7, 3], [0.82, 2], [0.92, 1]]
                 : W >= 80  ? [[0.4, 5], [0.6, 4], [0.75, 3], [0.88, 2]]
                 :            [[0.5, 5], [0.7, 3], [0.85, 2]];
      const round = kg => W >= 40 ? Math.round(kg / 2.5) * 2.5 : Math.round(kg);
      const steps = plan.map(([f, reps]) => ({ kg: round(W * f), reps }))
        .filter((s, i, a) => s.kg > 0 && (i === 0 || s.kg > a[i - 1].kg));  // niente step doppioni
      if (!steps.length) return "";
      const chips = steps.map(s => `<span class="wu-step"><b>${U.fmt(s.kg)}</b> kg × ${s.reps}</span>`).join("");
      return `
        <details class="warmup">
          <summary><i class="ti ti-flame"></i> Riscaldamento <span class="wu-hint">arriva ai ${U.fmt(W)} kg in sicurezza</span></summary>
          <div class="wu-steps">${chips}<span class="wu-work">→ poi il lavoro</span></div>
          <div class="wu-note">Serve a scaldarti e a testare come ti senti oggi, non ad aumentare la forza. Recupera poco tra queste (30–60s).</div>
        </details>`;
    } catch (e) { return ""; }
  },

  progressionGoalHTML(exName, prevSets, rrMin, rrMax, rir, orderShift, sameMuscle) {
    // #5 — se oggi l'obiettivo è scarico o dolore, la rampa di riscaldamento
    // (che punta all'ultimo peso di lavoro) va nascosta: contraddirebbe il "vai
    // leggero". Il flag lo legge warmupRampHTML, chiamata subito dopo nel render.
    this._suppressWarmup = false;
    const rirStr = (rir != null && rir !== "") ? ` a RIR ${rir}` : "";
    const goal = (main, sub, tone, data) => {
      const ic = tone === "warn" ? "ti-alert-triangle" : tone === "hold" ? "ti-refresh" : "ti-target";
      return `
      <div class="today-goal tg-${tone || "go"}">
        <i class="ti ${ic}"></i>
        <div class="tg-txt">
          <span class="tg-lbl">Obiettivo di oggi</span>
          <span class="tg-main">${main}</span>
          ${sub ? `<span class="tg-sub">${sub}</span>` : ""}
          ${data ? `<span class="tg-data"><i class="ti ti-chart-dots"></i>${data}</span>` : ""}
        </div>
      </div>`;
    };

    const stats = (this._exStats && this._exStats[exName]) || null;

    // ── Fallback: storico non ancora caricato → usa la sola seduta precedente ──
    if (!stats || !stats.length) {
      const real = (prevSets || []).filter(s => (s.reps || 0) > 0);
      if (!real.length) return goal(`Trova un peso per <b>${rrMin}–${rrMax}</b> rep${rirStr}`, "Prima volta: parti e registra i numeri", "go");
      let top = real[0];
      real.forEach(s => { if ((s.kg || 0) > (top.kg || 0) || ((s.kg || 0) === (top.kg || 0) && s.reps > top.reps)) top = s; });
      const bw = (top.kg || 0) === 0;
      if (top.reps >= rrMax) return bw
        ? goal(`Punta <b>${top.reps + 1}</b> rep`, `Sei al top del range (${top.reps})`, "go")
        : goal(`Aumenta il peso · riparti da <b>${rrMin}</b> rep${rirStr}`, `La volta scorsa hai chiuso: ${U.fmt(top.kg)}kg × ${top.reps}`, "go");
      const tg = Math.min(top.reps + 1, rrMax);
      return bw
        ? goal(`Punta <b>${tg}</b> rep`, `+1 rep verso il top (${rrMax})`, "go")
        : goal(`Resta a <b>${U.fmt(top.kg)} kg</b> · punta <b>${tg}</b> rep${rirStr}`, `+1 rep verso il top del range (${rrMax})`, "go");
    }

    // ── Analisi ricca: andamento su più sedute + note + contesto ──
    const n = stats.length;
    const last = stats[n - 1], prev = stats[n - 2] || null, prev2 = stats[n - 3] || null;
    const isBW = (last.topKg || 0) === 0;
    // Note dell'esercizio + NOTA DELLA SESSIONE di quel giorno (entrambe pesano)
    const nl = ((last.notes || []).join(" · ") + " · " + (last.sessNote || "")).toLowerCase();
    // Intoppo segnalato la scorsa volta (macchinario occupato, poco tempo, ecc.)
    const issue = /(occupat|poco tempo|di fretta|\bfretta\b|saltat|interrott|affollat|\bcoda\b|niente tempo|senza tempo|riscaldament|non riscaldat)/.test(nl);
    // #3 — Macchinario OCCUPATO/affollato la scorsa volta: proponi un sostituto
    // equivalente tra gli esercizi che l'utente già conosce, così la prossima
    // volta non salta l'esercizio. Segnale più stretto del generico "intoppo".
    const occupied = /(occupat|affollat|\bcoda\b|\bfila\b|tutte prese|non liber|era pres[oa])/.test(nl);
    const subAlt = occupied ? this._subFor(exName) : null;
    const subNote = subAlt
      ? ` La scorsa la macchina era occupata: se ricapita, un ${subAlt.level === "A" ? "ottimo" : "buon"} sostituto è <b>${subAlt.name}</b> (stesso lavoro).`
      : "";
    // #3 — Esercizio spostato di posizione rispetto alla sessione scorsa: se ora
    // arriva più tardi nella sessione, un calo può dipendere dalla fatica
    // accumulata di prima, non dall'esercizio in sé.
    const movedLater = orderShift && orderShift.laterThanUsual;
    const movedEarlier = orderShift && !orderShift.laterThanUsual;
    const shiftNote = movedLater
      ? " Oggi lo fai più avanti nella sessione del solito: un po' di fatica in più è normale."
      : (movedEarlier ? " Oggi lo fai prima del solito nella sessione: più fresco, meglio così." : "");
    // #5 — Diretto vs indiretto nella stessa seduta: se un altro esercizio ha già
    // colpito DIRETTAMENTE lo stesso muscolo prima nella sessione di oggi, la
    // fatica locale è già alta: un calo qui è normale, non un segnale di stallo.
    const muscleNote = sameMuscle
      ? ` Hai già allenato ${sameMuscle.muscle} direttamente con ${sameMuscle.names[sameMuscle.names.length - 1]} prima oggi: un po' di fatica locale è normale.`
      : "";
    // #4 PT scientifico — DOLORE a SEMAFORO (Cook & Purdam: la patologia del
    // tendine è un continuum, il load management è lo strumento clinico). Da
    // rilevamento binario a 3 livelli dedotti dalle parole:
    //   0 nessuno · 1 lieve/🟢 (fastidio, indolenzimento) · 2 moderato/🟡
    //   (dolore, contrattura) · 3 severo/🔴 (infortunio, dolore forte/acuto).
    // Confini di parola: "male" non matcha "normale", "dura" non "durata".
    const painLevel = (txt) => {
      if (!txt) return 0;
      const any = /(dolor|fastidi|infortun|pizzic|contrattur|strapp|stiram|tendinit|acciacc|infiamm|indolenz|lesion)\w*|\bfitt[ae]\b|\bmale\b|\bmal\s+di\b|\btirone\b/.test(txt);
      if (!any) return 0;
      if (/(infortun|strapp|stiram|tendinit|infiamm|lesion)\w*|dolore (fort|acut|inten|parecc|tant)|fort[ei] dolor|\bacut[oi]\b|non riesc|bloccat|gonfi/.test(txt)) return 3;
      const mild = /un po'?\s+(di\s+)?(fastidi|dolor|tir)|legger[oa]\s+(fastidi|dolor|tension)|solo\s+(un\s+)?fastidi|\blieve\b|leggermente|indolenz|inizial/.test(txt);
      if (mild && !/fort|acut|intens/.test(txt)) return 1;
      return 2;
    };
    // Serie storica del dolore per QUESTO esercizio (dalle note già in _exStats):
    // dolore che CALA nel tempo = buon adattamento; che SALE = sovraccarico.
    const painSeries = stats.map(g => painLevel(((g.notes || []).join(" ") + " " + (g.sessNote || "")).toLowerCase()));
    const curPain  = painSeries[painSeries.length - 1] || 0;
    const prevPain = painSeries[painSeries.length - 2] || 0;
    const pain       = curPain > 0;
    const painPersist = curPain > 0 && prevPain > 0;          // torna da ≥2 sedute
    // Dolore che CALA rispetto alla scorsa seduta = buon adattamento. Il caso
    // opposto (dolore che aumenta/persiste) è già gestito, più severamente,
    // dall'escalation a rosso su painPersist qui sotto.
    const painEasing  = prevPain > 0 && curPain > 0 && curPain < prevPain;
    const easy = /(facil|comod)\w*|\blegger[oa]\b|\bscaric\w*|troppo poco/.test(nl);
    const hard = /(cediment|difficil|duriss|pesant|faticos|soffert|sudat|fallit|grind|tost)\w*|\bdur[ae]\b|\bmort[oa]\b|non ce la|al massimo|al limite/.test(nl);
    const noteSnip = (() => {
      const t = (last.notes || []).join(" · ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return t.length > 62 ? t.slice(0, 60) + "…" : t;
    })();

    // ── SCORE ANCORATO AL REP RANGE (fondamentale) ──
    // Le rep OLTRE il top del range non contano di più: sono "peso troppo
    // leggero". Cappiamo le rep a rrMax nel calcolo dell'1RM stimato, così
    // 50kg×16 (range 8–10) vale come 50kg×10, e passare a 57kg×9 risulta una
    // PROGRESSIONE (sei rientrato nel range con più peso), non un calo.
    const capE1 = (kg, reps) => { const r = Math.min(reps || 0, rrMax); return (kg > 0) ? kg * (1 + r / 30) : r; };
    const ce = g => capE1(g.topKg, g.topReps);
    const lastE = ce(last), prevE = prev ? ce(prev) : 0, prev2E = prev2 ? ce(prev2) : 0;

    const tol = Math.max(0.5, lastE * 0.02);
    let improved = prev ? lastE > prevE + tol : true;
    let declined = prev ? lastE < prevE - tol : false;
    // Aumento di peso restando dentro il range (≥ fondo) = progressione, MAI calo.
    const weightUp = prev && (last.topKg || 0) > (prev.topKg || 0);
    if (weightUp && last.topReps >= rrMin) { improved = true; declined = false; }
    const sustainedDecline = declined && prev2 && prevE <= prev2E + tol;
    const atTop = last.topReps >= rrMax;
    const target = Math.min(last.topReps + 1, rrMax);
    const sysAdd = this._systemicDown ? " Anche altri esercizi sono in calo: occhio a recupero, sonno e alimentazione." : "";
    // #batch2 — il sonno di stanotte, quando è scarso, dà contesto onesto a un
    // calo/plateau (stessa soglia del semaforo recovery in home: HRV<45 o <6h =
    // netto, <7h = moderato). Solo contesto: non cambia le soglie di scarico.
    const sl = this._sleepInfo;
    const sleepNote = !sl ? "" : (sl.level === "rosso"
      ? ` Stanotte hai dormito poco${sl.ore != null ? ` (${U.fmt(sl.ore)}h)` : ""}${sl.hrv ? `, HRV ${sl.hrv}ms` : ""}: oggi potresti sentirti più stanco del solito, non è detto sia un passo indietro.`
      : (sl.level === "giallo" ? ` Hai dormito meno del solito stanotte: tienine conto oggi.` : ""));
    // Doppia progressione: si sale di peso quando TUTTE le serie chiudono il top.
    const setsArr    = last.sets || [];
    const atTopCount = setsArr.filter(s => s.reps >= rrMax).length;
    const allAtTop   = setsArr.length > 0 && atTopCount === setsArr.length;
    const prevSetsArr = (prev && prev.sets) || [];
    const twoForTwo  = allAtTop && prevSetsArr.length > 0 && prevSetsArr.every(s => s.reps >= rrMax);
    const gapDays = Math.round((Date.now() - new Date(last.date).getTime()) / 86400000);

    // ── METRICHE OGGETTIVE: trend sull'1RM stimato CAPPATO al range ──
    const win = stats.slice(-5), m = win.length;
    // #batch2 raffinamento 2 — soglia di scarico in giorni SCALATA sull'esperienza
    // (proxy: sedute totali storiche su QUESTO esercizio, `n`). Chi è ancora
    // all'inizio raramente accumula fatica vera da richiedere uno scarico
    // (Helms/Israetel: i principianti possono arrivare a 12-16+ settimane senza
    // bisogno) — soglia più lunga invece di applicare 14 giorni piatti a tutti.
    const deloadSpanDays = n < 6 ? 42 : (n < 12 ? 21 : 14);
    // #1 SCARICO — arco di CALENDARIO coperto dalla finestra (non "N sedute").
    // 4 sedute possono essere 4 giorni o 4 settimane: un calo va confermato nel
    // TEMPO. Consenso ECSS/ACSM (Meeusen): un calo che rientra in GIORNI è
    // Functional Overreaching (normale); il segnale vero (NFOR) dura SETTIMANE.
    const spanDays = m >= 2 ? Math.round((new Date(win[m - 1].date) - new Date(win[0].date)) / 86400000) : 0;
    // #1 SCARICO — falso positivo da fatica acuta: se lo STESSO muscolo è stato
    // allenato a cedimento (<48h prima dell'ultima seduta), un calo è
    // FISIOLOGICAMENTE ATTESO (recupero neuromuscolare fino a 48h) — non prova
    // di stanchezza accumulata. Va escluso dal trigger di scarico.
    const acuteFatigue = this._recentSameMuscleFatigue(exName, last.date);
    let slopePct = 0;
    if (m >= 2) {
      const xs = win.map((_, i) => i), ys = win.map(g => ce(g));
      const mx = xs.reduce((a, b) => a + b, 0) / m, my = ys.reduce((a, b) => a + b, 0) / m;
      let num = 0, den = 0;
      xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) * (x - mx); });
      const slope = den > 0 ? num / den : 0;
      slopePct = my > 0 ? Math.round(slope / my * 1000) / 10 : 0;
    }
    // Plateau: sedute dalla MIGLIOR prestazione (score cappato), ">" stretto.
    let bestIdx = 0;
    stats.forEach((g, i) => { if (ce(g) > ce(stats[bestIdx])) bestIdx = i; });
    const sinceBest = n - 1 - bestIdx;
    // Drop-off intra-seduta: crollo di rep tra la prima e l'ultima serie = fatica
    // dentro la sessione (recupero corto o carico alto sulle prime serie)
    const dropoff = setsArr.length >= 2 ? (setsArr[0].reps - setsArr[setsArr.length - 1].reps) : 0;
    // Incremento consigliato quando si sale (ACSM: 2-10%; meno per muscoli piccoli)
    let incr = "2–5%";
    try {
      if (typeof Volume !== "undefined") {
        const mus = Volume.musclesFor(exName);
        const primary = Object.keys(mus).find(k => mus[k] >= 1);
        if (["Petto", "Dorso", "Quadricipiti", "Femorali", "Glutei"].includes(primary)) incr = "5–10%";
      }
    } catch (e) {}
    // #2 PT scientifico — ZONA dedotta dal REP-RANGE che l'utente GIÀ imposta
    // (niente campo nuovo: il range esprime l'intento). L'unica distinzione che
    // cambia davvero la programmazione è FORZA (pesante, poche reps, recupero
    // lungo — specificità); ipertrofia (load-independent vicino al cedimento,
    // Schoenfeld) e resistenza si sovrappongono, quindi NON fingo differenze.
    const zone = rrMax <= 6 ? "forza" : (rrMin >= 15 ? "resist" : "ipertr");
    const zoneNote = zone === "forza"
      ? " Per la forza conta il carico e il recupero lungo (2–3 min tra le serie)."
      : (zone === "resist"
        ? " In questo range alto alleni anche l'ipertrofia, non solo la resistenza: si sovrappongono."
        : "");
    // Scetticismo RIR (meta-analisi: il RIR è sottostimato, e peggiora sopra le
    // ~12 reps). Su serie ad alte reps un "facile / ne avevo in serbo" va preso
    // con le pinze: la riserva reale è spesso minore di quella percepita.
    const highRep = rrMax >= 15 || (last.topReps || 0) > 12;
    const rirCaution = (highRep && easy)
      ? " A rep alte è facile credere di avere più margine di quanto hai: aggiungi poco, o prima aggiungi qualche rep."
      : "";
    // #batch2 raffinamento 5 — oltre le ~30 rip (non solo "range alto": qui il
    // carico stesso è quasi certamente troppo leggero) le unità motorie ad alta
    // soglia non vengono più reclutate: stimolo minimo indipendentemente dal
    // RIR dichiarato (Israetel, Nippard — convergenza multipla). Segnale
    // distinto dallo scetticismo RIR sopra: scatta anche senza nota "facile".
    const junkVolumeNote = (last.topReps || 0) > 30
      ? (isBW
        ? " Con più di 30 rip il corpo libero non basta più come stimolo: aggiungi un sovraccarico o una variante più difficile."
        : " Con più di 30 rip il carico è quasi certamente troppo leggero per uno stimolo reale: aumenta parecchio il peso, non le rep.")
      : "";
    // Riga dati oggettiva mostrata nel banner (trasparenza dell'analisi)
    const trendStr = m >= 3 ? `Forza ${slopePct > 0 ? "+" : ""}${String(slopePct).replace(".", ",")}% a seduta` : "Servono più sedute";
    const bestStr  = sinceBest === 0 ? "ultima = la migliore" : `migliore ${sinceBest} ${sinceBest === 1 ? "seduta" : "sedute"} fa`;
    const dataLine = `${trendStr} · ${bestStr}${dropoff >= 3 ? ` · −${dropoff} rep a fine esercizio` : ""}`;

    // 1) Dolore → semaforo (priorità massima). Il movimento ha un effetto
    // analgesico (EIH): per dolore lieve/moderato NON si elimina l'esercizio, si
    // resta SOTTO la soglia del dolore. Si ferma solo il dolore severo o che
    // persiste/aumenta da più sedute (segnale di sovraccarico reale).
    if (pain) {
      this._suppressWarmup = true;   // #5 — niente rampa quando c'è dolore
      const trendNote = painEasing
        ? " Rispetto alle scorse volte il fastidio è meno: probabile buon adattamento, ma non forzare."
        : "";
      // 🔴 ROSSO: severo, oppure moderato che torna da ≥2 sedute (persistente)
      if (curPain >= 3 || (curPain >= 2 && painPersist)) {
        return goal(`Fermati o vai molto leggero su questo esercizio`,
          `Avevi segnato: «${noteSnip}». ${painPersist ? "Il dolore torna da più sedute" : "Dolore importante"}: non caricare. Se dura oltre 48h o peggiora, valuta un professionista.`, "warn", dataLine);
      }
      // 🟡 GIALLO: moderato isolato → riduci il carico, resta sotto la soglia
      if (curPain >= 2) {
        return goal(`Riduci il carico e resta sotto la soglia del dolore${rirStr}`,
          `Avevi segnato: «${noteSnip}». Non serve fermarti: lavora leggero e senza sentire dolore, il movimento aiuta.${trendNote}`, "warn", dataLine);
      }
      // 🟢 VERDE: lieve → allenati controllato, senza arrivare a sentire male
      return goal(`Tieniti leggero, sotto la soglia del fastidio${rirStr}`,
        `Solo un fastidio lieve segnato: «${noteSnip}». Puoi allenarti controllato, senza arrivare a sentire male.${trendNote}`, "hold", dataLine);
    }

    // 1b) Pausa lunga su questo esercizio → rientro conservativo (tendini e
    // articolazioni recuperano più lente dei muscoli; i numeri tornano in fretta)
    if (gapDays >= 21) {
      return goal(`Riparti leggero: meno peso, senza arrivare al limite`,
        `Non fai questo esercizio da ${gapDays} giorni: oggi riprendi il ritmo, i numeri tornano in fretta.`, "warn", dataLine);
    }
    if (gapDays >= 14) {
      return goal(
        isBW ? `Rifai le <b>${last.topReps}</b> rep dell'ultima volta, senza forzare` : `Rifai <b>${U.fmt(last.topKg)} kg</b> × <b>${last.topReps}</b>, senza forzare${rirStr}`,
        `${gapDays} giorni di pausa su questo esercizio: oggi ripeti, dalla prossima si spinge.`, "hold", dataLine);
    }

    // 2) Seduta leggera SOLO con fatica accumulata vera (filosofia Israetel/Helms:
    // mai scaricare per una-due sedute storte). Serve: forza in discesa da ≥4
    // sedute su QUESTO esercizio E anche gli altri esercizi in calo.
    // #1 SCARICO — reso ANCORA più conservativo: al segnale già forte (calo su
    // ≥4 sedute su questo esercizio + sistemico) aggiungiamo che il calo deve
    // durare ≥14 GIORNI di calendario (NFOR, non semplice fatica di giornata) e
    // NON essere spiegato da un allenamento a cedimento nelle ultime 48h. La
    // letteratura (RCT) mostra che uno scarico anticipato può PEGGIORARE la
    // forza: meglio non suggerirlo mai troppo presto.
    // #batch2 raffinamento 1 — secondo segnale che RINFORZA (non sostituisce)
    // quello a giorni: ≥2 sedute consecutive senza un nuovo record (sinceBest,
    // già calcolato sopra). Convergenza forte in letteratura (Israetel, dati
    // IT): il vero trigger di scarico è l'assenza prolungata di un nuovo best,
    // non solo il calendario. Richiediamo ENTRAMBI i segnali insieme, per
    // restare coerenti con la filosofia "mai scaricare troppo presto".
    if (m >= 4 && spanDays >= deloadSpanDays && slopePct <= -2 && this._systemicDown && !acuteFatigue && sinceBest >= 2) {
      this._suppressWarmup = true;   // #5 — niente rampa in giornata di scarico
      return goal(
        `Oggi vai più leggero: togli <b>~10%</b> di peso${rirStr}`,
        `La forza cala da settimane (${spanDays} giorni, nessun nuovo record da ${sinceBest} sedute) e non solo qui: è stanchezza accumulata. Una seduta leggera oggi, poi si riparte più forti.${sleepNote}`, "warn", dataLine);
    }

    // 2a) Due sedute in calo su questo esercizio → NON tagliare il peso: ripeti
    // i numeri della tua seduta migliore e sistema le basi (sonno, cibo, recuperi)
    if (sustainedDecline) {
      const best = stats[bestIdx];
      return goal(
        isBW ? `Riprova le <b>${best.topReps}</b> rep della tua migliore` : `Riprova <b>${U.fmt(best.topKg)} kg</b> × <b>${best.topReps}</b> (la tua migliore)${rirStr}`,
        `Due sedute sotto tono su questo esercizio: prima di cambiare pesi, controlla sonno, cibo e riposo tra le serie — di solito basta quello.${sysAdd}${shiftNote}${muscleNote}${subNote}${sleepNote}`, "hold", dataLine);
    }

    // 2b) UNA seduta sotto → normale, capita a tutti: riprendi i numeri di prima
    if (declined && prev) {
      const why = issue ? ` — c'era un intoppo (poco tempo/macchinario occupato), è normale` : (hard ? " e l'avevi sentita dura" : "");
      return goal(
        isBW ? `Riprenditi le <b>${prev.topReps}</b> rep` : `Riprenditi <b>${U.fmt(prev.topKg)} kg</b> × <b>${prev.topReps}</b>${rirStr}`,
        `La scorsa è andata sotto (${isBW ? last.topReps + " rep" : U.fmt(last.topKg) + "kg × " + last.topReps})${why}: una seduta storta capita a tutti. Torna ai tuoi numeri.${shiftNote}${muscleNote}${subNote}${sleepNote}`, "go", dataLine);
    }

    // 2c) Best set SOTTO il fondo del range → carico troppo alto per il range
    if (!isBW && last.topReps < rrMin) {
      return goal(`Togli <b>~5–10%</b> di peso · torna a fare <b>${rrMin}–${rrMax}</b> rep${rirStr}`,
        `La scorsa il tuo meglio era ${last.topReps} rep a ${U.fmt(last.topKg)}kg: troppo peso. Con meno peso cresci meglio.`, "hold", dataLine);
    }

    // 3) Plateau OGGETTIVO: nessun nuovo best e1RM da ≥3 sedute e trend piatto
    if (sinceBest >= 3 && !atTop && Math.abs(slopePct) < 1.5) {
      const trick = dropoff >= 4
        ? `perdi ${dropoff} rep tra la prima e l'ultima serie: riposa di più tra le serie (2–3 min).`
        : easy
          ? "l'avevi sentito facile: prova ad aumentare un po' il peso."
          : "prova +1 rep con una mini-pausa, oppure togli un 5% e risali.";
      return goal(
        isBW ? `Fermo da ${sinceBest} sedute — punta <b>${target}</b> rep` : `Fermo a <b>${U.fmt(last.topKg)} kg</b> da ${sinceBest} sedute`,
        `Per sbloccarti: ${trick}${rirCaution}${junkVolumeNote}`, "hold", dataLine);
    }

    // 4) TUTTE le serie al top del range → si sale di peso (doppia progressione,
    // incremento ACSM: 2-10%, meno per i muscoli piccoli)
    if (allAtTop) {
      const conf = twoForTwo ? " Confermato per 2 sedute di fila." : "";
      return isBW
        ? goal(`Punta <b>${last.topReps + 1}</b> rep`, `Tutte le serie al massimo del range: aggiungi rep.${conf}${junkVolumeNote}`, "go", dataLine)
        : goal(`Aumenta il peso di <b>~${incr}</b> · riparti da <b>${rrMin}</b> rep${rirStr}`, `Hai chiuso tutte le serie a ${rrMax} rep con ${U.fmt(last.topKg)}kg${easy ? ", e le hai sentite facili" : ""}: sei pronto a salire.${conf}${zoneNote}${rirCaution}${junkVolumeNote}`, "go", dataLine);
    }

    // 4b) Solo il best set al top → prima chiudi TUTTE le serie al top, POI si sale
    if (atTop && setsArr.length > 1) {
      return isBW
        ? goal(`Porta <b>tutte</b> le serie a <b>${rrMax}</b> rep`, `${atTopCount} serie su ${setsArr.length} al massimo: chiudile tutte, poi si aumenta.`, "go", dataLine)
        : goal(`Tieni <b>${U.fmt(last.topKg)} kg</b> · porta tutte le serie a <b>${rrMax}</b> rep${rirStr}`, `${atTopCount} serie su ${setsArr.length} già al massimo: chiudile tutte, poi si sale di peso.`, "go", dataLine);
    }
    if (atTop) {
      return isBW
        ? goal(`Punta <b>${last.topReps + 1}</b> rep`, `Sei al massimo del range: aggiungi rep.`, "go", dataLine)
        : goal(`Aumenta il peso di <b>~${incr}</b> · riparti da <b>${rrMin}</b> rep${rirStr}`, `Hai chiuso ${rrMin}–${rrMax} a ${U.fmt(last.topKg)}kg${easy ? " e l'avevi sentito facile" : ""}.${zoneNote}${rirCaution}`, "go", dataLine);
    }

    // 5) Sotto il top → progressione. Non è obbligatorio salire ogni volta:
    // dopo un aumento si CONSOLIDA, e ripetere gli stessi numeri puliti è già
    // progresso (Nippard/Helms). Solo se le rep escono pulite si aggiunge.
    const restNote   = dropoff >= 4 ? ` Perdi ${dropoff} rep tra la prima e l'ultima serie: riposa un po' di più tra le serie.` : "";
    const matched    = prev && !improved && !declined;                  // stessi numeri della scorsa

    // 5a) Peso appena aumentato → consolidalo prima di spingere ancora
    if (!isBW && weightUp) {
      return goal(`Consolida i <b>${U.fmt(last.topKg)} kg</b>: rifai <b>${last.topReps}</b> rep pulite${rirStr}`,
        `Hai appena alzato il peso e ha tenuto: prima rendilo solido, poi aggiungi rep. Se escono facili, prova +1.${restNote}`, "go", dataLine);
    }
    // 5b) Stessi numeri della scorsa → va bene, è comunque progresso.
    //     Se la scorsa era DURA, l'obiettivo è rifarla più pulita, non aggiungere.
    if (matched) {
      if (hard) {
        return isBW
          ? goal(`Rifai <b>${last.topReps}</b> rep, più pulite`, `La scorsa era dura: puntala a rifarla meglio, non c'è fretta di aggiungere.${restNote}`, "go", dataLine)
          : goal(`Rifai <b>${U.fmt(last.topKg)} kg × ${last.topReps}</b>, più pulite${rirStr}`, `L'avevi sentita dura: rifalla più controllata prima di salire, non c'è fretta.${restNote}`, "go", dataLine);
      }
      return isBW
        ? goal(`Rifai <b>${last.topReps}</b> rep, o <b>+1</b> se pulite`, `Hai ripetuto i tuoi numeri: anche restare uguale con più controllo è progresso.${restNote}`, "go", dataLine)
        : goal(`Rifai <b>${U.fmt(last.topKg)} kg × ${last.topReps}</b>, o <b>+1</b> rep se pulite${rirStr}`, `Hai ripetuto i numeri della scorsa: va bene, la costanza fa crescere. Se le senti pulite, aggiungi 1 rep.${restNote}`, "go", dataLine);
    }
    // 5c) In crescita / prima volta con storico → aggiungi 1 rep
    const improvedTxt = issue ? "Sei migliorato pure con un intoppo la scorsa: oggi che è liscio, aggiungi 1 rep." : "Stai migliorando: aggiungi 1 rep.";
    const reason = improved ? `${improvedTxt}${restNote}` : (hard ? `La scorsa era dura: prima falla pulita, poi si sale.${restNote}` : `+1 rep verso il massimo del range.${restNote}`);
    const act    = hard && !isBW ? `Resta a <b>${U.fmt(last.topKg)} kg</b> · rifai <b>${last.topReps}</b> rep pulite${rirStr}` : (isBW ? `Punta <b>${target}</b> rep` : `Resta a <b>${U.fmt(last.topKg)} kg</b> · punta <b>${target}</b> rep${rirStr}`);
    return goal(act, reason + subNote, "go", dataLine);
  },

  // Comprime lo storico grezzo (una riga per serie) in sedute con top set e note
  _statsFromHistory(hist) {
    const byDate = {};
    (hist || []).forEach(r => {
      if ((r.reps || 0) <= 0) return;
      const d = String(r.date);
      if (!byDate[d]) byDate[d] = { date: r.date, sets: [], notes: [] };
      byDate[d].sets.push({ kg: r.kg || 0, reps: r.reps });
      if (r.note && String(r.note).trim()) byDate[d].notes.push(String(r.note).trim());
    });
    const e1 = (kg, reps) => (kg > 0 ? kg * (1 + reps / 30) : reps);
    return Object.values(byDate).map(g => {
      let top = g.sets[0];
      g.sets.forEach(s => { if (e1(s.kg, s.reps) > e1(top.kg, top.reps)) top = s; });
      return { date: g.date, topKg: top.kg, topReps: top.reps, e1: Math.round(e1(top.kg, top.reps) * 10) / 10, sets: g.sets, notes: g.notes };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  // Fatica sistemica: molti esercizi in calo nell'ultima seduta rispetto alla precedente
  _computeSystemic(exNames) {
    let withHist = 0, down = 0;
    (exNames || []).forEach(ex => {
      const st = this._exStats[ex];
      if (!st || st.length < 2) return;
      withHist++;
      const last = st[st.length - 1], prev = st[st.length - 2];
      const tol = Math.max(0.5, last.e1 * 0.02);
      if (last.e1 < prev.e1 - tol) down++;
    });
    return withHist >= 3 && down / withHist >= 0.5;
  },

  // #3 PT scientifico — SOSTITUZIONE. Cerca, tra gli esercizi che l'utente già
  // conosce (schede + storico), il miglior sostituto di `exName` (stesso muscolo
  // primario + stesso pattern = Livello A; solo muscolo = Livello B). Usato
  // quando la scorsa seduta segnalava un macchinario occupato.
  _subFor(exName) {
    try {
      if (typeof Volume === "undefined" || !Volume.bestSubstitute) return null;
      const pool = new Set();
      Object.values((typeof CONFIG !== "undefined" && CONFIG.SCHEDE) || {}).forEach(sc =>
        (sc.exercises || []).forEach(it => { const n = U.exName(it); if (n) pool.add(n); }));
      Object.keys(this._exStats || {}).forEach(n => pool.add(n));
      pool.delete(exName);
      return Volume.bestSubstitute(exName, [...pool]);
    } catch (e) { return null; }
  },

  // #1 SCARICO — falso positivo da fatica acuta. Cerca se lo STESSO muscolo
  // primario di `exName` è stato allenato A CEDIMENTO (parole chiave nelle note)
  // nelle 48 ore PRIMA di `beforeDate`. In tal caso un calo è recupero
  // neuromuscolare atteso (fino a 48h dopo un lavoro vicino al cedimento),
  // non stanchezza accumulata: NON deve far scattare il consiglio di scarico.
  _recentSameMuscleFatigue(exName, beforeDate) {
    try {
      if (typeof Volume === "undefined" || !this._exStats) return false;
      const primaryOf = ex => {
        const mus = Volume.musclesFor(ex) || {};
        return Object.keys(mus).find(k => mus[k] >= 1) || null;
      };
      const p = primaryOf(exName);
      if (!p) return false;
      const t0 = new Date(beforeDate).getTime();
      // Solo cedimento reale (RIR 0-1): parole forti, per non escludere troppo.
      const near = /(cediment|fallit|grind)\w*|non ce la|al massimo|al limite/;
      for (const ex of Object.keys(this._exStats)) {
        if (primaryOf(ex) !== p) continue;
        for (const g of (this._exStats[ex] || [])) {
          const dh = (t0 - new Date(g.date).getTime()) / 3600000; // ore prima
          if (dh <= 0 || dh >= 48) continue;                      // finestra 0-48h
          const txt = ((g.notes || []).join(" ") + " " + (g.sessNote || "")).toLowerCase();
          if (near.test(txt)) return true;
        }
      }
    } catch (e) {}
    return false;
  },

  // Carica lo storico di ogni esercizio (in background): alimenta l'analisi degli
  // obiettivi E semina i record personali con una sola lettura per esercizio.
  // #batch2 — Sonno di stanotte, per dare contesto onesto ai consigli PER
  // ESERCIZIO (finora il sonno influenzava solo il semaforo recovery in home).
  // Stesse soglie di Dashboard.buildSemaforo, per coerenza: HRV<45 o <6h =
  // rosso, <7h = giallo. In background, non blocca l'apertura della sessione.
  async loadSleepContext() {
    const token = (this._sleepToken = (this._sleepToken || 0) + 1);
    try {
      const rows = await API.getRecentSleep(1);
      if (token !== this._sleepToken) return;
      const last = rows && rows[0];
      if (!last) { this._sleepInfo = null; return; }
      const hrv = last.hrv, ore = last.ore != null ? last.ore : null;
      let level = "verde";
      if ((hrv && hrv < 45) || (ore != null && ore < 6)) level = "rosso";
      else if (ore != null && ore < 7) level = "giallo";
      this._sleepInfo = { ore, hrv, level };
    } catch (e) { this._sleepInfo = null; }
    this.refreshGoals();
  },

  async loadExerciseIntel(exNames) {
    // Token anti-sovrapposizione: se nel frattempo apri un'altra sessione,
    // il caricamento vecchio si ferma (niente statistiche mescolate).
    const token = (this._intelToken = (this._intelToken || 0) + 1);
    let seeded;
    try { seeded = new Set(JSON.parse(localStorage.getItem("gymos_pr_seeded") || "[]")); } catch(e) { seeded = new Set(); }
    const store = this.prLoadStore();
    this._exStats = {};
    const cur = this.sessions.find(s => s.id === this.activeId);
    const curDate = cur ? cur.date : null;
    // Mappa data → nota della SESSIONE (stesso tipo dell'attuale): serve al motore
    // per capire se una seduta storta/insolita aveva un problema segnalato.
    const noteByDate = {};
    (this.sessions || []).forEach(s => {
      if (s.note && (!cur || s.type === cur.type) && s.date !== curDate)
        noteByDate[s.date] = ((noteByDate[s.date] || "") + " · " + s.note).trim();
    });
    for (const ex of (exNames || [])) {
      if (!ex) continue;
      try {
        const hist = await API.getExerciseHistory(ex);
        if (token !== this._intelToken) return;   // sessione cambiata: abbandona
        // stats SENZA la seduta di oggi (l'obiettivo si basa sul passato)
        const st = this._statsFromHistory(hist).filter(g => g.date !== curDate);
        // Attacca a ogni seduta la NOTA DI SESSIONE di quel giorno (stesso tipo)
        st.forEach(g => { g.sessNote = noteByDate[g.date] || ""; });
        this._exStats[ex] = st;
        if (!seeded.has(ex)) {
          const rec = store[ex] || { w: 0, e1rm: 0, repsAt: {} };
          if (!rec.repsAt) rec.repsAt = {};
          hist.forEach(h => {
            if ((h.reps || 0) <= 0) return;
            rec.w    = Math.max(rec.w || 0, h.kg || 0);
            rec.e1rm = Math.max(rec.e1rm || 0, this.e1rm(h.kg || 0, h.reps));
            const k = String(h.kg || 0);
            if ((h.kg || 0) > 0) rec.repsAt[k] = Math.max(rec.repsAt[k] || 0, h.reps);
          });
          store[ex] = rec; seeded.add(ex);
        }
      } catch(e) { /* offline: riproverà alla prossima apertura */ }
    }
    this.prSaveStore();
    try { localStorage.setItem("gymos_pr_seeded", JSON.stringify([...seeded])); } catch(e){}
    this._systemicDown = this._computeSystemic(exNames);
    // #6 PT scientifico — persisti il segnale di forza diffusa così la vista
    // Misurazioni può incrociarlo col trend di peso (RED-S) anche a sessione
    // chiusa. Salvo solo un booleano + la data della seduta (per la recency).
    try {
      const withHist = (exNames || []).filter(ex => (this._exStats[ex] || []).length >= 2).length;
      if (withHist >= 3) {
        localStorage.setItem("gymos_strength_signal", JSON.stringify({
          down: !!this._systemicDown, date: curDate || null, ts: Date.now(),
        }));
      }
    } catch (e) {}
    this.refreshBadges();
    this.refreshGoals();
  },

  // Riaggiorna i banner "Obiettivo di oggi" dopo il caricamento dello storico
  refreshGoals() {
    const grouped = this.groupByExercise(this.exercises);
    const prevG   = this.groupByExercise(this.prevExercises);
    document.querySelectorAll("#exercises-container .ex-block").forEach(b => {
      const ex = b.dataset.ex;
      const tg = b.querySelector(".today-goal");
      if (!ex || !tg) return;  // in sola-visualizzazione il banner non c'è
      const sets = grouped[ex] || [];
      const rrMin = sets[0]?.rrMin || 8, rrMax = sets[0]?.rrMax || 12, rir = sets[0]?.rir ?? "";
      tg.outerHTML = this.progressionGoalHTML(ex, prevG[ex] || [], rrMin, rrMax, rir, this._orderShift(ex), this._sameMuscleDirect(ex));
    });
  },

  // Consiglio per QUESTA serie in base alla serie PRECEDENTE della stessa
  // sessione (già fatta): aumenta / cala / mantieni per restare nel rep range —
  // MA prima guarda la NOTA che hai scritto su quella serie: dolore vince
  // sempre su qualunque calcolo di peso/rep (stesse analisi del motore ricco).
  _setHintHTML(exName, si, rrMin, rrMax) {
    if (si <= 0) return "";
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    const prev = sets[si - 1];
    if (!prev || (prev.reps || 0) <= 0) return "";   // serie precedente non ancora fatta
    const note = (prev.note || "").toLowerCase();
    // Stessi pattern del motore principale, per coerenza dell'analisi
    const pain = /(dolor|fastidi|infortun|pizzic|contrattur|strapp|tendinit|acciacc|infiamm)\w*|\bfitt[ae]\b|\bmale\b|\bmal\s+di\b|\btirone\b/.test(note);
    const hard = /(cediment|difficil|duriss|pesant|faticos|soffert|sudat|fallit|grind|tost)\w*|\bdur[ae]\b|\bmort[oa]\b|non ce la|al massimo|al limite/.test(note);
    const easy = /(facil|comod)\w*|\blegger[oa]\b|\bscaric\w*|troppo poco/.test(note);
    if (pain) {
      const snip = prev.note.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<i class="ti ti-alert-triangle sh-dn"></i><span>Nella serie prima hai scritto «${snip}»: <b>vai piano</b>, non forzare</span>`;
    }

    const r = prev.reps, kg = prev.kg || 0, bw = kg === 0;
    // #C — FATICA ACCUMULATA tra le serie. Se la serie prima era vicina al
    // cedimento (RIR basso, note "dura/cedimento", o range chiuso al top), al
    // pari peso è FISIOLOGICO fare qualche rep in meno: NON chiedere di ripetere
    // le stesse rep (era il consiglio irrealistico "rifai 12×12 dopo un RIR1").
    const rirNum = (prev.rir != null && prev.rir !== "") ? Number(prev.rir) : 2;
    const nearFail = hard || rirNum <= 1 || (r >= rrMax && rirNum <= 2);
    // #batch2 raffinamento 3 — un pesante multiarticolare (squat/hinge/push/pull
    // in zona forza, rrMax≤6) non andrebbe MAI spinto al cedimento vero, nemmeno
    // per chi si allena da anni: il costo di fatica/rischio è sproporzionato al
    // guadagno (Israetel e Nippard concordano indipendentemente). Vale più del
    // generico "sei vicino al limite": qui aggiungiamo un avviso esplicito.
    let heavyCompoundNote = "";
    if (nearFail && rirNum <= 1 && rrMax <= 6) {
      try {
        if (typeof Volume !== "undefined" && Volume.pattern) {
          const pat = Volume.pattern(exName);
          if (["squat", "hinge", "push", "pull"].includes(pat)) {
            heavyCompoundNote = " Su un pesante multiarticolare come questo, meglio non arrivare mai al cedimento vero: lascia sempre 1-2 rep di margine.";
          }
        }
      } catch (e) {}
    }
    let cls, ic, txt;
    if (r > rrMax) {
      cls = "sh-up"; ic = "ti-arrow-up-right";
      txt = bw ? `Serie facile (${r} rep): rendila più difficile` : `Serie leggera (${r} rep): <b>aumenta</b> un po' il peso`;
    } else if (r < rrMin) {
      cls = "sh-dn"; ic = "ti-arrow-down-right";
      txt = bw ? `Poche rep (${r}): recupera un attimo di più` : `Serie pesante (${r} rep): <b>cala</b> un po' il peso`;
    } else if (nearFail) {
      // vicino al limite → tieni il peso, aspettati un calo naturale delle rep
      const tgt = Math.max(rrMin, r - 1);
      cls = "sh-ok"; ic = "ti-equal";
      const why = rirNum <= 1 ? "eri vicino al cedimento" : hard ? "l'avevi sentita dura" : "hai chiuso il range";
      txt = bw
        ? `Serie al limite (${why}): normale calare ora — punta <b>${tgt}</b>+ rep, non forzare${heavyCompoundNote}`
        : `Serie al limite (${why}): tieni <b>${U.fmt(kg)}kg</b>, è normale fare qualche rep in meno — punta <b>${tgt}</b>+${heavyCompoundNote}`;
    } else if (easy) {
      // in range e comoda → puoi spingere un filo di più
      cls = "sh-up"; ic = "ti-arrow-up-right";
      txt = bw ? `L'avevi sentita facile: prova <b>${r + 1}</b> rep` : `L'avevi sentita facile: prova ad <b>aumentare</b> un po'`;
    } else {
      cls = "sh-ok"; ic = "ti-equal";
      txt = bw ? `Bene: <b>mantieni</b>, punta ${r} rep` : `Bene: <b>mantieni</b> ${U.fmt(kg)}kg, punta ${r} rep`;
    }
    return `<i class="ti ${ic} ${cls}"></i><span>${txt}</span>`;
  },
  // Riaggiorna gli hint delle serie di un esercizio (dopo aver fatto una serie)
  refreshSetHints(exName) {
    if (this.viewMode || this.sessionDone) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    const rrMin = sets[0]?.rrMin || 8, rrMax = sets[0]?.rrMax || 12;
    sets.forEach((s, i) => { const el = document.getElementById(`hint-${s.id}`); if (el) el.innerHTML = this._setHintHTML(exName, i, rrMin, rrMax); });
  },

  buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax, total, expanded) {
    const done = !!((this._done && this._done.has(set.id)) || (this.sessionDone && (set.reps || 0) > 0));
    const row = document.createElement("div");
    row.className = "set-card" + (expanded ? "" : " set-collapsed") + (done ? " set-done" : "");
    row.id = `setrow-${set.id}`;

    // "Volta scorsa" valida solo se la serie precedente ha rep reali (>0):
    // le serie lasciate a 0 non sono un riferimento utile → trattale come prima volta.
    const hasPrev  = prevSet && (prevSet.reps || 0) > 0;
    const canTap   = hasPrev && !this.viewMode && !this.sessionDone;
    // Riga "volta scorsa" dedicata: etichetta chiara + valore + pulsante "Usa"
    const prevTag  = canTap ? "button" : "div";
    const prevRow  = hasPrev
      ? `<${prevTag} class="prev-use${canTap ? " tap" : ""}"${canTap ? ` type="button" onclick="Session.prefillFromPrev('${set.id}','${exName}')"` : ""}>
           <i class="ti ti-history pu-ic"></i>
           <span class="pu-txt">
             <span class="pu-lbl">Volta scorsa</span>
             <span class="pu-val">${U.fmt(prevSet.kg)}<small>kg</small> × ${prevSet.reps}<small>rep</small></span>
           </span>
           ${canTap ? '<span class="pu-act"><i class="ti ti-arrow-down"></i>Usa</span>' : ""}
         </${prevTag}>`
      : `<div class="prev-none"><i class="ti ti-history pu-ic"></i>Prima volta che lo fai</div>`;

    const prog   = this.getProgression(set, prevSet);
    const status = this.buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax);
    const repCls = set.reps > 0 ? "stepper-val" : "stepper-val empty";

    row.innerHTML = `
      <div class="set-hd" onclick="Session.toggleSet('${set.id}','${exName}')">
        <span class="set-num">${si + 1}</span>
        <div class="set-hd-sum${set.reps > 0 ? "" : " empty"}" id="sumwrap-${set.id}">
          <span class="ssum" id="ssum-kg-${set.id}">${U.fmt(set.kg)}</span><span class="ssum-u">kg</span>
          <span class="ssum-x">×</span>
          <span class="ssum" id="ssum-rep-${set.id}">${set.reps > 0 ? set.reps : "0"}</span><span class="ssum-u">rep</span>
        </div>
        <span class="set-hd-prev" title="Volta scorsa">${hasPrev ? `<i class="ti ti-history"></i>${U.fmt(prevSet.kg)}×${prevSet.reps}` : ""}</span>
        <div class="set-hd-badge" id="prog-${set.id}">${status}</div>
        <i class="ti ti-circle-check set-done-mark"></i>
        <i class="ti ti-chevron-down set-chev"></i>
      </div>
      <div class="set-body">
        <div class="set-body-top">
          <span class="set-counter">Serie ${si + 1}/${total || 1}</span>
          <button class="rm-set-btn" onclick="Session.removeSet('${set.id}','${exName}')" aria-label="Rimuovi serie">
            <i class="ti ti-x"></i>
          </button>
        </div>
        ${prevRow}
        <div class="set-hint" id="hint-${set.id}">${(!this.viewMode && !this.sessionDone) ? this._setHintHTML(exName, si, rrMin, rrMax) : ""}</div>
        <div class="stepper-row">
          <span class="stepper-lbl">Kg</span>
          <button class="adj" data-id="${set.id}" data-f="k" data-d="-2.5" data-ex="${exName}">−</button>
          <span class="${repCls}" id="kg-${set.id}" title="Tocca per inserire il valore"
            onclick="Session.editVal('${set.id}','k','${exName}')">${U.fmt(set.kg)}</span>
          <button class="adj" data-id="${set.id}" data-f="k" data-d="2.5" data-ex="${exName}">+</button>
        </div>
        <div class="stepper-row">
          <span class="stepper-lbl">Rep</span>
          <button class="adj" data-id="${set.id}" data-f="r" data-d="-1" data-ex="${exName}">−</button>
          <span class="${repCls}" id="rep-${set.id}" title="Tocca per inserire il valore"
            onclick="Session.editVal('${set.id}','r','${exName}')">${set.reps > 0 ? set.reps : "0"}</span>
          <button class="adj" data-id="${set.id}" data-f="r" data-d="1" data-ex="${exName}">+</button>
        </div>
        <input class="note-inp" type="text" value="${set.note || ""}"
          placeholder="Note: forma, sensazione..."
          onchange="Session.saveNote('${set.id}',this.value)">
        <button class="set-done-btn" onclick="Session.completeSet('${set.id}','${exName}')">
          ${done ? '<i class="ti ti-rotate-2"></i> Annulla' : '<i class="ti ti-check"></i> Serie fatta'}
        </button>
      </div>
    `;
    // tieni premuto +/− per ripetere
    row.querySelectorAll(".adj").forEach(btn => this.bindHold(btn));
    return row;
  },

  // ─── AGGIUNGI SERIE ───
  async addSet(exName) {
    if (this.viewMode) return;
    const grouped  = this.groupByExercise(this.exercises);
    const existing = grouped[exName] || [];
    const last     = existing[existing.length - 1];
    // Prossimo numero = max S<n> esistente (non il conteggio: dopo la rimozione
    // di una serie centrale il conteggio duplicherebbe un numero già usato)
    const si       = this.nextSetNum(existing) - 1;
    const sess     = this.sessions.find(s => s.id === this.activeId);
    const date     = sess?.date || U.today();

    // Trova il page ID dell'esercizio in Esercizi Master
    const masterEntry = this.exercises.find(e =>
      U.exBase(e.name) === U.exBase(exName)
    );

    // Crea nuova entry in Notion
    const props = {};
    props[CONFIG.PROPS.EL_NAME]    = API.prop.title(`${exName} – ${sess?.name || ""} – S${si + 1}`);
    props[CONFIG.PROPS.EL_SESSION] = API.prop.relation([this.activeId]);
    props[CONFIG.PROPS.EL_SETS]    = API.prop.number(1);
    props[CONFIG.PROPS.EL_REPS]    = API.prop.number(0);
    props[CONFIG.PROPS.EL_KG]      = API.prop.number(last?.kg || 0);
    props[CONFIG.PROPS.EL_RR_MIN]  = API.prop.number(last?.rrMin || 8);
    props[CONFIG.PROPS.EL_RR_MAX]  = API.prop.number(last?.rrMax || 12);
    props[CONFIG.PROPS.EL_DATE]    = API.prop.date(date);
    // Eredita le tecniche di intensità dall'esercizio (vivono su ogni serie)
    props[CONFIG.PROPS.EL_TECNICA]  = API.prop.multi_select(last?.tecnica || []);
    props[CONFIG.PROPS.EL_CADENZA]  = API.prop.rich_text(last?.cadenza || "");
    props[CONFIG.PROPS.EL_GRUPPO]   = API.prop.select(last?.gruppo || "");
    props[CONFIG.PROPS.EL_RECUPERO] = API.prop.number(last?.recupero ?? null);
    props[CONFIG.PROPS.EL_RIR]      = API.prop.number(last?.rir ?? null);
    props[CONFIG.PROPS.EL_INFO]     = API.prop.rich_text(last?.info || "");

    // Aggiungi relazione esercizio se disponibile
    if (masterEntry) {
      // cerca l'ID dell'esercizio master dalla prima entry esistente
      const firstEntry = this.exercises.find(e => U.exBase(e.name) === U.exBase(exName));
      // Non possiamo ottenere l'ID master facilmente senza una query aggiuntiva
      // Omettiamo per ora — la relazione è opzionale per il funzionamento
    }

    try {
      const newPage = await API.create(CONFIG.DB.ESERCIZI_LOG, props);
      const newSet = {
        id:     newPage.id,
        name:   `${exName} – ${sess?.name || ""} – S${si + 1}`,
        sets:   1,
        reps:   0,
        kg:     last?.kg || 0,
        rrMin:  last?.rrMin || 8,
        rrMax:  last?.rrMax || 12,
        note:   "",
        date,
        tecnica:  last?.tecnica ? [...last.tecnica] : [],
        cadenza:  last?.cadenza || "",
        gruppo:   last?.gruppo || "",
        recupero: last?.recupero ?? null,
        rir:      last?.rir ?? null,
        info:     last?.info || "",
      };
      this.exercises.push(newSet);

      // Aggiunge la riga UI senza re-render completo
      const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
      const prevGrouped   = this.groupByExercise(this.prevExercises);
      const prevSets      = prevGrouped[exName] || [];
      const prevSet       = prevSets[si] || null;
      const prevMax       = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
      // la nuova serie si apre, le altre si chiudono
      if (setsContainer) setsContainer.querySelectorAll(".set-card").forEach(c => c.classList.add("set-collapsed"));
      setsContainer.appendChild(
        this.buildSetRow(newSet, si, prevSet, exName, newSet.rrMin, newSet.rrMax, prevMax, si + 1, true)
      );
      this.updateStats();
      this.updateSetCount(exName);
      this.syncSedutaMeta(exName);   // aggiorna serie/recupero/rir/tecnica sulla scheda
      this.checkAutoSave();          // nuova serie non spuntata → annulla eventuale auto-salvataggio
    } catch(e) {
      console.error("addSet error:", e);
      U.alert("Errore nell'aggiungere la serie. Controlla la connessione.");
    }
  },

  // ─── RIMUOVI SERIE ───
  async removeSet(id, exName) {
    if (this.viewMode) return;
    if (!await U.confirm("Rimuovere questa serie?", { danger: true, okText: "Rimuovi" })) return;
    // Rimuovi da UI
    const row = document.getElementById(`setrow-${id}`);
    if (row) row.remove();
    // Rimuovi da array locale + stato "fatto"
    this.exercises = this.exercises.filter(e => e.id !== id);
    if (this._done) { this._done.delete(id); this.saveDone(); }
    // Rimozione vera (archiviata): così il conteggio resta coerente anche dopo refresh
    await API.archivePage(id).catch(console.error);
    this.updateStats();
    // Rinumera le serie
    const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
    if (setsContainer) {
      [...setsContainer.querySelectorAll(".set-num")].forEach((sn, i) => {
        sn.textContent = i + 1;
      });
    }
    this.updateSetCount(exName);
    // Ultima serie rimossa → l'esercizio non esiste più: va tolto anche da
    // exOrder (come fa deleteExercise), altrimenti resta un blocco fantasma
    // con 0 serie al prossimo render, con obiettivo calcolato sui default.
    const remaining = this.groupByExercise(this.exercises)[U.exBase(exName)] || [];
    if (!remaining.length) {
      this.exOrder = this.exOrder.filter(n => n !== exName);
      this.saveOrder();
      this.renderExercises();
      this.syncSedutaExercise(exName, 0, "remove");
    } else {
      this.syncSedutaMeta(exName);   // aggiorna serie/recupero/rir/tecnica sulla scheda
    }
    this.checkAutoSave();          // togliendo una serie potrebbe risultare tutto fatto
  },

  // ─── ESERCIZI INTERI: aggiungi / rimuovi (con sync sulla seduta) ───

  // Prossimo numero di serie: max S<n> nei titoli esistenti + 1 (robusto alle
  // rimozioni di serie centrali; fallback al conteggio+1)
  nextSetNum(sets) {
    let max = 0;
    (sets || []).forEach(s => {
      const m = (s.name || "").split(" – ").pop().match(/S(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return Math.max(max, (sets || []).length) + 1;
  },

  // Crea in Notion N serie per un esercizio nella sessione attiva, ritorna gli oggetti set
  async _createExerciseSets(exName, nSets, base) {
    const sess = this.sessions.find(s => s.id === this.activeId);
    const date = sess?.date || U.today();
    const made = [];
    // Se l'esercizio ha già serie (append da reconcile), parti dal numero successivo
    const startNum = this.nextSetNum(this.groupByExercise(this.exercises)[exName]);
    for (let k = 0; k < nSets; k++) {
      const i = startNum + k;
      const props = {};
      props[CONFIG.PROPS.EL_NAME]    = API.prop.title(`${exName} – ${sess?.name || ""} – S${i}`);
      props[CONFIG.PROPS.EL_SESSION] = API.prop.relation([this.activeId]);
      props[CONFIG.PROPS.EL_SETS]    = API.prop.number(1);
      props[CONFIG.PROPS.EL_REPS]    = API.prop.number(0);
      props[CONFIG.PROPS.EL_KG]      = API.prop.number(0);
      props[CONFIG.PROPS.EL_RR_MIN]  = API.prop.number(base?.rrMin || 8);
      props[CONFIG.PROPS.EL_RR_MAX]  = API.prop.number(base?.rrMax || 12);
      props[CONFIG.PROPS.EL_DATE]    = API.prop.date(date);
      const page = await API.create(CONFIG.DB.ESERCIZI_LOG, props);
      made.push({ id: page.id, name: `${exName} – ${sess?.name || ""} – S${i}`, sets: 1, reps: 0, kg: 0,
        rrMin: base?.rrMin || 8, rrMax: base?.rrMax || 12, note: "", date,
        tecnica: [], cadenza: "", gruppo: "", recupero: null, info: "" });
    }
    return made;
  },

  async addExercise() {
    if (this.viewMode) return;
    const name = await U.prompt("Nuovo esercizio", { placeholder: "Es. Curl manubri" });
    if (!name || !name.trim()) return;
    const exName = name.trim();
    if (this.groupByExercise(this.exercises)[exName]) { U.alert("Esercizio già presente nella sessione."); return; }
    this.setSyncState("saving");
    try {
      const nSets = 3;
      const made = await this._createExerciseSets(exName, nSets, null);
      this.exercises.push(...made);
      this.exOrder.push(exName);
      this.saveOrder();
      this.renderExercises();
      this.updateStats();
      this.setSyncState("saved");
      this.syncSedutaExercise(exName, nSets, "add");   // riflette sulla seduta
    } catch(e) { console.error("addExercise:", e); this.setSyncState("error"); U.alert("Errore nell'aggiungere l'esercizio."); }
  },

  async deleteExercise(exName) {
    if (this.viewMode) return;
    if (!await U.confirm(`Rimuovere "${exName}" dalla sessione e dalla scheda?`, { danger: true, okText: "Rimuovi" })) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    this.setSyncState("saving");
    try {
      await Promise.all(sets.map(s => API.archivePage(s.id).catch(console.error)));
      this.exercises = this.exercises.filter(e => U.exBase(e.name) !== U.exBase(exName));
      this.exOrder = this.exOrder.filter(n => n !== exName);
      this.saveOrder();
      this.renderExercises();
      this.updateStats();
      this.setSyncState("saved");
      this.syncSedutaExercise(exName, 0, "remove");   // riflette sulla seduta
    } catch(e) { console.error("deleteExercise:", e); this.setSyncState("error"); U.alert("Errore nella rimozione."); }
  },

  // Aggiorna la seduta (template) del programma attivo legata a questa sessione
  syncSedutaExercise(exName, serie, action) {
    const sess  = this.sessions.find(s => s.id === this.activeId);
    const sched = sess && CONFIG.SCHEDE[sess.type];   // { _id, exercises, color }
    if (!sched || !sched._id) return;                 // sessione non legata a una seduta del programma attivo
    // Conserva TUTTI i meta degli altri esercizi (recupero/rir/rep range/tecnica/
    // superset) — mappare solo {nome, serie} li azzererebbe sulla seduta.
    let list = (sched.exercises || []).map(e => ({
      nome: U.exName(e), serie: U.exSets(e), recupero: U.exRest(e), rir: U.exRir(e),
      rrMin: U.exRrMin(e), rrMax: U.exRrMax(e),
      tecnica: U.exTec(e), cadenza: U.exCad(e), info: U.exInfo(e), gruppo: U.exGrp(e),
    }));
    if (action === "add") {
      if (!list.some(e => e.nome === exName)) list.push({ nome: exName, serie: serie || 3, recupero: null, rir: null, rrMin: 8, rrMax: 12, tecnica: [], cadenza: "", info: "", gruppo: "" });
    } else {
      list = list.filter(e => e.nome !== exName);
    }
    sched.exercises = list;
    const sd = App.schede.find(x => x.id === sched._id);
    if (sd) sd.exercises = list;
    API.updateScheda(sched._id, { exercises: list }).catch(console.error);
  },

  // Aggiorna sulla seduta i meta di un esercizio (serie + recupero + rir) dai
  // valori correnti nella sessione (sync sessione -> scheda, dinamico).
  syncSedutaMeta(exName) {
    const sess  = this.sessions.find(s => s.id === this.activeId);
    const sched = sess && CONFIG.SCHEDE[sess.type];
    if (!sched || !sched._id) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    if (!sets.length) return;   // se non resta nessuna serie, ci pensa la rimozione esercizio
    const ex = sets[0];
    const next = {
      nome: exName, serie: sets.length,
      recupero: ex.recupero ?? null, rir: ex.rir ?? null,
      rrMin: ex.rrMin ?? 8, rrMax: ex.rrMax ?? 12,
      tecnica: ex.tecnica || [], cadenza: ex.cadenza || "", info: ex.info || "", gruppo: ex.gruppo || "",
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let list = (sched.exercises || []).map(e => ({
      nome: U.exName(e), serie: U.exSets(e), recupero: U.exRest(e), rir: U.exRir(e),
      rrMin: U.exRrMin(e), rrMax: U.exRrMax(e),
      tecnica: U.exTec(e), cadenza: U.exCad(e), info: U.exInfo(e), gruppo: U.exGrp(e),
    }));
    const item = list.find(e => e.nome === exName);
    if (item) {
      if (same(item, next)) return;
      Object.assign(item, next);
    } else {
      list.push(next);
    }
    sched.exercises = list;
    const sd = App.schede.find(x => x.id === sched._id);
    if (sd) sd.exercises = list;
    API.updateScheda(sched._id, { exercises: list }).catch(console.error);
  },

  // Riallinea la sessione in corso alla sua seduta (chiamato in loadSession)
  async reconcileWithScheda(sess) {
    const sched = CONFIG.SCHEDE[sess.type];
    if (!sched) return;
    const grouped   = this.groupByExercise(this.exercises);
    const present   = Object.keys(grouped);
    const tmpl      = (sched.exercises || []).map(e => ({
      nome: U.exName(e), serie: U.exSets(e), recupero: U.exRest(e), rir: U.exRir(e),
      rrMin: U.exRrMin(e), rrMax: U.exRrMax(e),
      tecnica: U.exTec(e), cadenza: U.exCad(e), info: U.exInfo(e), gruppo: U.exGrp(e),
    }));
    const tmplNames = tmpl.map(e => e.nome);
    // 1) per ogni esercizio della scheda: se manca lo crea; se c'è, allinea il
    //    NUMERO DI SERIE (aggiunge le mancanti, toglie le in eccesso SOLO se vuote)
    //    e i META (recupero/rir/tecnica/cadenza/info/gruppo) ai valori della scheda.
    for (const e of tmpl) {
      const cur = grouped[e.nome];
      if (!cur) {
        const made = await this._createExerciseSets(e.nome, e.serie, e);
        this.exercises.push(...made);
      } else if (e.serie > cur.length) {
        const made = await this._createExerciseSets(e.nome, e.serie - cur.length, cur[0]);
        this.exercises.push(...made);
      } else if (e.serie < cur.length) {
        const removable = cur.filter(s => !(s.reps > 0) && !this._done.has(s.id));
        const drop = removable.slice(-(cur.length - e.serie));
        for (const s of drop) {
          await API.archivePage(s.id).catch(() => {});
          this.exercises = this.exercises.filter(x => x.id !== s.id);
        }
      }
      // allinea i meta (la scheda è la sorgente) su tutte le serie dell'esercizio
      const cur2 = this.groupByExercise(this.exercises)[e.nome] || [];
      if (cur2.length) {
        const meta = { recupero: e.recupero ?? null, rir: e.rir ?? null, rrMin: e.rrMin ?? 8, rrMax: e.rrMax ?? 12, tecnica: e.tecnica || [], cadenza: e.cadenza || "", info: e.info || "", gruppo: e.gruppo || "" };
        const c0 = cur2[0];
        const differs = (c0.recupero ?? null) !== meta.recupero || (c0.rir ?? null) !== meta.rir ||
          (c0.rrMin ?? 8) !== meta.rrMin || (c0.rrMax ?? 12) !== meta.rrMax ||
          JSON.stringify(c0.tecnica || []) !== JSON.stringify(meta.tecnica) ||
          (c0.cadenza || "") !== meta.cadenza || (c0.info || "") !== meta.info || (c0.gruppo || "") !== meta.gruppo;
        if (differs) {
          cur2.forEach(s => Object.assign(s, meta));
          await Promise.all(cur2.map(s => API.updateExerciseTech(s.id, meta)));
        }
      }
    }
    // 2) togli dalla sessione (in corso) gli esercizi non più nella scheda.
    const toRemove = present.filter(name => !tmplNames.includes(name));
    const noData = [], withData = [];
    toRemove.forEach(name => {
      (grouped[name].some(s => (s.reps || 0) > 0) ? withData : noData).push(name);
    });
    const archive = async name => {
      await Promise.all(grouped[name].map(s => API.archivePage(s.id).catch(() => {})));
      this.exercises = this.exercises.filter(x => U.exBase(x.name) !== U.exBase(name));
    };
    // Senza dati: rimuovi subito (recuperabili dal cestino Notion)
    for (const name of noData) await archive(name);
    // Con dati registrati: chiedi conferma (una volta sola per tutti)
    if (withData.length) {
      const ok = await U.confirm(
        `Questi esercizi sono stati tolti dalla scheda ma hanno serie già registrate in questa sessione: ${withData.join(", ")}. Rimuoverli anche dalla sessione?`,
        { danger: true, okText: "Rimuovi" }
      );
      if (ok) {
        for (const name of withData) await archive(name);
      } else {
        // li tieni: rimettili nella scheda così non te lo richiede ogni volta
        for (const name of withData) this.syncSedutaExercise(name, grouped[name].length, "add");
      }
    }
  },

  getProgression(set, prevSet) {
    if (!set.reps || set.reps === 0) return "mt";
    if (!prevSet) return "new";
    // #B — coerente col motore principale: NON volume grezzo (reps×kg), ma 1RM
    // stimato (Epley) con le rep CAPPATE al top del range. Fare più rep del
    // range = peso troppo leggero, non "più progressione". E salire di peso
    // restando nel range è progresso anche se le rep calano un po'.
    const rrMax = set.rrMax || prevSet.rrMax || 12;
    const rrMin = set.rrMin || prevSet.rrMin || 8;
    const capE1 = s => { const r = Math.min(s.reps || 0, rrMax); return (s.kg > 0) ? s.kg * (1 + r / 30) : r; };
    const now = capE1(set), prev = capE1(prevSet);
    const tol = Math.max(0.5, prev * 0.02);
    if ((set.kg || 0) > (prevSet.kg || 0) && (set.reps || 0) >= rrMin) return "up";
    if (now > prev + tol) return "up";
    if (now < prev - tol) return "dn";
    return "eq";
  },

  buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax) {
    // PR reale: la serie batte un record noto (peso / e1RM / rep) OPPURE è già
    // stata registrata come record in questa sessione (_prSets, resta evidenziata).
    const isPR = (this._prSets && this._prSets.has(set.id)) || this.prBeats(exName, set);
    const prTag = isPR ? '<span class="pr-tag">PR</span>' : "";
    if (prog === "mt")  return '<span class="badge b-mt">da fare</span>';
    if (prog === "new") return '<span class="badge b-eq">nuovo</span>';
    if (prog === "up")  return `<span class="badge b-up"><i class="ti ti-trending-up" style="font-size:10px"></i>Su</span>${prTag}`;
    if (prog === "eq")  return `<span class="badge b-eq"><i class="ti ti-minus" style="font-size:10px"></i>Uguale</span>`;
    return `<span class="badge b-dn"><i class="ti ti-trending-down" style="font-size:10px"></i>Giù</span>`;
  },

  // ═══ RECORD PERSONALI (PR) ═══════════════════════════════════════════════
  // Tiene traccia, per esercizio, del miglior PESO, del miglior 1RM stimato
  // (formula di Epley) e delle migliori RIPETIZIONI a un dato peso. I record
  // stanno in localStorage (veloci, offline) e vengono "seminati" una volta per
  // esercizio dallo storico Notion. Nessun record → nessun falso PR.
  _prStore: null,
  prLoadStore() {
    if (!this._prStore) {
      try { this._prStore = JSON.parse(localStorage.getItem("gymos_pr") || "{}"); }
      catch(e) { this._prStore = {}; }
    }
    return this._prStore;
  },
  prSaveStore() { try { localStorage.setItem("gymos_pr", JSON.stringify(this._prStore || {})); } catch(e){} },
  e1rm(kg, reps) { return (kg > 0 && reps > 0) ? Math.round(kg * (1 + reps / 30) * 10) / 10 : 0; },
  prRec(exName) { return this.prLoadStore()[exName] || null; },

  // La serie batte un record GIÀ NOTO? (se non c'è ancora un record → no, è baseline)
  prBeats(exName, set) {
    if (!set || (set.reps || 0) <= 0) return false;
    const rec = this.prRec(exName);
    if (!rec || ((rec.w || 0) <= 0 && (rec.e1rm || 0) <= 0)) return false;  // nessun record reale ancora
    const e        = this.e1rm(set.kg || 0, set.reps);
    const bestReps = (rec.repsAt && rec.repsAt[String(set.kg || 0)]) || 0;
    // rep PR solo se migliori le rep a un peso GIÀ fatto (bestReps>0): un peso nuovo
    // non è un record di rep.
    return (set.kg || 0) > (rec.w || 0)
        || e > (rec.e1rm || 0)
        || (bestReps > 0 && set.reps > bestReps);
  },

  // Registra la serie nei record (prende sempre il massimo) e dice cosa ha battuto
  prMerge(exName, kg, reps) {
    const s   = this.prLoadStore();
    const rec = s[exName] || { w: 0, e1rm: 0, repsAt: {} };
    if (!rec.repsAt) rec.repsAt = {};
    const e        = this.e1rm(kg, reps);
    const kgKey    = String(kg || 0);
    const bestReps = rec.repsAt[kgKey] || 0;
    const beat = {
      weight: (kg || 0) > (rec.w || 0),
      e1rm:   e > (rec.e1rm || 0),
      reps:   bestReps > 0 && reps > bestReps,   // solo miglioria a un peso già fatto
    };
    rec.w    = Math.max(rec.w || 0, kg || 0);
    rec.e1rm = Math.max(rec.e1rm || 0, e);
    if ((kg || 0) > 0) rec.repsAt[kgKey] = Math.max(bestReps, reps);
    s[exName] = rec;
    this.prSaveStore();
    return beat;
  },

  // Semina i record dallo storico Notion, una volta per esercizio (in background).
  async prSeedBg(exNames) {
    let seeded;
    try { seeded = new Set(JSON.parse(localStorage.getItem("gymos_pr_seeded") || "[]")); }
    catch(e) { seeded = new Set(); }
    const todo = (exNames || []).filter(n => n && !seeded.has(n));
    if (!todo.length) return;
    const s = this.prLoadStore();
    for (const ex of todo) {
      try {
        const hist = await API.getExerciseHistory(ex);
        const rec  = s[ex] || { w: 0, e1rm: 0, repsAt: {} };
        if (!rec.repsAt) rec.repsAt = {};
        hist.forEach(h => {
          if ((h.reps || 0) <= 0) return;
          rec.w    = Math.max(rec.w || 0, h.kg || 0);
          rec.e1rm = Math.max(rec.e1rm || 0, this.e1rm(h.kg || 0, h.reps));
          const k = String(h.kg || 0);
          if ((h.kg || 0) > 0) rec.repsAt[k] = Math.max(rec.repsAt[k] || 0, h.reps);
        });
        s[ex] = rec;
        seeded.add(ex);
      } catch(e) { /* offline: riproverà alla prossima apertura */ }
    }
    this.prSaveStore();
    try { localStorage.setItem("gymos_pr_seeded", JSON.stringify([...seeded])); } catch(e){}
    this.refreshBadges();   // ora che i record sono noti, aggiorna i badge PR
  },

  savePrSets() {
    if (this.activeId) try { localStorage.setItem(`gymos_pr_${this.activeId}`, JSON.stringify([...this._prSets])); } catch(e){}
  },

  // Riaggiorna solo i badge di stato/PR di tutte le serie (senza re-render completo)
  refreshBadges() {
    const grouped = this.groupByExercise(this.exercises);
    const prevG   = this.groupByExercise(this.prevExercises);
    Object.keys(grouped).forEach(exName => {
      const prevSets = prevG[exName] || [];
      const prevMax  = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
      grouped[exName].forEach((set, i) => {
        const el = document.getElementById(`prog-${set.id}`);
        if (el) el.innerHTML = this.buildStatusBadge(
          this.getProgression(set, prevSets[i] || null), set, exName, set.rrMin || 8, set.rrMax || 12, prevMax
        );
      });
    });
  },

  // Tocca il riferimento "volta scorsa" → pre-compila kg e rep della serie di oggi
  prefillFromPrev(id, exName) {
    if (this.viewMode) return;
    const set = this.exercises.find(e => e.id === id);
    if (!set) return;
    const grouped  = this.groupByExercise(this.exercises);
    const prevSets = this.groupByExercise(this.prevExercises)[exName] || [];
    const idx      = grouped[exName] ? grouped[exName].findIndex(s => s.id === id) : -1;
    const prev     = prevSets[idx];
    if (!prev || (prev.reps || 0) <= 0) return;
    set.kg   = prev.kg || 0;
    set.reps = prev.reps || 0;
    this.refreshSetValue(set, exName);
    if (navigator.vibrate) navigator.vibrate(12);
    U.toast("Valori della volta scorsa inseriti", "info", 1400);
  },

  adjSet(id, field, delta, exName) {
    if (this.viewMode) return;
    const set = this.exercises.find(e => e.id === id);
    if (!set) return;
    if (field === "r") set.reps = Math.max(0, (set.reps || 0) + delta);
    if (field === "k") set.kg   = Math.max(0, Math.round(((set.kg || 0) + delta) * 10) / 10);
    this.refreshSetValue(set, exName);
  },

  // Inserimento manuale: tocca il numero (kg o rep) e scrivi il valore esatto
  editVal(id, field, exName) {
    if (this.viewMode) return;
    const span = document.getElementById(`${field === "k" ? "kg" : "rep"}-${id}`);
    if (!span || span.querySelector("input")) return;
    const set = this.exercises.find(e => e.id === id);
    if (!set) return;
    const cur = field === "k" ? (set.kg || 0) : (set.reps || 0);
    span.innerHTML = `<input class="val-edit" type="number" inputmode="decimal" step="${field === "k" ? "0.5" : "1"}" min="0" value="${cur}">`;
    const inp = span.querySelector("input");
    inp.focus(); inp.select();
    const commit = () => {
      let v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) v = 0;
      if (field === "k") set.kg = Math.round(v * 10) / 10;
      else set.reps = Math.round(v);
      this.refreshSetValue(set, exName);
    };
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
  },

  // Apre una serie e chiude le altre dello stesso esercizio (vedi solo la corrente)
  toggleSet(id, exName) {
    const card = document.getElementById(`setrow-${id}`);
    if (!card) return;
    const willOpen = card.classList.contains("set-collapsed");
    const container = card.parentElement;
    if (container) container.querySelectorAll(".set-card").forEach(c => c.classList.add("set-collapsed"));
    if (willOpen) card.classList.remove("set-collapsed");
  },

  _done: new Set(),
  _prSets: new Set(),   // serie che hanno segnato un record in questa sessione
  saveDone() {
    if (this.activeId) localStorage.setItem(`gymos_done_${this.activeId}`, JSON.stringify([...this._done]));
  },

  // "Serie fatta": segna completata, chiude la serie, apre la successiva e avvia
  // il timer di recupero con il tempo dell'esercizio (o 90s di default).
  completeSet(id, exName) {
    if (this.viewMode) return;
    const card = document.getElementById(`setrow-${id}`);
    if (!card) return;
    const nowDone = !this._done.has(id);
    if (nowDone) this._done.add(id); else this._done.delete(id);
    this.saveDone();
    card.classList.toggle("set-done", nowDone);
    const btn = card.querySelector(".set-done-btn");
    if (btn) btn.innerHTML = nowDone
      ? '<i class="ti ti-rotate-2"></i> Annulla'
      : '<i class="ti ti-check"></i> Serie fatta';
    this.refreshExDone(exName);
    this.refreshSetHints(exName);   // aggiorna i consigli delle serie successive

    // #batch2 — ultima serie di questo esercizio completata → avanza alla tendina successiva
    const setsOfEx = this.groupByExercise(this.exercises)[exName] || [];
    if (nowDone && setsOfEx.length > 0 && setsOfEx.every(s => this._done.has(s.id))) {
      this.autoAdvanceExercise(exName);
    }

    if (nowDone) {
      if (navigator.vibrate) navigator.vibrate(20);
      // chiudi questa serie e apri la successiva dello stesso esercizio
      card.classList.add("set-collapsed");
      const next = card.nextElementSibling;
      if (next && next.classList.contains("set-card")) next.classList.remove("set-collapsed");
      // avvia il recupero automatico
      const set = this.exercises.find(e => e.id === id);
      const secs = (set && set.recupero) ? set.recupero : 90;
      if (typeof RestTimer !== "undefined") RestTimer.start(secs);
      // ── RECORD PERSONALE? — controlla PRIMA di aggiornare i record ──
      if (set && (set.reps || 0) > 0 && !this.sessionDone) {
        const rec0 = this.prRec(exName);
        const hadRecord = !!rec0 && ((rec0.w || 0) > 0 || (rec0.e1rm || 0) > 0);
        // Snapshot PRE-merge: se l'utente digita un peso sbagliato per errore
        // e poi annulla la serie, senza questo il record fantasma resterebbe
        // per sempre (Math.max non è invertibile da solo) e sopprimerebbe
        // tutti i PR reali futuri su quell'esercizio. Solo in memoria (basta
        // per il "mi sono accorto subito e ho annullato" — non persiste al
        // reload, come _done/_prSets sono comunque scope-di-sessione).
        this._prSnapshots = this._prSnapshots || {};
        this._prSnapshots[id] = rec0 ? JSON.parse(JSON.stringify(rec0)) : { w: 0, e1rm: 0, repsAt: {} };
        const beat = this.prMerge(exName, set.kg || 0, set.reps);
        if (hadRecord && (beat.weight || beat.e1rm || beat.reps)) {
          this._prSets.add(id);
          this.savePrSets();
          card.classList.add("set-pr");
          const el = document.getElementById(`prog-${id}`);
          if (el && !el.querySelector(".pr-tag")) el.insertAdjacentHTML("beforeend", '<span class="pr-tag">PR</span>');
          const parts = [];
          if (beat.weight) parts.push("peso");
          if (beat.e1rm)   parts.push("1RM");
          if (beat.reps)   parts.push("rep");
          U.toast(`🎉 Nuovo record — ${exName} (${parts.join(" · ")})`, "ok", 2800);
          if (navigator.vibrate) navigator.vibrate([25, 40, 35]);
        }
      }
    } else if (this._prSets.has(id)) {
      // Annullamento di una serie che aveva segnato un PR: ripristina il
      // record al valore pre-merge invece di lasciare un record fantasma.
      const snap = this._prSnapshots && this._prSnapshots[id];
      if (snap) {
        const store = this.prLoadStore();
        store[exName] = snap;
        this.prSaveStore();
      }
      this._prSets.delete(id);
      this.savePrSets();
      card.classList.remove("set-pr");
      const el = document.getElementById(`prog-${id}`);
      const tag = el && el.querySelector(".pr-tag");
      if (tag) tag.remove();
    }
    // se ora è tutto spuntato → programma il salvataggio automatico (o annullalo)
    this.checkAutoSave();
  },

  // ─── AUTO-STOP + SALVATAGGIO: 5 min dopo l'ultima serie spuntata ───
  AUTO_SAVE_MS: 5 * 60 * 1000,
  allSetsDone() {
    return this.exercises.length > 0 && this.exercises.every(s => this._done.has(s.id));
  },
  checkAutoSave() {
    clearTimeout(this._autoSaveTimer);
    if (this.viewMode || this.sessionDone || !this.activeId || !this.allSetsDone()) {
      if (this.activeId) localStorage.removeItem(`gymos_autosave_${this.activeId}`);
      return;
    }
    // tutte le serie fatte → salva da solo tra 5 min se non lo fai tu
    localStorage.setItem(`gymos_autosave_${this.activeId}`, Date.now() + this.AUTO_SAVE_MS);
    this._autoSaveTimer = setTimeout(() => this._doAutoSave(), this.AUTO_SAVE_MS);
  },
  _doAutoSave() {
    if (this.viewMode || this.sessionDone || !this.activeId || !this.allSetsDone()) return;
    U.toast("Allenamento completato — salvataggio automatico 💪", "info");
    this.saveSession();   // ferma il timer durata, salva su Notion e torna al pulsante
  },

  // ─── AUTO-AVVIO timer durata: 5 min dopo la creazione, se dimentichi di avviarlo ───
  AUTO_START_MS: 5 * 60 * 1000,
  armSessionTimers() {
    clearTimeout(this._autoStartTimer);
    clearTimeout(this._autoSaveTimer);
    if (this.viewMode || this.sessionDone || !this.activeId) return;
    const id = this.activeId;

    // 1) auto-avvio durata (solo se non già avviato manualmente)
    if (!localStorage.getItem(`gymos_start_${id}`)) {
      const created = parseInt(localStorage.getItem(`gymos_created_${id}`) || "0");
      if (created) {
        const dueIn = created + this.AUTO_START_MS - Date.now();
        const fire = () => {
          if (this.activeId === id && !localStorage.getItem(`gymos_start_${id}`) && typeof DurationTimer !== "undefined") {
            DurationTimer.startAt(created);   // conta dalla creazione (totale corretto)
            U.toast("Timer durata avviato in automatico", "info");
          }
        };
        if (dueIn <= 0) fire();
        else this._autoStartTimer = setTimeout(fire, dueIn);
      }
    }

    // 2) recupera un auto-salvataggio già scaduto mentre l'app era in background
    const saveDue = parseInt(localStorage.getItem(`gymos_autosave_${id}`) || "0");
    if (saveDue) {
      if (this.allSetsDone()) {
        if (Date.now() >= saveDue) this._doAutoSave();
        else this._autoSaveTimer = setTimeout(() => this._doAutoSave(), saveDue - Date.now());
      } else {
        localStorage.removeItem(`gymos_autosave_${id}`);
      }
    }
  },

  // Aggiorna display + riepilogo + badge + statistiche + autosave dopo un cambio di valore
  refreshSetValue(set, exName) {
    const id = set.id;
    const repEl  = document.getElementById(`rep-${id}`);
    const kgEl   = document.getElementById(`kg-${id}`);
    const progEl = document.getElementById(`prog-${id}`);
    if (repEl) { repEl.textContent = set.reps > 0 ? set.reps : "0"; repEl.className = set.reps > 0 ? "stepper-val" : "stepper-val empty"; }
    if (kgEl)  { kgEl.textContent = U.fmt(set.kg); kgEl.className = set.kg > 0 ? "stepper-val" : "stepper-val empty"; }
    const sumKg = document.getElementById(`ssum-kg-${id}`);
    const sumRep = document.getElementById(`ssum-rep-${id}`);
    if (sumKg)  sumKg.textContent = U.fmt(set.kg);
    if (sumRep) sumRep.textContent = set.reps > 0 ? set.reps : "0";
    const sumWrap = document.getElementById(`sumwrap-${id}`);
    if (sumWrap) sumWrap.classList.toggle("empty", !(set.reps > 0));

    const grouped  = this.groupByExercise(this.exercises);
    const prevG    = this.groupByExercise(this.prevExercises);
    const prevSets = prevG[exName] || [];
    const setIdx   = grouped[exName]?.findIndex(s => s.id === id) ?? -1;
    const prevSet  = prevSets[setIdx] || null;
    const prevMax  = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
    if (progEl) progEl.innerHTML = this.buildStatusBadge(
      this.getProgression(set, prevSet), set, exName, set.rrMin || 8, set.rrMax || 12, prevMax
    );
    this.updateStats();
    this.refreshSetHints(exName);   // consigli serie successive in base a questa
    this.autosave(set);   // salvataggio automatico
  },

  // Tieni premuto +/−: dopo 400ms ripete ogni 90ms finché tieni premuto
  bindHold(btn) {
    const fire = () => this.adjSet(btn.dataset.id, btn.dataset.f, parseFloat(btn.dataset.d), btn.dataset.ex);
    let to = null, iv = null;
    const start = e => { if (e.cancelable) e.preventDefault(); fire(); to = setTimeout(() => { iv = setInterval(fire, 90); }, 400); };
    const stop  = () => { clearTimeout(to); clearInterval(iv); to = iv = null; };
    btn.addEventListener("pointerdown", start);
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => btn.addEventListener(ev, stop));
  },

  // ─── AUTOSAVE con debounce ───
  // Salva in Notion 800ms dopo l'ultima modifica (evita di sovraccaricare ad ogni +/−)
  _saveTimers: {},
  autosave(set) {
    this.setSyncState("saving");
    clearTimeout(this._saveTimers[set.id]);
    this._saveTimers[set.id] = setTimeout(async () => {
      try {
        await API.updateExerciseEntry(set.id, set.sets || 1, set.reps, set.kg, set.note);
        this.setSyncState("saved");
      } catch(e) {
        console.error("autosave fail:", e);
        this.setSyncState("error");
      }
    }, 800);
  },

  setSyncState(state) {
    const el = document.getElementById("sync-indicator");
    if (!el) return;
    if (state === "saving") {
      el.innerHTML = '<i class="ti ti-loader-2"></i> Salvataggio...';
      el.style.color = "var(--dim)";
    } else if (state === "saved") {
      el.innerHTML = '<i class="ti ti-cloud-check"></i> Salvato';
      el.style.color = "var(--green)";
    } else {
      el.innerHTML = '<i class="ti ti-cloud-x"></i> Errore salvataggio';
      el.style.color = "var(--red)";
    }
  },

  updateRR(exName, field, val) {
    if (this.viewMode) return;
    const grouped = this.groupByExercise(this.exercises);
    const sets = grouped[exName] || [];
    sets.forEach(s => {
      if (field === "min") s.rrMin = parseInt(val) || 0;
      if (field === "max") s.rrMax = parseInt(val) || 0;
    });
    // Il range appena cambiato è il nuovo bersaglio: aggiorna SUBITO il banner
    // e gli hint delle serie, non solo dopo il salvataggio su Notion.
    this.refreshGoals();
    this.refreshSetHints(exName);
    // Salva il range su tutte le serie dell'esercizio
    if (sets[0]) {
      clearTimeout(this._saveTimers["rr_" + exName]);
      this._saveTimers["rr_" + exName] = setTimeout(async () => {
        this.setSyncState("saving");
        try {
          await Promise.all(sets.map(s => API.update(s.id, {
            [CONFIG.PROPS.EL_RR_MIN]: API.prop.number(s.rrMin),
            [CONFIG.PROPS.EL_RR_MAX]: API.prop.number(s.rrMax),
          })));
          this.setSyncState("saved");
          this.syncSedutaMeta(exName);   // propaga il rep range anche sulla scheda
        } catch(e) { this.setSyncState("error"); }
      }, 800);
    }
  },

  // Recupero tra le serie (in header, come il rep range): salvato su tutte le serie
  updateRest(exName, val) {
    if (this.viewMode) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    const v = (val === "" ? null : Number(val));
    sets.forEach(s => { s.recupero = v; });
    if (sets[0]) {
      clearTimeout(this._saveTimers["rest_" + exName]);
      this._saveTimers["rest_" + exName] = setTimeout(async () => {
        this.setSyncState("saving");
        try {
          await Promise.all(sets.map(s => API.update(s.id, { [CONFIG.PROPS.EL_RECUPERO]: API.prop.number(v) })));
          this.setSyncState("saved");
          this.syncSedutaMeta(exName);
        } catch(e) { this.setSyncState("error"); }
      }, 800);
    }
  },

  // RIR (reps in reserve) per esercizio, in header come il rep range
  updateRIR(exName, val) {
    if (this.viewMode) return;
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    const v = (val === "" ? null : Number(val));
    sets.forEach(s => { s.rir = v; });
    this.refreshGoals();   // il banner cita il RIR: aggiornalo subito
    if (sets[0]) {
      clearTimeout(this._saveTimers["rir_" + exName]);
      this._saveTimers["rir_" + exName] = setTimeout(async () => {
        this.setSyncState("saving");
        try {
          await Promise.all(sets.map(s => API.update(s.id, { [CONFIG.PROPS.EL_RIR]: API.prop.number(v) })));
          this.setSyncState("saved");
          this.syncSedutaMeta(exName);
        } catch(e) { this.setSyncState("error"); }
      }, 800);
    }
  },

  updateStats() {
    let vol = 0, prevVol = 0, done = 0, ups = 0;
    const prevG = this.groupByExercise(this.prevExercises);
    this.exercises.forEach(s => {
      if (s.reps > 0) { vol += s.reps * (s.kg || 0); done++; }
    });
    this.prevExercises.forEach(s => {
      if (s.reps > 0) prevVol += s.reps * (s.kg || 0);
    });
    this.exercises.forEach(s => {
      const exName   = U.exBase(s.name);
      const prevSets = prevG[exName] || [];
      const si       = this.exercises.filter(e => U.exBase(e.name) === exName).indexOf(s);
      if (this.getProgression(s, prevSets[si] || null) === "up") ups++;
    });
    const d    = Math.round((vol - prevVol) * 10) / 10;
    const pct  = prevVol > 0 ? Math.round(d / prevVol * 100) : 0;
    // Mostra la % solo quando ha senso: se la sessione scorsa aveva un volume
    // trascurabile la percentuale diventa assurda (+45700%), meglio solo i kg.
    const showPct = prevVol > 0 && Math.abs(pct) <= 300;
    const dStr = (d > 0 ? "+" : "") + U.fmtV(d) + (showPct ? ` (${d > 0 ? "+" : ""}${pct}%)` : "");
    document.getElementById("ss-vol").textContent  = U.fmtV(vol);
    const de = document.getElementById("ss-delta");
    de.textContent = dStr;
    de.style.color = d > 0 ? "var(--green)" : d < 0 ? "var(--red)" : "var(--dim)";
    document.getElementById("ss-done").textContent = done;
    const ue = document.getElementById("ss-up");
    ue.textContent = ups;
    ue.style.color = ups > 0 ? "var(--green)" : "var(--dim)";
  },

  async saveNote(id, note) {
    if (this.viewMode) return;
    const set = this.exercises.find(e => e.id === id);
    if (set) {
      set.note = note;
      // Una nota (dolore/facile/duro) è una situazione reale: l'hint della
      // serie successiva deve saperlo SUBITO, non solo dopo aver toccato kg/rep.
      this.refreshSetHints(U.exBase(set.name));
    }
    this.setSyncState("saving");
    try {
      await API.update(id, { [CONFIG.PROPS.EL_NOTE]: API.prop.rich_text(note) });
      this.setSyncState("saved");
    } catch(e) {
      console.error(e);
      this.setSyncState("error");
    }
  },

  // ─── NOTE DELLA SESSIONE (intera) ───
  renderSessionNote(sess, prevSess) {
    const inp = document.getElementById("sess-note-input");
    if (inp) {
      inp.value = (sess && sess.note) || "";
      inp.readOnly = this.viewMode;              // sola lettura sulle sessioni passate
      inp.placeholder = this.viewMode ? "Nessuna nota per questa sessione" : "Sensazioni, energia, cosa migliorare la prossima volta…";
    }
    // nota della sessione precedente corrispondente (solo se esiste)
    const prevWrap = document.getElementById("sess-note-prev");
    if (prevWrap) {
      const pn = (prevSess && (prevSess.note || "").trim()) || "";
      if (pn) {
        const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        prevWrap.innerHTML = `<button type="button" class="prev-notes-toggle" onclick="Session.togglePrevNotes(this, event)">
            <i class="ti ti-notes"></i><span>Nota scorsa volta</span>
            <i class="ti ti-chevron-down pn-chev"></i>
          </button>
          <div class="prev-notes-body"><div class="pn-line"><span>${esc(pn)}</span></div></div>`;
        prevWrap.style.display = "";
      } else {
        prevWrap.innerHTML = "";
        prevWrap.style.display = "none";
      }
    }
  },

  saveSessionNote(val) {
    if (this.viewMode || !this.activeId) return;
    const id = this.activeId;
    const sess = this.sessions.find(s => s.id === id);
    if (sess) sess.note = val;   // aggiorna in memoria (così ricompare come "scorsa volta")
    clearTimeout(this._saveTimers["sessnote"]);
    this._saveTimers["sessnote"] = setTimeout(async () => {
      this.setSyncState("saving");
      try {
        await API.update(id, { [CONFIG.PROPS.WL_NOTE]: API.prop.rich_text(val || "") });
        this.setSyncState("saved");
      } catch(e) { console.error("saveSessionNote:", e); this.setSyncState("error"); }
    }, 800);
  },

  // ═══ RIEPILOGO FINE ALLENAMENTO ═══
  // Raccoglie i numeri della sessione PRIMA che lo stato venga pulito.
  _collectSummary(mins) {
    let vol = 0, prevVol = 0, done = 0, ups = 0;
    const prevG = this.groupByExercise(this.prevExercises);
    this.exercises.forEach(s => { if (s.reps > 0) { vol += s.reps * (s.kg || 0); done++; } });
    this.prevExercises.forEach(s => { if (s.reps > 0) prevVol += s.reps * (s.kg || 0); });
    this.exercises.forEach(s => {
      const exName = U.exBase(s.name);
      const si = this.exercises.filter(e => U.exBase(e.name) === exName).indexOf(s);
      if (this.getProgression(s, (prevG[exName] || [])[si] || null) === "up") ups++;
    });
    // Esercizi che hanno segnato un record in questa sessione
    const prExs = [...new Set(this.exercises
      .filter(s => this._prSets && this._prSets.has(s.id))
      .map(s => U.exBase(s.name)))];
    const sess = this.sessions.find(s => s.id === this.activeId);
    return { name: sess ? sess.name : "", mins, vol, prevVol, done, ups, prExs };
  },

  showSummary(d) {
    const esc = t => String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    document.getElementById("sum-sess").textContent = d.name || "";
    document.getElementById("sum-durata").textContent = d.mins > 0 ? `${d.mins} min` : "—";
    document.getElementById("sum-vol").textContent = U.fmtV(d.vol);
    document.getElementById("sum-serie").textContent = d.done;
    const upEl = document.getElementById("sum-up");
    upEl.textContent = d.ups; upEl.style.color = d.ups > 0 ? "var(--green)" : "var(--text)";
    const de = document.getElementById("sum-delta");
    if (d.prevVol > 0) {
      const diff = Math.round((d.vol - d.prevVol) * 10) / 10;
      const pct  = Math.round(diff / d.prevVol * 100);
      const okPct = Math.abs(pct) <= 300;
      de.innerHTML = `<i class="ti ${diff >= 0 ? "ti-trending-up" : "ti-trending-down"}"></i> ${diff >= 0 ? "+" : ""}${U.fmtV(diff)} vs scorsa${okPct ? ` (${diff >= 0 ? "+" : ""}${pct}%)` : ""}`;
      de.style.color = diff > 0 ? "var(--green)" : diff < 0 ? "var(--red)" : "var(--dim)";
      de.style.display = "";
    } else de.style.display = "none";
    const pr = document.getElementById("sum-prs");
    pr.innerHTML = d.prExs.length
      ? `<div class="sum-pr-head"><i class="ti ti-trophy"></i> ${d.prExs.length === 1 ? "Nuovo record" : d.prExs.length + " nuovi record"}</div>` +
        d.prExs.map(n => `<span class="sum-pr-chip">${esc(n)}</span>`).join("")
      : "";
    document.getElementById("workout-summary").style.display = "flex";
  },

  closeSummary() {
    document.getElementById("workout-summary").style.display = "none";
  },

  // #D — Conferma prima di concludere: il tasto Salva marca l'allenamento come
  // FATTO (irreversibile a colpo d'occhio), e capitava di premerlo per sbaglio
  // salvando una sessione non finita. Mostra quante serie mancano.
  async confirmAndSave() {
    if (this.viewMode) { U.toast("Sei in sola visualizzazione — sblocca per salvare", "info"); return; }
    // Guardia anti doppio-tap: senza, due tap rapidi su Salva aprivano due
    // dialog di conferma e, confermando entrambi, saveSession girava due volte
    // in parallelo (doppia scrittura Notion, durata azzerata al secondo giro).
    if (this._saving) return;
    this._saving = true;
    try { await this._confirmAndSaveInner(); } finally { this._saving = false; }
  },
  async _confirmAndSaveInner() {
    const grouped = this.groupByExercise(this.exercises);
    const exNames = Object.keys(grouped);
    const totalEx  = exNames.length;
    const doneEx   = exNames.filter(n => (grouped[n] || []).some(s => (s.reps || 0) > 0)).length;
    const totalSets = this.exercises.length;
    const doneSets  = this.exercises.filter(s => (s.reps || 0) > 0).length;
    const allDone   = totalSets > 0 && doneSets === totalSets;
    let msg;
    if (doneSets === 0) {
      msg = "Non hai ancora registrato nessuna serie. Vuoi davvero concludere e salvare l'allenamento?";
    } else if (!allDone) {
      const miss = totalSets - doneSets;
      msg = `Hai fatto ${doneEx}/${totalEx} esercizi (${doneSets}/${totalSets} serie): ${miss} ${miss === 1 ? "serie manca" : "serie mancano"} ancora. Concludere e salvare comunque?`;
    } else {
      msg = `Tutto completato: ${doneEx}/${totalEx} esercizi, ${doneSets} serie. Concludere e salvare l'allenamento?`;
    }
    const ok = await U.confirm(msg, { title: "Concludere l'allenamento?", okText: "Sì, salva", danger: !allDone });
    if (ok) await this.saveSession();   // await: tiene attiva la guardia _saving fino a fine salvataggio
  },

  async saveSession() {
    if (this.viewMode) { U.toast("Sei in sola visualizzazione — sblocca per salvare", "info"); return; }
    // I veri bottoni Salva (desktop + barra mobile) — NON il primo .btn-primary
    // del DOM, che è "Crea e inizia" del modale nuova sessione.
    const btns = [...document.querySelectorAll(".sess-save-desktop, .bn-save")];
    btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="ti ti-loader"></i> Salvataggio…'; });
    try {
      const updates = this.exercises
        .filter(s => s.reps > 0)
        .map(s => API.updateExerciseEntry(s.id, s.sets || 1, s.reps, s.kg, s.note));
      await Promise.all(updates);
      let savedMins = 0;
      if (this.activeId) {
        const props = { [CONFIG.PROPS.WL_DONE]: API.prop.checkbox(true) };
        // Ferma il timer durata e salva i minuti
        if (typeof DurationTimer !== "undefined") {
          savedMins = DurationTimer.finishAndReset();
          if (savedMins > 0) props["Durata (min)"] = API.prop.number(savedMins);
        }
        await API.update(this.activeId, props);
      }
      // Raccogli i numeri del riepilogo ORA (prima della pulizia dello stato)
      const summary = this._collectSummary(savedMins);
      btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="ti ti-device-floppy"></i> Salva'; });
      // Pulizia: i flag locali di questa sessione non servono più una volta
      // salvata (Notion è ormai la fonte di verità) — senza, si accumulano
      // per sempre in localStorage, una chiave in più per ogni sessione mai
      // fatta (mesi/anni di uso = migliaia di chiavi morte).
      if (this.activeId) {
        localStorage.removeItem(`gymos_done_${this.activeId}`);
        localStorage.removeItem(`gymos_order_${this.activeId}`);
        localStorage.removeItem(`gymos_pr_${this.activeId}`);
        localStorage.removeItem(`gymos_exnote_${this.activeId}`);
        localStorage.removeItem(`gymos_created_${this.activeId}`);
        localStorage.removeItem(`gymos_autosave_${this.activeId}`);
      }
      // aggiorna l'elenco e torna alla schermata iniziale (pronto per il prossimo)
      try { this.sessions = await API.getWorkoutSessions(20); this.buildSelect(); } catch(_) {}
      this.showLanding();
      this.showSummary(summary);   // riepilogo sopra la schermata iniziale
    } catch(e) {
      console.error(e);
      btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="ti ti-alert-circle"></i> Errore'; });
      U.toast("Errore nel salvataggio — riprova", "err");
    }
  },

  sanitize: str => str.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
};

function switchSession(id) { Session.loadSession(id); }
function saveSession()     { Session.confirmAndSave(); }

// Riprendendo l'app (torna in primo piano) ricontrolla auto-avvio/auto-salvataggio
// della sessione in corso (i setTimeout in background possono essere sospesi).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Session.activeId && !Session.sessionDone && !Session.viewMode) {
    Session.armSessionTimers();
    // Il timer durata (a differenza del RestTimer) non si risincronizzava al
    // ritorno in app: se il telefono sospende il setInterval mentre sei fuori,
    // il display restava fermo. Ricalcola subito dal timestamp reale.
    if (typeof DurationTimer !== "undefined" && DurationTimer.startTime) DurationTimer.tick();
  }
});

// ─── MODAL NUOVA SESSIONE ───
(function() {
  let _scheda = null;

  // Avvio rapido dalla Home: porta in Sessione e apre subito il modale "nuova sessione"
  Session.openNewFromHome = function() {
    App.navigate("session");
    Session.openNewModal();
  };

  Session.openNewModal = async function() {
    _scheda = null;
    const modal = document.getElementById("new-sess-modal");
    const today = new Date();
    const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
    document.getElementById("modal-date").textContent =
      today.getDate() + " " + months[today.getMonth()] + " " + today.getFullYear();

    const wrap = document.getElementById("modal-schede");
    wrap.innerHTML = '<div style="font-size:12px;color:var(--dim)">Caricamento schede...</div>';
    document.getElementById("modal-msg").textContent = "";
    modal.style.display = "flex";

    // Ricarica le schede da Notion così riflette le modifiche
    if (typeof App !== "undefined" && App.loadSchede) {
      await App.loadSchede();
    }

    // Trova l'ultimo allenamento COMPLETATO e suggerisci il prossimo in rotazione
    var sessList = (Session.sessions && Session.sessions.length) ? Session.sessions : [];
    if (!sessList.length) { try { sessList = await API.getWorkoutSessions(20); } catch (e) { sessList = []; } }
    var doneSorted = sessList.filter(function(s){ return s.done; })
      .sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
    var lastDone = doneSorted[0] || null;
    var lastType = lastDone ? lastDone.type : null;
    var names    = Object.keys(CONFIG.SCHEDE);
    var nextName = null;
    if (lastType && names.indexOf(lastType) !== -1) {
      nextName = names[(names.indexOf(lastType) + 1) % names.length];
    }
    function relDay(ds) {
      if (!ds) return "";
      var d = new Date(ds), n = new Date();
      var diff = Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate())
        - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      if (diff <= 0) return "oggi";
      if (diff === 1) return "ieri";
      return diff + " giorni fa";
    }

    wrap.innerHTML = "";
    Object.entries(CONFIG.SCHEDE).forEach(function(entry) {
      var name = entry[0];
      var cfg  = entry[1];
      var btn  = document.createElement("button");
      btn.className   = "scheda-pill";
      btn.type        = "button";
      btn.dataset.name = name;
      var badge = "";
      if (name === lastType) {
        btn.classList.add("is-last");
        badge = '<span class="pill-badge last"><i class="ti ti-history"></i>ultimo · ' + relDay(lastDone.date) + '</span>';
      } else if (name === nextName) {
        btn.classList.add("is-next");
        badge = '<span class="pill-badge next"><i class="ti ti-arrow-right"></i>consigliato</span>';
      }
      btn.innerHTML = '<span class="pill-name">' + name + '</span>' + badge;
      btn.onclick     = function() {
        wrap.querySelectorAll(".scheda-pill").forEach(function(b) {
          b.classList.remove("on");
          b.style.background  = "";
          b.style.borderColor = "";
        });
        btn.classList.add("on");
        btn.style.background  = cfg.color + "22";
        btn.style.borderColor = cfg.color;
        _scheda = name;
        document.getElementById("modal-msg").textContent = "Selezionato: " + name;
      };
      wrap.appendChild(btn);
    });
    if (!Object.keys(CONFIG.SCHEDE).length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--dim)">Nessuna scheda. Creane una nella sezione Schede.</div>';
    }
    // pre-seleziona il consigliato così basta premere "Crea e inizia"
    if (nextName) {
      var pre = [].slice.call(wrap.querySelectorAll(".scheda-pill"))
        .find(function(b){ return b.dataset.name === nextName; });
      if (pre) pre.click();
    }

    document.getElementById("modal-confirm-btn").onclick = function() {
      if (!_scheda) {
        document.getElementById("modal-msg").textContent = "Scegli una sessione!";
        return;
      }
      Session._doCreateSession(_scheda);
    };
    modal.style.display = "flex";
  };

  Session.closeNewModal = function(e) {
    if (!e || e.target.id === "new-sess-modal") {
      document.getElementById("new-sess-modal").style.display = "none";
    }
  };
})();

Session._doCreateSession = async function(name) {
  const btn = document.getElementById("modal-confirm-btn");
  const msg = document.getElementById("modal-msg");
  btn.disabled = true;
  btn.textContent = "Creazione...";

  try {
    const today = U.today();   // data locale, non UTC (sessione creata dopo mezzanotte = giorno giusto)
    const sessProps = {};
    sessProps[CONFIG.PROPS.WL_NAME]  = API.prop.title(name);
    sessProps[CONFIG.PROPS.WL_DATE]  = API.prop.date(today);
    sessProps[CONFIG.PROPS.WL_TYPE]  = API.prop.select(name);
    sessProps[CONFIG.PROPS.WL_DONE]  = API.prop.checkbox(false);
    sessProps[CONFIG.PROPS.WL_SPLIT] = API.prop.select("Full Body");

    const newSess = await API.create(CONFIG.DB.WORKOUT_LOG, sessProps);
    const sessId  = newSess.id;
    localStorage.setItem(`gymos_created_${sessId}`, Date.now());   // per l'auto-avvio del timer durata

    const exercises = CONFIG.SCHEDE[name].exercises || [];
    const creates   = [];
    exercises.forEach(function(item) {
      var exNm  = U.exName(item);
      var nSets = U.exSets(item);   // quante serie creare per questo esercizio
      var rec   = U.exRest(item);
      var rir   = U.exRir(item);
      var tec   = U.exTec(item);
      var cad   = U.exCad(item);
      var inf   = U.exInfo(item);
      var grp   = U.exGrp(item);
      for (var i = 1; i <= nSets; i++) {
        var props = {};
        props[CONFIG.PROPS.EL_NAME]    = API.prop.title(exNm + " – " + name + " – S" + i);
        props[CONFIG.PROPS.EL_SESSION] = API.prop.relation([sessId]);
        props[CONFIG.PROPS.EL_SETS]    = API.prop.number(1);
        props[CONFIG.PROPS.EL_REPS]    = API.prop.number(0);
        props[CONFIG.PROPS.EL_KG]      = API.prop.number(0);
        props[CONFIG.PROPS.EL_RR_MIN]  = API.prop.number(8);
        props[CONFIG.PROPS.EL_RR_MAX]  = API.prop.number(12);
        props[CONFIG.PROPS.EL_RECUPERO]= API.prop.number(rec);
        props[CONFIG.PROPS.EL_RIR]     = API.prop.number(rir);
        props[CONFIG.PROPS.EL_TECNICA] = API.prop.multi_select(tec);
        props[CONFIG.PROPS.EL_CADENZA] = API.prop.rich_text(cad);
        props[CONFIG.PROPS.EL_GRUPPO]  = API.prop.select(grp);
        props[CONFIG.PROPS.EL_INFO]    = API.prop.rich_text(inf);
        props[CONFIG.PROPS.EL_DATE]    = API.prop.date(today);
        creates.push(API.create(CONFIG.DB.ESERCIZI_LOG, props));
      }
    });
    await Promise.all(creates);

    Session.sessions = await API.getWorkoutSessions(20);
    Session.buildSelect();
    const sel = document.getElementById("sess-select");
    if (sel) sel.value = sessId;

    document.getElementById("new-sess-modal").style.display = "none";
    await Session.loadSession(sessId);

  } catch(e) {
    console.error(e);
    msg.textContent = "Errore: " + e.message;
    msg.style.color = "var(--red)";
    btn.disabled = false;
    btn.textContent = "Crea e inizia";
  }
};
