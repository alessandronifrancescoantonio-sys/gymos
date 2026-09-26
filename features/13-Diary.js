const Diary = {
  qualita: null,
  energia: null,
  umore:   null,
  habitId: null,
  habitState: { allen:false, prot:false, integ:false, mobil:false, pesoReg:false },

  HABITS: [
    { key:"allen",   label:"Allenamento",     icon:"ti-barbell" },
    { key:"prot",    label:"Proteine ok",     icon:"ti-meat" },
    { key:"integ",   label:"Integratori",     icon:"ti-pill" },
    { key:"mobil",   label:"Mobilità",        icon:"ti-stretching" },
    { key:"pesoReg", label:"Peso registrato", icon:"ti-scale" },
  ],

  // Diario libero ("giornata & sensazioni") — ON-DEVICE (localStorage, come
  // note-esercizio e foto progressi), niente nuovo schema Notion. Autosave
  // debounced mentre scrivi ("tempo reale"): il cervello IA lo legge ad ogni
  // richiesta di consiglio (Session.loadAIAdvice), niente bottone salva.
  _journalKey(d) { return `gymos_journal_${d || U.today()}`; },
  getJournal(d) { try { return localStorage.getItem(this._journalKey(d)) || ""; } catch (e) { return ""; } },
  onJournalInput(text) {
    clearTimeout(this._journalTimer);
    this._journalTimer = setTimeout(() => {
      try {
        const t = (text || "").trim();
        if (t) localStorage.setItem(this._journalKey(), t);
        else localStorage.removeItem(this._journalKey());
      } catch (e) {}
      const msg = document.getElementById("journal-save-msg");
      if (msg) { msg.style.display = "flex"; setTimeout(() => msg.style.display = "none", 1800); }
    }, 500);
  },

  async load() {
    document.getElementById("diary-date").textContent =
      new Date().toLocaleDateString("it-IT", { weekday:"long", day:"numeric", month:"long" });
    const ta = document.getElementById("journal-ta");
    if (ta) ta.value = this.getJournal();
    this.qualita = null; this.energia = null; this.umore = null;
    this.buildRatings();
    this.buildEnergia();
    this.buildHabitChecks();
    this.renderLimitations();
    // Carica habit di oggi se esiste
    try {
      const h = await API.getTodayHabit();
      if (h) {
        this.habitId = h.id;
        this.habitState = { allen:h.allen, prot:h.prot, integ:h.integ, mobil:h.mobil, pesoReg:h.pesoReg };
        if (h.acqua != null) document.getElementById("dh-acqua").value = h.acqua;
        if (h.passi != null) document.getElementById("dh-passi").value = h.passi;
        this.umore = h.umore ? parseInt(h.umore) : null;
        this.buildHabitChecks();
        this.buildUmore();
        this.updateScoreBadge();
      }
    } catch(e) { console.error(e); }
  },

  buildRatings() {
    const row = document.getElementById("sl-qualita-row");
    if (!row) return;
    row.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.className = "rating-dot" + (this.qualita === i ? " on" : "");
      b.textContent = i;
      b.onclick = () => { this.qualita = i; this.buildRatings(); };
      row.appendChild(b);
    }
  },

  buildUmore() {
    const row = document.getElementById("dh-umore-row");
    if (!row) return;
    row.innerHTML = "";
    const faces = ["😞","😕","😐","🙂","😄"];
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.className = "rating-dot" + (this.umore === i ? " on" : "");
      b.textContent = i;
      b.onclick = () => { this.umore = i; this.buildUmore(); };
      row.appendChild(b);
    }
  },

  buildEnergia() {
    const row = document.getElementById("sl-energia-row");
    if (!row) return;
    row.innerHTML = "";
    const opts = [
      { v:"Stanco",      c:"#EF4444" },
      { v:"Nella norma", c:"#F5A623" },
      { v:"Riposato",    c:"#27D17F" },
    ];
    opts.forEach(o => {
      const b = document.createElement("button");
      b.className = "energia-btn" + (this.energia === o.v ? " on" : "");
      b.textContent = o.v;
      if (this.energia === o.v) { b.style.borderColor = o.c; b.style.color = o.c; }
      b.onclick = () => { this.energia = o.v; this.buildEnergia(); };
      row.appendChild(b);
    });
  },

  buildHabitChecks() {
    const wrap = document.getElementById("habit-checks");
    if (!wrap) return;
    wrap.innerHTML = "";
    this.HABITS.forEach(h => {
      const on = this.habitState[h.key];
      const item = document.createElement("button");
      item.className = "habit-check" + (on ? " on" : "");
      item.innerHTML = `<i class="ti ${h.icon}"></i><span>${h.label}</span><i class="ti ti-check habit-tick"></i>`;
      item.onclick = () => {
        this.habitState[h.key] = !this.habitState[h.key];
        this.buildHabitChecks();
        this.updateScoreBadge();
      };
      wrap.appendChild(item);
    });
  },

  updateScoreBadge() {
    const vals = Object.values(this.habitState);
    const score = Math.round(vals.filter(Boolean).length / vals.length * 100);
    const badge = document.getElementById("habit-score-badge");
    if (badge) badge.textContent = score + "%";
  },

  async saveSleep() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const data = {
      ore: get("sl-ore"),
      hrv: get("sl-hrv"),
      qualita: this.qualita,
      energia: this.energia,
      note: document.getElementById("sl-note")?.value || "",
    };
    if (data.ore == null) { U.alert("Inserisci almeno le ore dormite"); return; }
    try {
      await API.saveSleep(data);
      ["sl-ore","sl-hrv","sl-note"].forEach(id => { const e=document.getElementById(id); if(e) e.value=""; });
      this.qualita = null; this.energia = null;
      this.buildRatings(); this.buildEnergia();
      const msg = document.getElementById("sleep-save-msg");
      if (msg) { msg.style.display="flex"; setTimeout(()=>msg.style.display="none",2500); }
    } catch(e) { console.error(e); U.alert("Errore salvataggio sonno."); }
  },

  async saveHabit() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const data = {
      ...this.habitState,
      acqua: get("dh-acqua"),
      passi: get("dh-passi"),
      umore: this.umore,
    };
    try {
      const res = await API.saveHabit(data, this.habitId);
      if (res && res.id) this.habitId = res.id;
      const msg = document.getElementById("habit-save-msg");
      if (msg) { msg.style.display="flex"; setTimeout(()=>msg.style.display="none",2500); }
    } catch(e) { console.error(e); U.alert("Errore salvataggio abitudini."); }
  },

  // ── Limitazioni fisiche STANDING (info & esenzioni) — ON-DEVICE, distinte
  // dal diario di oggi (transitorio): "ginocchio operato" resta valido per
  // settimane/mesi, non solo per la giornata corrente. Alimentano sia il
  // consiglio automatico (Session.loadAIAdvice) sia il coach (Coach.ask), in
  // un campo SEPARATO dal diario così l'IA non le confonde con una nota
  // di oggi e non le ripete a ogni esercizio (motivo del "loop" percepito).
  LIMIT_KEY: "gymos_limitations",
  LIMIT_TAGS: [
    { key: "ginocchio", label: "Ginocchio",     icon: "ti-shoe" },
    { key: "spalla",    label: "Spalla",        icon: "ti-yoga" },
    { key: "schiena",   label: "Schiena",       icon: "ti-activity" },
    { key: "anca",      label: "Anca/bacino",   icon: "ti-walk" },
    { key: "caviglia",  label: "Caviglia/piede",icon: "ti-shoe-off" },
    { key: "polso",     label: "Polso/gomito",  icon: "ti-hand-stop" },
    { key: "altro",     label: "Altro",         icon: "ti-notes" },
  ],
  getLimitations() { try { return JSON.parse(localStorage.getItem(this.LIMIT_KEY) || "[]"); } catch (e) { return []; } },
  _saveLimitations(arr) { try { localStorage.setItem(this.LIMIT_KEY, JSON.stringify(arr)); } catch (e) {} },
  addLimitation(text, tag) {
    const t = (text || "").trim();
    if (!t) return;
    const arr = this.getLimitations();
    arr.push({ id: "lim" + Date.now(), text: t, tag: tag || "altro", ts: Date.now() });
    this._saveLimitations(arr);
    this.renderLimitations();
  },
  async removeLimitation(id) {
    if (!await U.confirm("Rimuovere questa limitazione?", { danger: true, okText: "Rimuovi" })) return;
    this._saveLimitations(this.getLimitations().filter(l => l.id !== id));
    this.renderLimitations();
  },
  // Riassunto compatto per l'IA: "Ginocchio: operato 2023, evita affondi profondi · Spalla: fastidio overhead"
  // Mandato ad OGNI chiamata /advice (ora una per serie) e /ask: senza un
  // cap, accumulare limitazioni nel tempo farebbe crescere il prompt senza
  // limite. 800 caratteri bastano ampiamente per l'uso reale (poche righe
  // per zona) e tengono il payload sotto controllo.
  standingLimitationsText() {
    const arr = this.getLimitations();
    if (!arr.length) return "";
    const byTag = {};
    arr.forEach(l => { (byTag[l.tag] = byTag[l.tag] || []).push(l.text); });
    const full = Object.keys(byTag).map(tag => {
      const lbl = (this.LIMIT_TAGS.find(t => t.key === tag) || {}).label || tag;
      return `${lbl}: ${byTag[tag].join("; ")}`;
    }).join(" · ");
    return full.length > 800 ? full.slice(0, 800) + "…" : full;
  },
  renderLimitations() {
    const wrap = document.getElementById("limitations-list");
    if (!wrap) return;
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const arr = this.getLimitations();
    if (!arr.length) { wrap.innerHTML = '<div class="limit-empty">Nessuna limitazione registrata — se hai un infortunio o un fastidio ricorrente, aggiungilo qui: il coach ne terrà conto sempre, non solo oggi.</div>'; return; }
    wrap.innerHTML = arr.map(l => {
      const tagInfo = this.LIMIT_TAGS.find(t => t.key === l.tag) || this.LIMIT_TAGS[this.LIMIT_TAGS.length - 1];
      return `<div class="limit-chip">
        <i class="ti ${tagInfo.icon}"></i>
        <div class="limit-chip-body"><span class="limit-chip-tag">${esc(tagInfo.label)}</span><span class="limit-chip-txt">${esc(l.text)}</span></div>
        <button class="limit-chip-rm" onclick="Diary.removeLimitation(${U.arg(l.id)})" aria-label="Rimuovi"><i class="ti ti-x"></i></button>
      </div>`;
    }).join("");
  },
  addLimitationFromForm() {
    const ta = document.getElementById("limit-ta");
    const sel = document.getElementById("limit-tag-sel");
    if (!ta || !ta.value.trim()) return;
    this.addLimitation(ta.value, sel ? sel.value : "altro");
    ta.value = "";
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Schede module (gestione schede)
// ═══════════════════════════════════════════════
