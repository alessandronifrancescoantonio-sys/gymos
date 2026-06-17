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

    // Inizializza il timer durata (NON parte da solo, lo avvia l'utente col bottone)
    if (typeof DurationTimer !== "undefined") DurationTimer.init(id);

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

    this.techDrafts = {};
    this.renderExercises();
    this.renderTechPanel();
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
    const groupCounts = this.groupCounts();

    this.exOrder.forEach((exName, exIdx) => {
      const sets    = grouped[exName] || [];
      const prevSets= prevGrouped[exName] || [];
      const rrMin   = sets[0]?.rrMin || 8;
      const rrMax   = sets[0]?.rrMax || 12;
      const prevMax = prevSets.length > 0 ? Math.max(...prevSets.map(s => s.kg || 0)) : 0;
      const sid     = this.sanitize(exName);
      const ex      = sets[0] || {};   // i campi tecnica vivono a livello esercizio (su tutte le serie)

      const block = document.createElement("div");
      block.className  = "ex-block collapsed";
      block.dataset.ex = exName;
      // La banda "SUPERSET" appare solo se il gruppo ha 2+ esercizi
      if (ex.gruppo && groupCounts[ex.gruppo] > 1) block.dataset.group = ex.gruppo;

      block.innerHTML = `
        <div class="ex-hd" onclick="Session.toggleEx(this, event)">
          <span class="drag-handle" aria-label="Trascina"><i class="ti ti-grip-vertical"></i></span>
          <span class="ex-num">${exIdx + 1}</span>
          <div class="ex-hd-main">
            <div class="ex-name">${exName}</div>
            <div class="ex-sub">
              <span class="ex-target-inline">Target
                <input class="rr-in-sm" type="number" value="${rrMin}" min="1" max="40"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRR('${exName}','min',this.value)">–<input class="rr-in-sm" type="number" value="${rrMax}" min="1" max="40"
                  onclick="event.stopPropagation()"
                  oninput="Session.updateRR('${exName}','max',this.value)"> rep
              </span>
              ${prevMax > 0 ? `<span>· max ${U.fmt(prevMax)} kg</span>` : ""}
              <span class="ex-tech-badges" id="badges-${sid}">${this.techBadgesHTML(ex)}</span>
            </div>
          </div>
          <i class="ti ti-chevron-down ex-chevron"></i>
        </div>
        <div class="ex-body">
          <div id="sets-${sid}"></div>
          <div class="add-set-row">
            <button class="add-set-btn" onclick="Session.addSet('${exName}')">
              <i class="ti ti-plus"></i> Aggiungi serie
            </button>
          </div>
        </div>
      `;

      // ─── DRAG: long-press (mobile) + mouse (desktop) ───
      const handle = block.querySelector(".drag-handle");
      this.attachDrag(block, handle, container);

      container.appendChild(block);

      const setsContainer = document.getElementById(`sets-${sid}`);
      sets.forEach((set, si) => {
        const prevSet = prevSets[si] || null;
        setsContainer.appendChild(this.buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax));
      });
    });
  },

  // ─── TECNICHE DI INTENSITÀ (a livello esercizio) ───

  // Badge mostrati nell'header (visibili anche a card chiusa)
  techBadgesHTML(ex) {
    const tags = (ex.tecnica || []).map(t => {
      const c = (CONFIG.TECNICHE.find(x => x.name === t) || {}).color || "#7A7A8A";
      return `<span class="tech-badge" style="color:${c};border-color:${c}55;background:${c}1a">${t}</span>`;
    }).join("");
    const cad = ex.cadenza ? `<span class="tech-badge cad"><i class="ti ti-clock-bolt"></i>${ex.cadenza}</span>` : "";
    const grp = ex.gruppo ? `<span class="grp-badge">Gruppo ${ex.gruppo}${ex.recupero ? ` · ${ex.recupero}s` : ""}</span>` : "";
    return tags + cad + grp;
  },

  // Applica un patch a TUTTE le serie dell'esercizio (la tecnica vive su ogni serie)
  applyTechToSets(exName, patch) {
    const sets = this.groupByExercise(this.exercises)[exName] || [];
    sets.forEach(s => Object.assign(s, patch));
    return sets;
  },

  // Quanti esercizi ci sono in ciascun gruppo (per banda superset)
  groupCounts() {
    const grouped = this.groupByExercise(this.exercises);
    const counts = {};
    Object.keys(grouped).forEach(n => {
      const g = (grouped[n][0] || {}).gruppo;
      if (g) counts[g] = (counts[g] || 0) + 1;
    });
    return counts;
  },

  // ═══ PANNELLO TECNICHE (in alto, fuori dagli esercizi) ═══
  // Modello: ogni "blocco tecnica" = una lettera Gruppo (A-F) con i suoi esercizi
  // correlati + le tecniche scelte + cadenza/recupero. I blocchi appena creati e
  // ancora senza esercizi vivono in techDrafts finché non gli correli un esercizio.
  techDrafts: {},

  // Ricostruisce i blocchi dai dati reali (esercizi con un Gruppo) + le bozze
  techAssignments() {
    const grouped = this.groupByExercise(this.exercises);
    const byGroup = {};
    Object.keys(grouped).forEach(name => {
      const ex = grouped[name][0] || {};
      if (!ex.gruppo) return;
      if (!byGroup[ex.gruppo]) byGroup[ex.gruppo] = { gruppo: ex.gruppo, exercises: [], tecnica: new Set(), cadenza: "", recupero: null };
      byGroup[ex.gruppo].exercises.push(name);
      (ex.tecnica || []).forEach(t => byGroup[ex.gruppo].tecnica.add(t));
      if (ex.cadenza) byGroup[ex.gruppo].cadenza = ex.cadenza;
      if (ex.recupero != null) byGroup[ex.gruppo].recupero = ex.recupero;
    });
    const out = Object.values(byGroup).map(a => ({ ...a, tecnica: [...a.tecnica], draft: false }));
    // aggiungi le bozze (gruppi creati ma senza esercizi) non già presenti
    Object.keys(this.techDrafts).forEach(g => {
      if (!byGroup[g]) out.push({ gruppo: g, exercises: [], tecnica: this.techDrafts[g].tecnica || [], cadenza: this.techDrafts[g].cadenza || "", recupero: this.techDrafts[g].recupero ?? null, draft: true });
    });
    return out.sort((a, b) => a.gruppo.localeCompare(b.gruppo));
  },

  renderTechPanel() {
    const wrap = document.getElementById("tech-groups");
    if (!wrap) return;
    const assigns = this.techAssignments();
    if (!assigns.length) {
      wrap.innerHTML = `<div class="tech-empty">Nessuna tecnica impostata. Tocca <b>Aggiungi</b> per scegliere una tecnica e correlarci uno o più esercizi.</div>`;
      return;
    }
    wrap.innerHTML = assigns.map(a => this.techGroupHTML(a)).join("");
  },

  techGroupHTML(a) {
    const exNames = Object.keys(this.groupByExercise(this.exercises));
    const grouped = this.groupByExercise(this.exercises);
    const chips = CONFIG.TECNICHE.map(t => {
      const on = a.tecnica.includes(t.name);
      return `<button type="button" class="tech-chip${on ? " on" : ""}" style="${on ? `--tc:${t.color}` : ""}"
        onclick="Session.tgToggleTec('${a.gruppo}','${t.name}')">${t.name}</button>`;
    }).join("");
    const exItems = exNames.map(n => {
      const g = (grouped[n][0] || {}).gruppo || "";
      const checked  = g === a.gruppo;
      const disabled = g && g !== a.gruppo;   // già correlato a un altro blocco
      return `<label class="tg-ex${disabled ? " off" : ""}${checked ? " on" : ""}">
        <input type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}
          onchange="Session.tgToggleEx('${a.gruppo}','${n}',this.checked)"><span>${n}</span></label>`;
    }).join("");
    const supLabel = a.exercises.length > 1 ? `<span class="tg-sup">SUPERSET</span>` : "";
    return `
      <div class="tech-group" data-g="${a.gruppo}">
        <div class="tg-head">
          <span class="tg-letter">${a.gruppo}</span>${supLabel}
          <span class="tg-count">${a.exercises.length || "0"} eserc.</span>
          <button class="tg-del" onclick="Session.tgRemove('${a.gruppo}')" aria-label="Rimuovi"><i class="ti ti-trash"></i></button>
        </div>
        <div class="tg-lbl">Tecnica</div>
        <div class="tech-chips">${chips}</div>
        <div class="tg-lbl">Esercizi correlati</div>
        <div class="tg-exs">${exItems}</div>
        <div class="tech-fields">
          <label class="tech-field"><span>Cadenza</span>
            <input class="tech-in" type="text" placeholder="3-1-1" value="${a.cadenza || ""}"
              onchange="Session.tgSet('${a.gruppo}','cadenza',this.value)"></label>
          <label class="tech-field"><span>Recupero (s)</span>
            <input class="tech-in" type="number" min="0" step="5" placeholder="120" value="${a.recupero ?? ""}"
              onchange="Session.tgSet('${a.gruppo}','recupero',this.value)"></label>
        </div>
      </div>`;
  },

  addTechGroup() {
    const used = new Set(this.techAssignments().map(a => a.gruppo));
    const free = CONFIG.GRUPPI.find(g => !used.has(g));
    if (!free) { alert("Hai raggiunto il numero massimo di blocchi tecnica."); return; }
    this.techDrafts[free] = { tecnica: [], cadenza: "", recupero: null };
    this.renderTechPanel();
  },

  // Valori correnti di un blocco (da dati reali o da bozza)
  tgCurrent(g) {
    return this.techAssignments().find(a => a.gruppo === g) || { gruppo: g, exercises: [], tecnica: [], cadenza: "", recupero: null, draft: true };
  },

  tgToggleTec(g, name) {
    const a = this.tgCurrent(g);
    const cur = new Set(a.tecnica);
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    const arr = [...cur];
    if (a.exercises.length) {
      a.exercises.forEach(ex => { this.applyTechToSets(ex, { tecnica: arr }); this.saveTech(ex); });
    } else if (this.techDrafts[g]) {
      this.techDrafts[g].tecnica = arr;
    }
    this.renderTechPanel();
    this.updateCardsTech();
  },

  tgSet(g, field, val) {
    const a = this.tgCurrent(g);
    const value = (field === "recupero") ? (val === "" ? null : Number(val)) : val;
    if (a.exercises.length) {
      a.exercises.forEach(ex => { this.applyTechToSets(ex, { [field]: value }); this.saveTech(ex); });
    } else if (this.techDrafts[g]) {
      this.techDrafts[g][field] = value;
    }
    this.renderTechPanel();
    this.updateCardsTech();
  },

  tgToggleEx(g, exName, checked) {
    if (checked) {
      const a = this.tgCurrent(g);
      // l'esercizio entra nel blocco ed eredita tecnica/cadenza/recupero del blocco
      this.applyTechToSets(exName, { gruppo: g, tecnica: [...a.tecnica], cadenza: a.cadenza || "", recupero: a.recupero ?? null });
      delete this.techDrafts[g];   // non è più una bozza
    } else {
      // esce dal blocco: azzera i suoi campi tecnica
      this.applyTechToSets(exName, { gruppo: "", tecnica: [], cadenza: "", recupero: null });
    }
    this.saveTech(exName);
    this.renderTechPanel();
    this.updateCardsTech();
  },

  tgRemove(g) {
    const a = this.tgCurrent(g);
    a.exercises.forEach(ex => {
      this.applyTechToSets(ex, { gruppo: "", tecnica: [], cadenza: "", recupero: null });
      this.saveTech(ex);
    });
    delete this.techDrafts[g];
    this.renderTechPanel();
    this.updateCardsTech();
  },

  // Aggiorna badge + banda superset sulle card senza ricostruirle
  updateCardsTech() {
    const grouped = this.groupByExercise(this.exercises);
    const counts = this.groupCounts();
    document.querySelectorAll(".ex-block").forEach(block => {
      const name = block.dataset.ex;
      const ex = (grouped[name] || [])[0] || {};
      if (ex.gruppo && counts[ex.gruppo] > 1) block.dataset.group = ex.gruppo;
      else delete block.dataset.group;
    });
    Object.keys(grouped).forEach(n => this.refreshBadges(n));
  },

  refreshBadges(exName) {
    const ex = (this.groupByExercise(this.exercises)[exName] || [])[0] || {};
    const el = document.getElementById(`badges-${this.sanitize(exName)}`);
    if (el) el.innerHTML = this.techBadgesHTML(ex);
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
    };
    this.setSyncState("saving");
    clearTimeout(this._saveTimers["tech_" + exName]);
    this._saveTimers["tech_" + exName] = setTimeout(async () => {
      try {
        await Promise.all(sets.map(s => API.updateExerciseTech(s.id, tech)));
        this.setSyncState("saved");
      } catch(e) { console.error("saveTech:", e); this.setSyncState("error"); }
    }, 800);
  },

  toggleEx(hd, event) {
    if (event && (event.target.closest(".drag-handle") || event.target.closest("input"))) return;
    // Se è appena avvenuto un drag, non fare il toggle
    if (this._justDragged) { this._justDragged = false; return; }
    hd.parentElement.classList.toggle("collapsed");
  },

  renumberBlocks() {
    document.querySelectorAll(".ex-block").forEach((b, i) => {
      const num = b.querySelector(".ex-num");
      if (num) num.textContent = i + 1;
    });
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
      return target.closest("button, input, textarea, select, a, .adj, .rm-set-btn, .add-set-btn, .note-inp, .rr-in-sm");
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

  buildSetRow(set, si, prevSet, exName, rrMin, rrMax, prevMax) {
    const row = document.createElement("div");
    row.className = "set-card";
    row.id = `setrow-${set.id}`;

    const prevHTML = prevSet
      ? `<span class="pv">${U.fmt(prevSet.kg)}kg</span><span class="px">×</span><span class="pv">${prevSet.reps}r</span><span class="plbl">scorsa</span>`
      : `<span class="pe">prima volta</span>`;

    const prog   = this.getProgression(set, prevSet);
    const status = this.buildStatusBadge(prog, set, exName, rrMin, rrMax, prevMax);
    const repCls = set.reps > 0 ? "stepper-val" : "stepper-val empty";

    row.innerHTML = `
      <div class="set-card-top">
        <div class="set-num">${si + 1}</div>
        <div class="set-prev">${prevHTML}</div>
        <button class="rm-set-btn" onclick="Session.removeSet('${set.id}','${exName}')" aria-label="Rimuovi serie">
          <i class="ti ti-x"></i>
        </button>
      </div>
      <div class="stepper-row">
        <span class="stepper-lbl">Kg</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','k',-2.5,'${exName}')">−</button>
        <span class="${repCls}" id="kg-${set.id}">${U.fmt(set.kg)}</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','k',2.5,'${exName}')">+</button>
      </div>
      <div class="stepper-row">
        <span class="stepper-lbl">Rep</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','r',-1,'${exName}')">−</button>
        <span class="${repCls}" id="rep-${set.id}">${set.reps > 0 ? set.reps : "0"}</span>
        <button class="adj" onclick="Session.adjSet('${set.id}','r',1,'${exName}')">+</button>
      </div>
      <div class="set-meta-row">
        <div id="prog-${set.id}">${status}</div>
      </div>
      <input class="note-inp" type="text" value="${set.note || ""}"
        placeholder="Note: forma, sensazione..."
        onchange="Session.saveNote('${set.id}',this.value)">
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
    // Eredita le tecniche di intensità dall'esercizio (vivono su ogni serie)
    props[CONFIG.PROPS.EL_TECNICA]  = API.prop.multi_select(last?.tecnica || []);
    props[CONFIG.PROPS.EL_CADENZA]  = API.prop.rich_text(last?.cadenza || "");
    props[CONFIG.PROPS.EL_GRUPPO]   = API.prop.select(last?.gruppo || "");
    props[CONFIG.PROPS.EL_RECUPERO] = API.prop.number(last?.recupero ?? null);

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
        tecnica:  last?.tecnica ? [...last.tecnica] : [],
        cadenza:  last?.cadenza || "",
        gruppo:   last?.gruppo || "",
        recupero: last?.recupero ?? null,
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
      [...setsContainer.querySelectorAll(".set-num")].forEach((sn, i) => {
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
    if (repEl) { repEl.textContent = set.reps > 0 ? set.reps : "0"; repEl.className = set.reps > 0 ? "stepper-val" : "stepper-val empty"; }
    if (kgEl)  { kgEl.textContent = U.fmt(set.kg); kgEl.className = set.kg > 0 ? "stepper-val" : "stepper-val empty"; }

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
    this.autosave(set);   // salvataggio automatico
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
    const grouped = this.groupByExercise(this.exercises);
    const sets = grouped[exName] || [];
    sets.forEach(s => {
      if (field === "min") s.rrMin = parseInt(val) || 0;
      if (field === "max") s.rrMax = parseInt(val) || 0;
    });
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
    this.setSyncState("saving");
    try {
      await API.update(id, { [CONFIG.PROPS.EL_NOTE]: API.prop.rich_text(note) });
      this.setSyncState("saved");
    } catch(e) {
      console.error(e);
      this.setSyncState("error");
    }
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
        const props = { [CONFIG.PROPS.WL_DONE]: API.prop.checkbox(true) };
        // Ferma il timer durata e salva i minuti
        if (typeof DurationTimer !== "undefined") {
          const mins = DurationTimer.finishAndReset();
          if (mins > 0) props["Durata (min)"] = API.prop.number(mins);
        }
        await API.update(this.activeId, props);
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
(function() {
  let _scheda = null;

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

    wrap.innerHTML = "";
    Object.entries(CONFIG.SCHEDE).forEach(function(entry) {
      var name = entry[0];
      var cfg  = entry[1];
      var btn  = document.createElement("button");
      btn.className   = "scheda-pill";
      btn.textContent = name;
      btn.type        = "button";
      btn.onclick     = function() {
        wrap.querySelectorAll(".scheda-pill").forEach(function(b) {
          b.style.background  = "";
          b.style.borderColor = "";
          b.style.color       = "";
        });
        btn.style.background  = cfg.color + "33";
        btn.style.borderColor = cfg.color;
        btn.style.color       = cfg.color;
        _scheda = name;
        document.getElementById("modal-msg").textContent = "Selezionato: " + name;
      };
      wrap.appendChild(btn);
    });
    if (!Object.keys(CONFIG.SCHEDE).length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--dim)">Nessuna scheda. Creane una nella sezione Schede.</div>';
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
    const today = new Date().toISOString().split("T")[0];
    const sessProps = {};
    sessProps[CONFIG.PROPS.WL_NAME]  = API.prop.title(name);
    sessProps[CONFIG.PROPS.WL_DATE]  = API.prop.date(today);
    sessProps[CONFIG.PROPS.WL_TYPE]  = API.prop.select(name);
    sessProps[CONFIG.PROPS.WL_DONE]  = API.prop.checkbox(false);
    sessProps[CONFIG.PROPS.WL_SPLIT] = API.prop.select("Full Body");

    const newSess = await API.create(CONFIG.DB.WORKOUT_LOG, sessProps);
    const sessId  = newSess.id;

    const exercises = CONFIG.SCHEDE[name].exercises;
    const creates   = exercises.map(function(exName) {
      var props = {};
      props[CONFIG.PROPS.EL_NAME]    = API.prop.title(exName + " – " + name + " – S1");
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
