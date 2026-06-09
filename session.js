// ═══════════════════════════════════════════════
//  GymOS — session.js
//  + Aggiungi serie | Drag & drop ordine | × Rimuovi serie
// ═══════════════════════════════════════════════

const Session = {
  sessions:     [],
  activeId:     null,
  exercises:    [],
  prevExercises:[],
  exOrder:      [], // ordine esercizi (array di nomi)
  dragging:     null,

  async load() {
    try {
      this.sessions = await API.getWorkoutSessions(20);
      this.buildSelect();
      if (this.sessions.length > 0) {
        this.activeId = this.sessions[0].id;
        await this.loadSession(this.activeId);
      }
    } catch(e) { console.error("Session.load:", e); }
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
      `${U.fmtDate(sess.date)} · ${sess.type || "—"}`;

    this.exercises = await API.getSessionExercises(id);

    // Ordine: usa exOrder salvato per questa sessione, o quello di arrivo da Notion
    const grouped = this.groupByExercise(this.exercises);
    const keys = Object.keys(grouped);
    // Mantieni ordine custom se compatibile, altrimenti usa quello di Notion
    const savedOrder = JSON.parse(localStorage.getItem(`gymos_order_${id}`) || "null");
    if (savedOrder && savedOrder.every(n => keys.includes(n))) {
      this.exOrder = savedOrder;
    } else {
      this.exOrder = keys;
    }

    // Sessione precedente stesso tipo
    const sameType = this.sessions.filter(s => s.id !== id && s.type === sess.type);
    this.prevExercises = sameType.length > 0
      ? await API.getSessionExercises(sameType[0].id)
      : [];

    this.renderExercises();
    this.updateStats();
  },

  groupByExercise(entries) {
    const map = {};
    entries.forEach(e => {
      const name = e.name.split(" – ")[0] || e.name;
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
      const prevMax = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;

      const block = document.createElement("div");
      block.className  = "ex-block";
      block.dataset.ex = exName;
      block.draggable  = true;

      block.innerHTML = `
        <div class="ex-hd" title="Trascina per riordinare">
          <span class="drag-handle" aria-label="Trascina"><i class="ti ti-grip-vertical"></i></span>
          <span class="ex-num">${exIdx + 1}</span>
          <span class="ex-name">${exName}</span>
          ${prevMax > 0 ? `<span class="ex-storico">max ${U.fmt(prevMax)} kg</span>` : ""}
          <div class="rr-wrap">
            <span class="rr-lbl">Target</span>
            <input class="rr-in" type="number" value="${rrMin}" min="1" max="40"
              oninput="Session.updateRR('${exName}','min',this.value)">
            <span class="rr-sep">–</span>
            <input class="rr-in" type="number" value="${rrMax}" min="1" max="40"
              oninput="Session.updateRR('${exName}','max',this.value)">
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
            <span></span>
          </div>
        </div>
        <div id="sets-${this.sanitize(exName)}"></div>
        <div class="add-set-row">
          <button class="add-set-btn" onclick="Session.addSet('${exName}')">
            <i class="ti ti-plus"></i> Aggiungi serie
          </button>
        </div>
      `;

      // Drag & drop
      block.addEventListener("dragstart", e => {
        this.dragging = block;
        block.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      block.addEventListener("dragend", () => {
        block.classList.remove("dragging");
        this.dragging = null;
        // Aggiorna exOrder in base all'ordine DOM attuale
        this.exOrder = [...container.querySelectorAll(".ex-block")]
          .map(b => b.dataset.ex);
        this.saveOrder();
        this.renumberBlocks();
      });
      block.addEventListener("dragover", e => {
        e.preventDefault();
        if (!this.dragging || this.dragging === block) return;
        const rect = block.getBoundingClientRect();
        const mid  = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          container.insertBefore(this.dragging, block);
        } else {
          container.insertBefore(this.dragging, block.nextSibling);
        }
      });

      container.appendChild(block);

      // Set rows
      const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
      sets.forEach((set, si) => {
        const prevSet = prevSets[si] || null;
        setsContainer.appendChild(this.buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax));
      });
    });
  },

  renumberBlocks() {
    document.querySelectorAll(".ex-block").forEach((b, i) => {
      const num = b.querySelector(".ex-num");
      if (num) num.textContent = i + 1;
    });
  },

  buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax) {
    const row = document.createElement("div");
    row.className = "set-row";
    row.id = `setrow-${set.id}`;

    const prevHTML = prevSet
      ? `<span class="pv">${prevSet.reps}r</span><span class="px">×</span><span class="pv">${U.fmt(prevSet.kg)} kg</span>`
      : `<span class="pe">—</span>`;

    const prog   = this.getProgression(set, prevSet);
    const status = this.buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax);
    const repCls = set.reps > 0 ? "tv" : "tv empty";

    row.innerHTML = `
      <div style="display:flex;justify-content:center">
        <div class="sn">${si + 1}</div>
      </div>
      <div class="prev-blk">${prevHTML}</div>
      <div class="vdiv"><div class="vl"></div></div>
      <div class="today-blk">
        <button class="adj" onclick="Session.adjSet('${set.id}','r',-1,'${exName}')">−</button>
        <span class="${repCls}" id="rep-${set.id}">${set.reps > 0 ? set.reps : "—"}</span>
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
          onchange="Session.saveNote('${set.id}',this.value)">
      </div>
      <div style="display:flex;align-items:center;padding-left:8px">
        <button class="rm-set-btn" onclick="Session.removeSet('${set.id}','${exName}')" title="Rimuovi serie">
          <i class="ti ti-x"></i>
        </button>
      </div>
    `;
    return row;
  },

  // ─── AGGIUNGI SERIE ───
  async addSet(exName) {
    const grouped  = this.groupByExercise(this.exercises);
    const existing = grouped[exName] || [];
    const last     = existing[existing.length - 1];
    const si       = existing.length;
    const sess     = this.sessions.find(s => s.id === this.activeId);
    const date     = sess?.date || U.today();

    // Trova il page ID dell'esercizio in Esercizi Master
    const masterEntry = this.exercises.find(e =>
      e.name.split(" – ")[0] === exName
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

    // Aggiungi relazione esercizio se disponibile
    if (masterEntry) {
      // cerca l'ID dell'esercizio master dalla prima entry esistente
      const firstEntry = this.exercises.find(e => e.name.split(" – ")[0] === exName);
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
      };
      this.exercises.push(newSet);

      // Aggiunge la riga UI senza re-render completo
      const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
      const prevGrouped   = this.groupByExercise(this.prevExercises);
      const prevSets      = prevGrouped[exName] || [];
      const prevSet       = prevSets[si] || null;
      const prevMax       = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
      setsContainer.appendChild(
        this.buildSetRow(newSet, si, prevSet, exName, newSet.rrMin, newSet.rrMax, prevMax)
      );
      this.updateStats();
    } catch(e) {
      console.error("addSet error:", e);
      alert("Errore nell'aggiungere la serie. Controlla la connessione.");
    }
  },

  // ─── RIMUOVI SERIE ───
  async removeSet(id, exName) {
    if (!confirm("Rimuovere questa serie?")) return;
    // Rimuovi da UI
    const row = document.getElementById(`setrow-${id}`);
    if (row) row.remove();
    // Rimuovi da array locale
    this.exercises = this.exercises.filter(e => e.id !== id);
    // Archivia in Notion (non possiamo cancellare, quindi la segniamo come 0 serie)
    await API.update(id, {
      [CONFIG.PROPS.EL_REPS]: API.prop.number(0),
      [CONFIG.PROPS.EL_SETS]: API.prop.number(0),
    }).catch(console.error);
    this.updateStats();
    // Rinumera le serie
    const setsContainer = document.getElementById(`sets-${this.sanitize(exName)}`);
    if (setsContainer) {
      [...setsContainer.querySelectorAll(".sn")].forEach((sn, i) => {
        sn.textContent = i + 1;
      });
    }
  },

  getProgression(set, prevSet) {
    if (!set.reps || set.reps === 0) return "mt";
    if (!prevSet) return "new";
    const vOggi  = set.reps * (set.kg  || 1);
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

    const repEl  = document.getElementById(`rep-${id}`);
    const kgEl   = document.getElementById(`kg-${id}`);
    const progEl = document.getElementById(`prog-${id}`);
    if (repEl) { repEl.textContent = set.reps || "—"; repEl.className = set.reps > 0 ? "tv" : "tv empty"; }
    if (kgEl)  kgEl.textContent = U.fmt(set.kg);

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
  },

  updateRR(exName, field, val) {
    const grouped = this.groupByExercise(this.exercises);
    (grouped[exName] || []).forEach(s => {
      if (field === "min") s.rrMin = parseInt(val) || 0;
      if (field === "max") s.rrMax = parseInt(val) || 0;
    });
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
      const exName   = s.name.split(" – ")[0];
      const prevSets = prevG[exName] || [];
      const si       = this.exercises.filter(e => e.name.split(" – ")[0] === exName).indexOf(s);
      if (this.getProgression(s, prevSets[si] || null) === "up") ups++;
    });
    const d    = Math.round((vol - prevVol) * 10) / 10;
    const pct  = prevVol > 0 ? Math.round(d / prevVol * 100) : 0;
    const dStr = (d > 0 ? "+" : "") + U.fmtV(d) + (prevVol > 0 ? ` (${d > 0 ? "+" : ""}${pct}%)` : "");
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
    const set = this.exercises.find(e => e.id === id);
    if (set) set.note = note;
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

function switchSession(id) { Session.loadSession(id); }
function saveSession()     { Session.saveSession();   }

// ─── MODAL NUOVA SESSIONE ───
Session.selectedScheda = null;

Session.openNewModal = function() {
  const modal = document.getElementById("new-sess-modal");
  const today = new Date();
  const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
  document.getElementById("modal-date").textContent =
    `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;

  // Popola le schede
  const wrap = document.getElementById("modal-schede");
  wrap.innerHTML = "";
  Session.selectedScheda = null;
  Object.entries(CONFIG.SCHEDE).forEach(([name, cfg]) => {
    const btn = document.createElement("button");
    btn.className = "scheda-pill";
    btn.textContent = name;
    btn.style.setProperty("--sc", cfg.color);
    btn.onclick = () => {
      wrap.querySelectorAll(".scheda-pill").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      Session.selectedScheda = name;
    };
    wrap.appendChild(btn);
  });

  document.getElementById("modal-msg").textContent = "";
  modal.style.display = "flex";
};

Session.closeNewModal = function(e) {
  if (!e || e.target.id === "new-sess-modal" || e.currentTarget === document.getElementById("new-sess-modal")) {
    document.getElementById("new-sess-modal").style.display = "none";
  }
};

Session.createNewSession = async function() {
  if (!Session.selectedScheda) {
    document.getElementById("modal-msg").textContent = "Scegli il tipo di sessione!";
    return;
  }
  const btn = document.getElementById("modal-confirm-btn");
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i>Creazione...';
  const msg = document.getElementById("modal-msg");
  msg.textContent = "";

  try {
    const today = new Date().toISOString().split("T")[0];
    const name  = Session.selectedScheda;

    // 1. Crea sessione nel Workout Log
    const sessProps = {};
    sessProps[CONFIG.PROPS.WL_NAME]  = API.prop.title(name);
    sessProps[CONFIG.PROPS.WL_DATE]  = API.prop.date(today);
    sessProps[CONFIG.PROPS.WL_TYPE]  = API.prop.select(name);
    sessProps[CONFIG.PROPS.WL_DONE]  = API.prop.checkbox(false);
    sessProps[CONFIG.PROPS.WL_SPLIT] = API.prop.select("Full Body");

    const newSess = await API.create(CONFIG.DB.WORKOUT_LOG, sessProps);
    const sessId  = newSess.id;

    // 2. Crea una entry per ogni esercizio della scheda (1 serie placeholder)
    const exercises = CONFIG.SCHEDE[name].exercises;
    const creates   = exercises.map((exName, i) => {
      const props = {};
      props[CONFIG.PROPS.EL_NAME]    = API.prop.title(`${exName} – ${name} – S1`);
      props[CONFIG.PROPS.EL_SESSION] = API.prop.relation([sessId]);
      props[CONFIG.PROPS.EL_SETS]    = API.prop.number(1);
      props[CONFIG.PROPS.EL_REPS]    = API.prop.number(0);
      props[CONFIG.PROPS.EL_KG]      = API.prop.number(0);
      props[CONFIG.PROPS.EL_RR_MIN]  = API.prop.number(8);
      props[CONFIG.PROPS.EL_RR_MAX]  = API.prop.number(12);
      props[CONFIG.PROPS.EL_DATE]    = API.prop.date(today);
      return API.create(CONFIG.DB.ESERCIZI_LOG, props);
    });
    await Promise.all(creates);

    // 3. Aggiorna la lista sessioni e carica la nuova
    Session.sessions = await API.getWorkoutSessions(20);
    Session.buildSelect();

    // Seleziona la nuova sessione nel dropdown
    const sel = document.getElementById("sess-select");
    sel.value = sessId;

    // Chiudi modal e carica
    document.getElementById("new-sess-modal").style.display = "none";
    await Session.loadSession(sessId);

  } catch(e) {
    console.error(e);
    msg.textContent = "Errore durante la creazione. Riprova.";
    msg.style.color = "var(--red)";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-plus"></i>Crea e inizia';
  }
};
