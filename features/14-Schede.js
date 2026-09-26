const Schede = {
  editing:   null,   // id scheda in modifica, null = nuova
  draftEx:   [],     // esercizi in editing
  draftColor:"Rosso",
  dragIdx:   null,

  COLORS: ["Rosso","Blu","Verde","Arancione","Viola","Rosa","Giallo"],

  async load() {
    await App.loadSchede();
    this.render();
  },

  escq: s => String(s).replace(/'/g, "\\'"),

  render() {
    const wrap = document.getElementById("schede-list");
    if (!wrap) return;
    wrap.innerHTML = "";
    const programmi = App.programmi || {};
    const names = Object.keys(programmi);
    if (!names.length) {
      wrap.innerHTML = '<div class="empty-state">Nessun programma. Crea il primo con "Nuovo programma"!</div>';
      return;
    }
    if (!this._expanded) this._expanded = new Set();   // di base tutti i programmi chiusi

    names.forEach(pg => {
      const sedute   = programmi[pg];
      const isActive = pg === App.activeProgram;
      const open     = this._expanded.has(pg);
      const pgEsc    = pg;
      const card = document.createElement("div");
      card.className = "prog-card" + (isActive ? " active" : "");
      card.innerHTML = `
        <div class="prog-head" onclick="Schede.toggleProgram(${U.arg(pgEsc)})">
          <i class="ti ti-chevron-right prog-chev${open ? " open" : ""}"></i>
          <div class="prog-name">${U.escape(pg)}</div>
          <button class="prog-rename" onclick="event.stopPropagation();Schede.renameProgram(${U.arg(pgEsc)})" aria-label="Rinomina programma"><i class="ti ti-pencil"></i></button>
          ${isActive ? '<span class="prog-active-badge"><i class="ti ti-check"></i>Attiva</span>' : ""}
          <span class="prog-count">${sedute.length} sed.</span>
          ${isActive ? "" : `<button class="prog-activate" onclick="event.stopPropagation();Schede.setActive(${U.arg(pgEsc)})">Rendi attiva</button>`}
        </div>
        <div class="prog-body${open ? " open" : ""}">
          ${sedute.map(s => `
            <div class="seduta-card">
              <div class="seduta-head">
                <span class="seduta-dot" style="background:${/^#[0-9a-f]{3,8}$/i.test(s.colore) ? s.colore : '#FF3B2F'}"></span>
                <span class="seduta-name">${U.escape(s.nome)}</span>
                <span class="seduta-count">${s.exercises.length} es.</span>
                <button class="seduta-act" onclick="Schede.openEditor(${U.arg(s.id)})" aria-label="Modifica"><i class="ti ti-pencil"></i></button>
                <button class="seduta-act del" onclick="Schede.remove(${U.arg(s.id)},${U.arg(s.nome)})" aria-label="Elimina"><i class="ti ti-trash"></i></button>
              </div>
              <div class="seduta-list">
                ${s.exercises.length
                  ? s.exercises.map((e, i) => `
                    <div class="ex-line">
                      <span class="ex-line-num">${i + 1}</span>
                      <span class="ex-line-name">${U.escape(U.exName(e))}${(U.exTec(e).length || U.exGrp(e)) ? ` <i class="ti ti-bolt ex-line-tech" title="${U.escape([...U.exTec(e), U.exGrp(e) ? "Superset " + U.exGrp(e) : ""].filter(Boolean).join(", "))}"></i>` : ""}</span>
                      <span class="ex-line-sets">${U.exSets(e)}<small>serie</small></span>
                    </div>`).join("")
                  : '<div class="ex-line empty">Nessun esercizio — tocca la matita per aggiungerli</div>'}
              </div>
            </div>`).join("")}
          <button class="prog-add-seduta" onclick="Schede.addSeduta(${U.arg(pgEsc)})"><i class="ti ti-plus"></i> Aggiungi seduta</button>
        </div>
      `;
      wrap.appendChild(card);
    });
  },

  toggleProgram(pg) {
    if (!this._expanded) this._expanded = new Set();
    if (this._expanded.has(pg)) this._expanded.delete(pg);
    else this._expanded.add(pg);
    this.render();
  },

  async setActive(pg) {
    try {
      await API.setActiveProgram(pg, App.schede);
      if (this._expanded) this._expanded.add(pg);
      await this.load();
    } catch(e) { console.error(e); U.alert("Errore nel cambio programma attivo"); }
  },

  async newProgram() {
    const name = await U.prompt("Nuovo programma", { placeholder: "Es. Massa, Definizione…", okText: "Crea" });
    if (!name || !name.trim()) return;
    this._newProgram = name.trim();
    this.openEditor();   // crea la prima seduta di questo programma
  },

  // Rinomina un programma: aggiorna il campo "Programma" su tutte le sue sedute
  async renameProgram(pg) {
    const name = await U.prompt("Rinomina programma", { value: pg, okText: "Salva" });
    const newName = (name || "").trim();
    if (!newName || newName === pg) return;
    const sedute = (App.programmi && App.programmi[pg]) || [];
    try {
      await Promise.all(sedute.map(s => API.updateScheda(s.id, { programma: newName })));
      if (this._expanded && this._expanded.has(pg)) { this._expanded.delete(pg); this._expanded.add(newName); }
      if (App.activeProgram === pg) App.activeProgram = newName;
      await this.load();
      U.toast("Programma rinominato", "ok");
    } catch(e) { console.error(e); U.toast("Errore nel rinominare", "err"); }
  },

  addSeduta(pg) {
    this._newProgram = pg;
    this.openEditor();
  },

  openEditor(id) {
    this.editing = id || null;
    this._openIdx = new Set();
    const titleEl = document.getElementById("scheda-editor-title");
    if (id) {
      const s = App.schede.find(x => x.id === id);
      this.draftEx = (s.exercises || []).map(e => ({ nome: U.exName(e), serie: U.exSets(e), recupero: U.exRest(e), rir: U.exRir(e), rrMin: U.exRrMin(e), rrMax: U.exRrMax(e), tecnica: U.exTec(e), cadenza: U.exCad(e), info: U.exInfo(e), gruppo: U.exGrp(e) }));
      this.draftColor = API.COLOR_REV[s.colore] || "Rosso";
      document.getElementById("sc-nome").value = s.nome;
      titleEl.innerHTML = '<i class="ti ti-pencil"></i>Modifica seduta';
    } else {
      this.draftEx = [];
      this.draftColor = "Rosso";
      document.getElementById("sc-nome").value = "";
      const pg = this._newProgram || App.activeProgram || "La mia scheda";
      titleEl.innerHTML = `<i class="ti ti-clipboard-list"></i>Nuova seduta · <span style="color:var(--accent)">${U.escape(pg)}</span>`;
    }
    document.getElementById("scheda-editor-msg").textContent = "";
    this.buildColorPicker();
    this.buildExList();
    document.getElementById("scheda-editor").style.display = "flex";
  },

  closeEditor(e) {
    if (!e || e.target.id === "scheda-editor") {
      document.getElementById("scheda-editor").style.display = "none";
    }
  },

  buildColorPicker() {
    const wrap = document.getElementById("sc-color-picker");
    wrap.innerHTML = "";
    this.COLORS.forEach(c => {
      const hex = API.COLOR_MAP[c];
      const b = document.createElement("button");
      b.className = "color-swatch" + (this.draftColor === c ? " on" : "");
      b.style.background = hex;
      b.onclick = () => { this.draftColor = c; this.buildColorPicker(); };
      wrap.appendChild(b);
    });
  },

  buildExList() {
    const wrap = document.getElementById("sc-ex-list");
    wrap.innerHTML = "";
    if (!this.draftEx.length) {
      wrap.innerHTML = '<div class="ex-editor-empty">Nessun esercizio. Aggiungine sotto.</div>';
      return;
    }
    this.draftEx.forEach((ex, i) => {
      const row = document.createElement("div");
      // Tendina chiusa di default: prima ogni esercizio arrivava già aperto
      // (serie/rep/rec/RIR sempre visibili), lungo da scorrere con tante voci.
      // this._openIdx tiene traccia di QUALI righe l'utente ha aperto in
      // questa sessione di editing (si resetta ad ogni openEditor()).
      const isOpen = this._openIdx && this._openIdx.has(i);
      row.className = "ex-editor-item" + (isOpen ? "" : " collapsed");
      row.draggable = true;
      row.innerHTML = `
        <div class="ex-editor-top" onclick="Schede.toggleExRow(${i})">
          <i class="ti ti-grip-vertical ex-editor-grip" onclick="event.stopPropagation()"></i>
          <span class="ex-editor-name">${U.escape(U.exName(ex))}</span>
          <i class="ti ti-chevron-down ex-editor-chev"></i>
          <button class="ex-editor-del" onclick="event.stopPropagation();Schede.removeExercise(${i})"><i class="ti ti-x"></i></button>
        </div>
        <div class="ex-editor-body">
          <div class="ex-editor-fields">
            <div class="ex-editor-sets">
              <button type="button" onclick="Schede.bumpSets(${i},-1)">−</button>
              <span id="scsets-${i}">${U.exSets(ex)}</span>
              <button type="button" onclick="Schede.bumpSets(${i},1)">+</button>
              <small>serie</small>
            </div>
            <label class="ex-editor-f ex-editor-range"><span>Rep</span>
              <span class="range-pair">
                <input type="number" min="1" max="40" placeholder="8" value="${U.exRrMin(ex)}" onchange="Schede.setRange(${i},'rrMin',this.value)">
                <i>–</i>
                <input type="number" min="1" max="40" placeholder="12" value="${U.exRrMax(ex)}" onchange="Schede.setRange(${i},'rrMax',this.value)">
              </span></label>
            <label class="ex-editor-f"><span>Rec s</span>
              <input type="number" min="0" step="5" placeholder="90" value="${U.exRest(ex) ?? ""}" onchange="Schede.setMeta(${i},'recupero',this.value)"></label>
            <label class="ex-editor-f"><span>RIR</span>
              <input type="number" min="0" max="10" step="1" placeholder="2" value="${U.exRir(ex) ?? ""}" onchange="Schede.setMeta(${i},'rir',this.value)"></label>
          </div>
          <div class="ed-tech${(U.exTec(ex).length || U.exGrp(ex)) ? " has-tech" : ""}" id="ed-tech-${i}">
            ${this.edTechHTML(i, ex)}
          </div>
        </div>
      `;
      row.addEventListener("dragstart", () => this.dragIdx = i);
      row.addEventListener("dragover", e => e.preventDefault());
      row.addEventListener("drop", e => {
        e.preventDefault();
        if (this.dragIdx === null || this.dragIdx === i) return;
        const moved = this.draftEx.splice(this.dragIdx, 1)[0];
        this.draftEx.splice(i, 0, moved);
        this.dragIdx = null;
        this.buildExList();
      });
      wrap.appendChild(row);
    });
  },

  addExercise() {
    const inp = document.getElementById("sc-new-ex");
    const val = inp.value.trim();
    if (!val) return;
    this.draftEx.push({ nome: val, serie: 3, recupero: null, rir: null, rrMin: 8, rrMax: 12, tecnica: [], cadenza: "", info: "", gruppo: "" });
    // Appena aggiunto → apri subito la tendina per impostare rep/rec/RIR,
    // altrimenti bisognerebbe riaprirla a mano un attimo dopo averlo scritto.
    this._openIdx = this._openIdx || new Set();
    this._openIdx.add(this.draftEx.length - 1);
    inp.value = "";
    inp.focus();
    this.buildExList();
  },

  // Aumenta/diminuisce il numero di serie (conserva recupero/rir)
  bumpSets(i, d) {
    if (!this.draftEx[i]) return;
    const next = Math.max(1, Math.min(20, U.exSets(this.draftEx[i]) + d));
    this.draftEx[i].serie = next;
    const el = document.getElementById(`scsets-${i}`);
    if (el) el.textContent = next;
  },

  // Imposta recupero/rir di un esercizio in editing
  setMeta(i, field, val) {
    if (!this.draftEx[i]) return;
    this.draftEx[i][field] = (val === "" ? null : Number(val));
  },

  // Imposta il rep range (min/max) di un esercizio in editing
  setRange(i, field, val) {
    if (!this.draftEx[i]) return;
    const n = parseInt(val);
    this.draftEx[i][field] = (val === "" || isNaN(n)) ? (field === "rrMin" ? 8 : 12) : Math.max(1, Math.min(40, n));
  },

  // ─── Tecnica di intensità nell'editor scheda (come in sessione) ───
  edPartners(i) {
    const g = U.exGrp(this.draftEx[i]);
    if (!g) return [];
    return this.draftEx.filter((e, j) => j !== i && U.exGrp(e) === g).map(e => U.exName(e));
  },
  edTechHTML(i, ex) {
    const tec = U.exTec(ex), grp = U.exGrp(ex);
    const partners = this.edPartners(i);
    const sup = grp ? `<span class="ed-tech-sup"><i class="ti ti-link"></i>Superset${partners.length ? " con " + U.escape(partners.join(", ")) : ""}</span>` : "";
    const tecLbl = tec.length ? `<span>${U.escape(tec.join(", "))}</span>` : "";
    const summary = (sup || tecLbl) ? `<span class="ed-tech-sum">${sup}${tecLbl}</span>` : `<span class="ed-tech-sum muted">imposta…</span>`;
    const chips = (CONFIG.TECNICHE || []).map(t => {
      const on = tec.includes(t.name);
      return `<button type="button" class="tech-chip${on ? " on" : ""}" style="${on ? `--tc:${t.color}` : ""}" onclick="Schede.edToggleTec(${i},${U.arg(t.name)})">${t.name}</button>`;
    }).join("");
    const corr = this.draftEx.map((e, j) => ({ e, j })).filter(o => o.j !== i).map(o => {
      const og = U.exGrp(o.e);
      const same = grp && og === grp, other = og && og !== grp;
      return `<label class="tg-ex${other ? " off" : ""}${same ? " on" : ""}"><input type="checkbox" ${same ? "checked" : ""} ${other ? "disabled" : ""} onchange="Schede.edCorrelate(${i},${o.j},this.checked)"><span>${U.escape(U.exName(o.e))}</span></label>`;
    }).join("");
    return `
      <button type="button" class="ed-tech-toggle" onclick="Schede.toggleEdTech(${i}, this)">
        <i class="ti ti-bolt"></i><span class="ed-tech-label">Tecnica di intensità</span>${summary}<i class="ti ti-chevron-down ed-tech-chev"></i>
      </button>
      <div class="ed-tech-box">
        <div class="tg-lbl">Tecnica</div>
        <div class="tech-chips">${chips}</div>
        <div class="tech-fields">
          <label class="tech-field"><span>Cadenza</span><input class="tech-in" type="text" placeholder="3-1-1" value="${U.escape(U.exCad(ex))}" onchange="Schede.edSetText(${i},'cadenza',this.value)"></label>
        </div>
        <div class="tg-lbl">Info tecnica</div>
        <textarea class="tech-in tg-info" rows="2" placeholder="Es. drop al 70%, 2 cali; eccentrica 3s..." onchange="Schede.edSetText(${i},'info',this.value)">${U.escape(U.exInfo(ex))}</textarea>
        <div class="tg-lbl">Superset — raggruppa con</div>
        <div class="tg-exs">${corr || '<span class="tech-empty">Nessun altro esercizio</span>'}</div>
      </div>`;
  },
  toggleEdTech(i, btn) { const w = btn.closest(".ed-tech"); if (w) w.classList.toggle("open"); },

  // Tendina esercizio (serie/rep/rec/RIR + tecnica): aperta/chiusa a tap
  // sull'intestazione, indipendente dalla tendina "Tecnica di intensità"
  // annidata dentro.
  toggleExRow(i) {
    this._openIdx = this._openIdx || new Set();
    if (this._openIdx.has(i)) this._openIdx.delete(i); else this._openIdx.add(i);
    this.buildExList();
  },
  _reTechRow(i) {
    const w = document.getElementById(`ed-tech-${i}`);
    if (!w) return;
    const open = w.classList.contains("open");
    w.innerHTML = this.edTechHTML(i, this.draftEx[i]);
    w.classList.toggle("has-tech", !!(U.exTec(this.draftEx[i]).length || U.exGrp(this.draftEx[i])));
    if (open) w.classList.add("open");
  },
  edToggleTec(i, name) {
    const cur = new Set(U.exTec(this.draftEx[i]));
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    this.draftEx[i].tecnica = [...cur];
    this._reTechRow(i);
  },
  edSetText(i, field, val) { if (this.draftEx[i]) this.draftEx[i][field] = val; },
  edNextGroup() {
    const used = new Set(this.draftEx.map(e => U.exGrp(e)).filter(Boolean));
    return (CONFIG.GRUPPI || ["A","B","C","D","E","F"]).find(g => !used.has(g)) || "A";
  },
  edCorrelate(i, j, checked) {
    if (checked) {
      const g = U.exGrp(this.draftEx[i]) || U.exGrp(this.draftEx[j]) || this.edNextGroup();
      this.draftEx[i].gruppo = g; this.draftEx[j].gruppo = g;
    } else {
      this.draftEx[j].gruppo = "";
      const g = U.exGrp(this.draftEx[i]);
      if (g && this.draftEx.filter(e => U.exGrp(e) === g).length < 2) this.draftEx[i].gruppo = "";
    }
    this.buildExList();
  },

  removeExercise(i) {
    this.draftEx.splice(i, 1);
    this.buildExList();
  },

  async save() {
    const nome = document.getElementById("sc-nome").value.trim();
    const msg  = document.getElementById("scheda-editor-msg");
    if (!nome) { msg.textContent = "Inserisci un nome"; return; }
    if (!this.draftEx.length) { msg.textContent = "Aggiungi almeno un esercizio"; return; }
    msg.textContent = "Salvataggio...";
    try {
      if (this.editing) {
        await API.updateScheda(this.editing, { nome, colorName: this.draftColor, exercises: this.draftEx });
      } else {
        const programma = this._newProgram || App.activeProgram || "La mia scheda";
        // se non esiste ancora un programma attivo, il primo creato diventa attivo
        const progAttivo = (programma === App.activeProgram) || !App.activeProgram;
        const ordine = App.schede.length + 1;
        await API.createScheda(nome, this.draftColor, this.draftEx, ordine, programma, progAttivo);
      }
      this._newProgram = null;
      document.getElementById("scheda-editor").style.display = "none";
      await this.load();
      U.toast(this.editing ? "Seduta aggiornata" : "Seduta creata", "ok");
    } catch(e) {
      console.error(e);
      msg.textContent = "Errore nel salvataggio";
      U.toast("Errore nel salvataggio", "err");
    }
  },

  async remove(id, nome) {
    if (!await U.confirm(`Eliminare la seduta "${nome}"? Le sessioni già salvate restano.`, { danger: true, okText: "Elimina" })) return;
    try {
      await API.deleteScheda(id);
      await this.load();
      U.toast("Seduta eliminata", "ok");
    } catch(e) { console.error(e); U.alert("Errore eliminazione"); }
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Export PDF (report allenamenti + grafico progressione per esercizio)
//  #G. Nessuna libreria nuova: grafici Chart.js -> PNG, report HTML
//  self-contained, stampa via iframe (l'utente sceglie "Salva come PDF").
// ═══════════════════════════════════════════════
