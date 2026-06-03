// ═══════════════════════════════════════════════
//  GymOS — session.js
// ═══════════════════════════════════════════════

const Session = {
  sessions: [],       // lista sessioni dal Workout Log
  activeId: null,     // ID sessione selezionata
  exercises: [],      // esercizi della sessione attiva
  prevExercises: [],  // esercizi dell'ultima sessione dello stesso tipo

  async load() {
    try {
      this.sessions = await API.getWorkoutSessions(20);
      this.buildSelect();
      if (this.sessions.length > 0) {
        this.activeId = this.sessions[0].id;
        await this.loadSession(this.activeId);
      }
    } catch(e) {
      console.error("Session.load:", e);
    }
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
    const sess = this.sessions.find(s => s.id === id);
    if (!sess) return;

    document.getElementById("sess-title").textContent = sess.name.toUpperCase();
    document.getElementById("sess-meta").textContent =
      `Oggi: ${U.fmtDate(sess.date)} · Tipo: ${sess.type || "—"}`;

    // Carica esercizi sessione corrente
    this.exercises = await API.getSessionExercises(id);

    // Trova ultima sessione dello stesso tipo per confronto
    const sameType = this.sessions.filter(s =>
      s.id !== id && s.type === sess.type
    );
    this.prevExercises = sameType.length > 0
      ? await API.getSessionExercises(sameType[0].id)
      : [];

    this.renderExercises();
    this.updateStats();
  },

  // Raggruppa entries per nome esercizio
  groupByExercise(entries) {
    const map = {};
    entries.forEach(e => {
      const name = e.name.split(" – ")[0] || e.name;
      if (!map[name]) map[name] = [];
      map[name].push(e);
    });
    return map;
  },

  renderExercises() {
    const container = document.getElementById("exercises-container");
    container.innerHTML = "";

    const grouped     = this.groupByExercise(this.exercises);
    const prevGrouped = this.groupByExercise(this.prevExercises);

    let exIdx = 0;
    Object.entries(grouped).forEach(([exName, sets]) => {
      exIdx++;
      const prevSets = prevGrouped[exName] || [];
      const rrMin = sets[0]?.rrMin || 8;
      const rrMax = sets[0]?.rrMax || 12;
      const prevMax = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;

      const block = document.createElement("div");
      block.className = "ex-block";
      block.innerHTML = `
        <div class="ex-hd">
          <span class="ex-num">${exIdx}</span>
          <span class="ex-name">${exName}</span>
          ${prevMax > 0 ? `<span class="ex-storico">max ${U.fmt(prevMax)} kg</span>` : ""}
          <div class="rr-wrap">
            <span class="rr-lbl">Target</span>
            <input class="rr-in" type="number" value="${rrMin}" min="1" max="40"
              oninput="Session.updateRR('${exName}', 'min', this.value)" title="Rep minime">
            <span class="rr-sep">–</span>
            <input class="rr-in" type="number" value="${rrMax}" min="1" max="40"
              oninput="Session.updateRR('${exName}', 'max', this.value)" title="Rep massime">
            <span class="rr-lbl">rep</span>
          </div>
        </div>
        <div class="col-lbl">
          <div class="col-lbl-inner">
            <span></span>
            <span class="cl cl-prev">Scorsa volta</span>
            <span></span>
            <span class="cl cl-today">Oggi — rep × kg</span>
            <span class="cl">Progr.</span>
            <span class="cl" style="text-align:left;padding-left:10px">Note</span>
          </div>
        </div>
        <div id="sets-${this.sanitize(exName)}"></div>
      `;
      container.appendChild(block);

      // Render set rows
      const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
      sets.forEach((set, si) => {
        const prevSet = prevSets[si] || null;
        setsContainer.appendChild(this.buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax));
      });
    });
  },

  buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax) {
    const row = document.createElement("div");
    row.className = "set-row";
    row.id = `setrow-${set.id}`;

    const prevHTML = prevSet
      ? `<span class="pv">${prevSet.reps}r</span><span class="px">×</span><span class="pv">${U.fmt(prevSet.kg)} kg</span>`
      : `<span class="pe">—</span>`;

    const prog = this.getProgression(set, prevSet);
    const status = this.buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax);

    const repDisp = set.reps > 0 ? set.reps : "—";
    const repCls  = set.reps > 0 ? "tv" : "tv empty";

    row.innerHTML = `
      <div style="display:flex;justify-content:center">
        <div class="sn">${si + 1}</div>
      </div>
      <div class="prev-blk">${prevHTML}</div>
      <div class="vdiv"><div class="vl"></div></div>
      <div class="today-blk">
        <button class="adj" onclick="Session.adjSet('${set.id}','r',-1,'${exName}')">−</button>
        <span class="${repCls}" id="rep-${set.id}">${repDisp}</span>
        <span class="t-x">r</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','r',1,'${exName}')">+</button>
        <div class="t-dot"></div>
        <button class="adj" onclick="Session.adjSet('${set.id}','k',-2.5,'${exName}')">−</button>
        <span class="tv" id="kg-${set.id}">${U.fmt(set.kg)}</span>
        <span class="t-unit">kg</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','k',2.5,'${exName}')">+</button>
      </div>
      <div class="prog-cell" id="prog-${set.id}">${status}</div>
      <div class="note-cell">
        <input class="note-inp" type="text" value="${set.note || ""}"
          placeholder="forma, sensazione..."
          onchange="Session.saveNote('${set.id}', this.value)">
      </div>
    `;
    return row;
  },

  getProgression(set, prevSet) {
    if (!set.reps || set.reps === 0) return "mt";
    if (!prevSet) return "new";
    const vOggi  = set.reps  * (set.kg  || 1);
    const vScors = prevSet.reps * (prevSet.kg || 1);
    if (vOggi > vScors) return "up";
    if (vOggi === vScors) return "eq";
    return "dn";
  },

  buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax) {
    const isPR = set.kg > prevMax && prevMax > 0 && set.reps > 0;
    const prTag = isPR ? '<span class="pr-tag">PR</span>' : "";
    if (prog === "mt")  return '<span class="badge b-mt">da fare</span>';
    if (prog === "new") return '<span class="badge b-eq">nuovo</span>';
    if (prog === "up")  return `<span class="badge b-up"><i class="ti ti-trending-up" style="font-size:10px"></i>Su</span>${prTag}`;
    if (prog === "eq")  return `<span class="badge b-eq"><i class="ti ti-minus" style="font-size:10px"></i>Uguale</span>`;
    return `<span class="badge b-dn"><i class="ti ti-trending-down" style="font-size:10px"></i>Giù</span>`;
  },

  adjSet(id, field, delta, exName) {
    const set = this.exercises.find(e => e.id === id);
    if (!set) return;
    if (field === "r") set.reps = Math.max(0, (set.reps || 0) + delta);
    if (field === "k") set.kg   = Math.max(0, Math.round(((set.kg || 0) + delta) * 10) / 10);

    // Aggiorna UI
    const repEl  = document.getElementById(`rep-${id}`);
    const kgEl   = document.getElementById(`kg-${id}`);
    const progEl = document.getElementById(`prog-${id}`);

    if (repEl) { repEl.textContent = set.reps || "—"; repEl.className = set.reps > 0 ? "tv" : "tv empty"; }
    if (kgEl)  kgEl.textContent = U.fmt(set.kg);

    // Ricalcola badge progressione
    const grouped  = this.groupByExercise(this.exercises);
    const prevG    = this.groupByExercise(this.prevExercises);
    const prevSets = prevG[exName] || [];
    const setIdx   = grouped[exName]?.findIndex(s => s.id === id) ?? -1;
    const prevSet  = prevSets[setIdx] || null;
    const prevMax  = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
    const rrMin    = set.rrMin || 8;
    const rrMax    = set.rrMax || 12;

    if (progEl) progEl.innerHTML = this.buildStatusBadge(
      this.getProgression(set, prevSet), set, exName, rrMin, rrMax, prevMax
    );

    this.updateStats();
  },

  updateRR(exName, field, val) {
    const grouped = this.groupByExercise(this.exercises);
    const sets = grouped[exName] || [];
    sets.forEach(s => {
      if (field === "min") s.rrMin = parseInt(val) || 0;
      if (field === "max") s.rrMax = parseInt(val) || 0;
    });
  },

  updateStats() {
    let vol = 0, prevVol = 0, done = 0, ups = 0;
    const prevG = this.groupByExercise(this.prevExercises);

    this.exercises.forEach(s => {
      if (s.reps > 0) {
        vol += s.reps * (s.kg || 0);
        done++;
      }
    });

    this.prevExercises.forEach(s => {
      if (s.reps > 0) prevVol += s.reps * (s.kg || 0);
    });

    this.exercises.forEach(s => {
      const exName  = s.name.split(" – ")[0];
      const prevSets = prevG[exName] || [];
      const si       = this.exercises.filter(e => e.name.split(" – ")[0] === exName).indexOf(s);
      const prev     = prevSets[si] || null;
      if (this.getProgression(s, prev) === "up") ups++;
    });

    const d    = Math.round((vol - prevVol) * 10) / 10;
    const pct  = prevVol > 0 ? Math.round(d / prevVol * 100) : 0;
    const dStr = (d > 0 ? "+" : "") + U.fmtV(d) + (prevVol > 0 ? ` (${d > 0 ? "+" : ""}${pct}%)` : "");

    document.getElementById("ss-vol").textContent   = U.fmtV(vol);
    const de = document.getElementById("ss-delta");
    de.textContent  = dStr;
    de.style.color  = d > 0 ? "var(--green)" : d < 0 ? "var(--red)" : "var(--dim)";
    document.getElementById("ss-done").textContent  = done;
    const ue = document.getElementById("ss-up");
    ue.textContent  = ups;
    ue.style.color  = ups > 0 ? "var(--green)" : "var(--dim)";
  },

  async saveNote(id, note) {
    const set = this.exercises.find(e => e.id === id);
    if (!set) return;
    set.note = note;
    await API.update(id, { [CONFIG.PROPS.EL_NOTE]: API.prop.rich_text(note) }).catch(console.error);
  },

  async saveSession() {
    const btn = document.querySelector(".btn-primary");
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader"></i>Salvataggio...';

    try {
      const updates = this.exercises
        .filter(s => s.reps > 0)
        .map(s => API.updateExerciseEntry(s.id, s.sets || 1, s.reps, s.kg, s.note));
      await Promise.all(updates);

      // Segna sessione come completata
      if (this.activeId) {
        await API.update(this.activeId, {
          [CONFIG.PROPS.WL_DONE]: API.prop.checkbox(true)
        });
      }

      btn.innerHTML = '<i class="ti ti-circle-check"></i>Salvato!';
      btn.style.background = "var(--green)";
      setTimeout(() => {
        btn.innerHTML = '<i class="ti ti-device-floppy"></i>Salva sessione';
        btn.style.background = "";
        btn.disabled = false;
      }, 2000);
    } catch(e) {
      console.error(e);
      btn.innerHTML = '<i class="ti ti-alert-circle"></i>Errore';
      btn.disabled = false;
    }
  },

  sanitize: str => str.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
};

// Wrappers globali per onclick inline
function switchSession(id)  { Session.loadSession(id); }
function saveSession()      { Session.saveSession();   }
