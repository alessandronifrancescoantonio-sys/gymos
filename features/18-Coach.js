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
  _esc(s) { return U.escape(s); },

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
    // Blocchi di codice ```...```: l'utente li vede come un pezzo di codice
    // grezzo in cima al messaggio, non come testo formattato — l'app parla di
    // allenamento, non ha senso che il coach risponda con blocchi di codice.
    // Li spogliamo SEMPRE, qualunque cosa Gemini mandi: prima ancora di
    // escapare, così il testo dentro passa dritto nella normale formattazione
    // invece di restare intrappolato in ``` letterali.
    raw = String(raw == null ? "" : raw).replace(/```[a-z]*\n?([\s\S]*?)```/gi, "$1").trim();
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
      const res = await AIClient.fetch(`${CONFIG.AI_WORKER_URL}/embed`, {
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
        `<a class="coach-source" href="${U.url(s.uri)}" target="_blank" rel="noopener">${this._esc(s.title)}</a>`).join("");
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
      const res = await AIClient.fetch(`${CONFIG.AI_WORKER_URL}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context: Object.keys(context).length ? context : undefined, history }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        // Il worker inoltra il body JSON di errore anche sui fallimenti (502
        // include `detail`, il vero motivo di Gemini) — prima veniva ignorato
        // e si mostrava solo "errore 502, riprova": con la quota gratuita
        // Gemini esaurita (20 richieste/giorno, condivisa tra consiglio
        // automatico/coach/report) "riprova" invitava a ritentare all'infinito
        // qualcosa che non si risolve prima di domani.
        let detail = "";
        try { const j = await res.json(); detail = (j && (j.detail || j.error)) || ""; } catch (e) {}
        if (/RESOURCE_EXHAUSTED|quota/i.test(detail)) {
          throw new Error("Quota giornaliera Gemini esaurita (troppe richieste oggi tra consiglio automatico e coach) — riprova domani, non è un errore da ritentare ora");
        }
        throw new Error("Il coach non ha risposto (errore " + res.status + ")");
      }
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
