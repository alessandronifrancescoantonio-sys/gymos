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

  // Apre una sessione specifica dalla Home (Sessioni recenti)
  openById(id) {
    this._pendingId = id;
    App.navigate("session");
  },

  async load() {
    try {
      this.sessions = await API.getWorkoutSessions(20);
      // se vogliamo aprire una sessione specifica non presente fra le ultime 20, allarga
      const target = this._pendingId;
      this._pendingId = null;
      if (target && !this.sessions.find(s => s.id === target)) {
        this.sessions = await API.getWorkoutSessions(50);
      }
      this.buildSelect();
      const id = (target && this.sessions.find(s => s.id === target))
        ? target
        : (this.sessions[0] && this.sessions[0].id);
      if (id) {
        this.activeId = id;
        const sel = document.getElementById("sess-select");
        if (sel) sel.value = id;
        await this.loadSession(id);
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
      const rest    = sets[0]?.recupero ?? "";
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
            <div class="ex-name">${exName}</div>
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
              ${prevMax > 0 ? `<span>· max ${U.fmt(prevMax)} kg</span>` : ""}
            </div>
          </div>
          <span class="ex-setcount" id="setcount-${sid}">${sets.length}<small>serie</small></span>
          <i class="ti ti-chevron-down ex-chevron"></i>
        </div>
        <div class="ex-body">
          <div id="sets-${sid}"></div>
          <div class="add-set-row">
            <button class="add-set-btn" onclick="Session.addSet('${exName}')">
              <i class="ti ti-plus"></i> Aggiungi serie
            </button>
          </div>
          <div class="ex-tech${(ex.tecnica && ex.tecnica.length) || ex.gruppo ? " has-tech" : ""}" id="extech-${sid}">
            ${this.exTechInnerHTML(exName, ex)}
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
      return target.closest("button, input, textarea, select, a, .adj, .rm-set-btn, .add-set-btn, .note-inp, .rr-in-sm, .ex-tech, .stepper-val");
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
      <div class="set-meta-row">
        <div id="prog-${set.id}">${status}</div>
      </div>
      <input class="note-inp" type="text" value="${set.note || ""}"
        placeholder="Note: forma, sensazione..."
        onchange="Session.saveNote('${set.id}',this.value)">
    `;
    // tieni premuto +/− per ripetere
    row.querySelectorAll(".adj").forEach(btn => this.bindHold(btn));
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
    props[CONFIG.PROPS.EL_INFO]     = API.prop.rich_text(last?.info || "");

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
        info:     last?.info || "",
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
      this.updateSetCount(exName);
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
    this.updateSetCount(exName);
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
    this.refreshSetValue(set, exName);
  },

  // Inserimento manuale: tocca il numero (kg o rep) e scrivi il valore esatto
  editVal(id, field, exName) {
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

  // Aggiorna display + badge + statistiche + autosave dopo un cambio di valore
  refreshSetValue(set, exName) {
    const id = set.id;
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

  // Recupero tra le serie (in header, come il rep range): salvato su tutte le serie
  updateRest(exName, val) {
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

    const exercises = CONFIG.SCHEDE[name].exercises || [];
    const creates   = [];
    exercises.forEach(function(item) {
      var exNm  = U.exName(item);
      var nSets = U.exSets(item);   // quante serie creare per questo esercizio
      for (var i = 1; i <= nSets; i++) {
        var props = {};
        props[CONFIG.PROPS.EL_NAME]    = API.prop.title(exNm + " – " + name + " – S" + i);
        props[CONFIG.PROPS.EL_SESSION] = API.prop.relation([sessId]);
        props[CONFIG.PROPS.EL_SETS]    = API.prop.number(1);
        props[CONFIG.PROPS.EL_REPS]    = API.prop.number(0);
        props[CONFIG.PROPS.EL_KG]      = API.prop.number(0);
        props[CONFIG.PROPS.EL_RR_MIN]  = API.prop.number(8);
        props[CONFIG.PROPS.EL_RR_MAX]  = API.prop.number(12);
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
