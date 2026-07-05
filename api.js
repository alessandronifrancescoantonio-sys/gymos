// ═══════════════════════════════════════════════
//  GymOS — api.js
//  Layer di comunicazione con Notion via Worker
// ═══════════════════════════════════════════════

const API = {

  // ─── BASE CALL ───
  async call(path, method = "GET", body = null) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(`${CONFIG.WORKER_URL}${path}`, opts);
    } catch (e) {
      this._netToast("Nessuna connessione — riprova");
      throw e;
    }
    if (!res.ok) {
      this._netToast(`Errore server (${res.status})`);
      throw new Error(`Notion API error: ${res.status}`);
    }
    return res.json();
  },

  // Avviso di rete con debounce (evita raffiche di toast identici)
  _netToast(msg) {
    const now = Date.now();
    if (this._lastNet && now - this._lastNet < 4000) return;
    this._lastNet = now;
    if (typeof U !== "undefined" && U.toast) U.toast(msg, "err", 3000);
  },

  // ─── QUERY DATABASE ───
  async query(dbId, filter = null, sorts = null, pageSize = 100) {
    const body = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sorts)  body.sorts  = sorts;
    const res = await this.call(`/databases/${dbId}/query`, "POST", body);
    return res.results || [];
  },

  // ─── CREATE PAGE (nuova entry) ───
  async create(dbId, properties) {
    return this.call("/pages", "POST", {
      parent: { database_id: dbId },
      properties,
    });
  },

  // ─── UPDATE PAGE ───
  async update(pageId, properties) {
    return this.call(`/pages/${pageId}`, "PATCH", { properties });
  },

  // ─── ARCHIVE PAGE (rimozione vera: sparisce dalle query) ───
  async archivePage(pageId) {
    return this.call(`/pages/${pageId}`, "PATCH", { archived: true });
  },

  // ─── HELPERS: costruttori di proprietà Notion ───

  prop: {
    title: (val) => ({ title: [{ text: { content: String(val) } }] }),
    rich_text: (val) => ({ rich_text: [{ text: { content: String(val) } }] }),
    number: (val) => ({ number: val === null ? null : Number(val) }),
    checkbox: (val) => ({ checkbox: Boolean(val) }),
    select: (val) => ({ select: val ? { name: String(val) } : null }),
    multi_select: (vals) => ({ multi_select: (vals || []).map(name => ({ name: String(name) })) }),
    date: (val) => ({ date: { start: val } }),  // val = "YYYY-MM-DD"
    relation: (ids) => ({ relation: ids.map(id => ({ id })) }),
  },

  // ─── HELPERS: leggere proprietà da pagine Notion ───

  read: {
    title: (page, prop) => {
      const p = page.properties[prop];
      return p?.title?.[0]?.plain_text || "";
    },
    rich_text: (page, prop) => {
      const p = page.properties[prop];
      return p?.rich_text?.[0]?.plain_text || "";
    },
    number: (page, prop) => {
      const p = page.properties[prop];
      return p?.number ?? null;
    },
    checkbox: (page, prop) => {
      const p = page.properties[prop];
      return p?.checkbox ?? false;
    },
    select: (page, prop) => {
      const p = page.properties[prop];
      return p?.select?.name || "";
    },
    multi_select: (page, prop) => {
      const p = page.properties[prop];
      return (p?.multi_select || []).map(o => o.name);
    },
    date: (page, prop) => {
      const p = page.properties[prop];
      return p?.date?.start || null;
    },
    formula_number: (page, prop) => {
      const p = page.properties[prop];
      return p?.formula?.number ?? null;
    },
    formula_string: (page, prop) => {
      const p = page.properties[prop];
      return p?.formula?.string || "";
    },
    rollup_number: (page, prop) => {
      const p = page.properties[prop];
      return p?.rollup?.number ?? null;
    },
    relation: (page, prop) => {
      const p = page.properties[prop];
      return (p?.relation || []).map(r => r.id);
    },
  },

  // ─── DATA FETCHERS specifici per GymOS ───

  // Ultime N sessioni del Workout Log
  async getWorkoutSessions(n = 20) {
    const pages = await this.query(
      CONFIG.DB.WORKOUT_LOG,
      null,
      [{ property: CONFIG.PROPS.WL_DATE, direction: "descending" }],
      n
    );
    return pages.map(p => ({
      id: p.id,
      name: this.read.title(p, CONFIG.PROPS.WL_NAME),
      date: this.read.date(p, CONFIG.PROPS.WL_DATE),
      type: this.read.select(p, CONFIG.PROPS.WL_TYPE),
      done: this.read.checkbox(p, CONFIG.PROPS.WL_DONE),
      split: this.read.select(p, CONFIG.PROPS.WL_SPLIT),
      note: this.read.rich_text(p, CONFIG.PROPS.WL_NOTE),
    }));
  },

  // Esercizi log di una sessione (per session page)
  async getSessionExercises(workoutLogId) {
    const pages = await this.query(
      CONFIG.DB.ESERCIZI_LOG,
      {
        property: CONFIG.PROPS.EL_SESSION,
        relation: { contains: workoutLogId }
      }
    );
    return pages.map(p => ({
      id: p.id,
      name: this.read.title(p, CONFIG.PROPS.EL_NAME),
      sets: this.read.number(p, CONFIG.PROPS.EL_SETS),
      reps: this.read.number(p, CONFIG.PROPS.EL_REPS),
      kg:   this.read.number(p, CONFIG.PROPS.EL_KG),
      rrMin:this.read.number(p, CONFIG.PROPS.EL_RR_MIN),
      rrMax:this.read.number(p, CONFIG.PROPS.EL_RR_MAX),
      note: this.read.rich_text(p, CONFIG.PROPS.EL_NOTE),
      date: this.read.date(p, CONFIG.PROPS.EL_DATE),
      tecnica:  this.read.multi_select(p, CONFIG.PROPS.EL_TECNICA),
      cadenza:  this.read.rich_text(p, CONFIG.PROPS.EL_CADENZA),
      gruppo:   this.read.select(p, CONFIG.PROPS.EL_GRUPPO),
      recupero: this.read.number(p, CONFIG.PROPS.EL_RECUPERO),
      rir:      this.read.number(p, CONFIG.PROPS.EL_RIR),
      info:     this.read.rich_text(p, CONFIG.PROPS.EL_INFO),
    }))
      // Notion non garantisce l'ordine dei risultati: ordina per numero di serie
      // (S<n> nel titolo) così S1/S2/S3 restano stabili e il confronto con la
      // sessione precedente avviene serie-per-serie corretta.
      .sort((a, b) => {
        const num = e => { const m = (e.name || "").split(" – ").pop().match(/S(\d+)/); return m ? parseInt(m[1]) : 999; };
        return num(a) - num(b);
      });
  },

  // Aggiorna i campi "tecnica di intensità" di una entry esercizio
  async updateExerciseTech(pageId, tech) {
    const props = {};
    if (tech.tecnica  !== undefined) props[CONFIG.PROPS.EL_TECNICA]  = API.prop.multi_select(tech.tecnica);
    if (tech.cadenza  !== undefined) props[CONFIG.PROPS.EL_CADENZA]  = API.prop.rich_text(tech.cadenza);
    if (tech.gruppo   !== undefined) props[CONFIG.PROPS.EL_GRUPPO]   = API.prop.select(tech.gruppo);
    if (tech.recupero !== undefined) props[CONFIG.PROPS.EL_RECUPERO] = API.prop.number(tech.recupero);
    if (tech.rir      !== undefined) props[CONFIG.PROPS.EL_RIR]      = API.prop.number(tech.rir);
    if (tech.info     !== undefined) props[CONFIG.PROPS.EL_INFO]     = API.prop.rich_text(tech.info);
    if (tech.rrMin    !== undefined) props[CONFIG.PROPS.EL_RR_MIN]   = API.prop.number(tech.rrMin);
    if (tech.rrMax    !== undefined) props[CONFIG.PROPS.EL_RR_MAX]   = API.prop.number(tech.rrMax);
    return this.update(pageId, props);
  },

  // Storico di un esercizio specifico (per progression tracker)
  async getExerciseHistory(exerciseName) {
    const pages = await this.query(
      CONFIG.DB.ESERCIZI_LOG,
      {
        property: CONFIG.PROPS.EL_NAME,
        rich_text: { contains: exerciseName }
      },
      // Discendente: con il limite a 50 righe prendi le sedute più RECENTI
      // (ascendente prenderebbe le più vecchie e l'analisi resterebbe indietro).
      // I consumatori (Progression, _statsFromHistory) riordinano da soli.
      [{ property: CONFIG.PROPS.EL_DATE, direction: "descending" }],
      50
    );
    return pages.map(p => ({
      id:   p.id,
      name: this.read.title(p, CONFIG.PROPS.EL_NAME),
      date: this.read.date(p, CONFIG.PROPS.EL_DATE),
      sets: this.read.number(p, CONFIG.PROPS.EL_SETS),
      reps: this.read.number(p, CONFIG.PROPS.EL_REPS),
      kg:   this.read.number(p, CONFIG.PROPS.EL_KG),
      note: this.read.rich_text(p, CONFIG.PROPS.EL_NOTE),
    })).filter(e => e.date)
      // "contains" di Notion è un match per sottostringa: "Leg Curl" pescherebbe
      // anche "Leg Curl Seduto". Filtra sul nome esatto (prima parte del titolo).
      .filter(e => (e.name || "").split(" – ")[0] === exerciseName);
  },

  // Body metrics (check-in corporei)
  async getBodyMetrics(n = 30) {
    const pages = await this.query(
      CONFIG.DB.BODY_METRICS,
      null,
      [{ property: CONFIG.PROPS.BM_DATE, direction: "ascending" }],
      n
    );
    return pages.map(p => ({
      id:      p.id,
      date:    this.read.date(p, CONFIG.PROPS.BM_DATE),
      peso:    this.read.number(p, CONFIG.PROPS.BM_PESO),
      vita:    this.read.number(p, CONFIG.PROPS.BM_VITA),
      petto:   this.read.number(p, CONFIG.PROPS.BM_PETTO),
      fianchi: this.read.number(p, CONFIG.PROPS.BM_FIANCHI),
      coscia:  this.read.number(p, CONFIG.PROPS.BM_COSCIA),
      braccio: this.read.number(p, CONFIG.PROPS.BM_BRACCIO),
      bf:      this.read.number(p, CONFIG.PROPS.BM_BF),
      fase:    this.read.select(p, CONFIG.PROPS.BM_FASE),
      note:    this.read.rich_text(p, CONFIG.PROPS.BM_NOTE),
    })).filter(c => c.date);
  },

  // Salva nuovo check-in corporeo
  async saveBodyCheckin(data) {
    const props = {};
    const d = new Date().toISOString().split("T")[0];
    props[CONFIG.PROPS.BM_DATE]    = API.prop.date(d);
    props[CONFIG.PROPS.BM_FASE]    = API.prop.select(data.fase);
    if (data.peso    != null) props[CONFIG.PROPS.BM_PESO]    = API.prop.number(data.peso);
    if (data.vita    != null) props[CONFIG.PROPS.BM_VITA]    = API.prop.number(data.vita);
    if (data.petto   != null) props[CONFIG.PROPS.BM_PETTO]   = API.prop.number(data.petto);
    if (data.fianchi != null) props[CONFIG.PROPS.BM_FIANCHI] = API.prop.number(data.fianchi);
    if (data.coscia  != null) props[CONFIG.PROPS.BM_COSCIA]  = API.prop.number(data.coscia);
    if (data.braccio != null) props[CONFIG.PROPS.BM_BRACCIO] = API.prop.number(data.braccio);
    if (data.bf      != null) props[CONFIG.PROPS.BM_BF]      = API.prop.number(data.bf);
    if (data.note)             props[CONFIG.PROPS.BM_NOTE]   = API.prop.rich_text(data.note);
    // Title = proprietà "Check-in" del DB Body Metrics (non "Nome sessione")
    props[CONFIG.PROPS.BM_NAME] = API.prop.title(`Check-in ${d}`);
    return this.create(CONFIG.DB.BODY_METRICS, props);
  },

  // Weekly planner — task di oggi
  async getTodayTasks() {
    const today = new Date().toISOString().split("T")[0];
    const pages = await this.query(
      CONFIG.DB.WEEKLY_PLANNER,
      {
        and: [
          { property: CONFIG.PROPS.WP_DATE, date: { equals: today } },
        ]
      }
    );
    return pages.map(p => ({
      id:   p.id,
      name: this.read.title(p, CONFIG.PROPS.WP_NAME),
      type: this.read.select(p, CONFIG.PROPS.WP_TYPE),
      done: this.read.checkbox(p, CONFIG.PROPS.WP_DONE),
    }));
  },

  // Segna task come completato
  async completeTask(pageId, done = true) {
    const props = {};
    props[CONFIG.PROPS.WP_DONE] = API.prop.checkbox(done);
    return this.update(pageId, props);
  },

  // Sleep log ultimi 7 giorni
  async getRecentSleep(n = 7) {
    const pages = await this.query(
      CONFIG.DB.SLEEP_LOG,
      null,
      [{ property: CONFIG.PROPS.SL_DATE, direction: "descending" }],
      n
    );
    return pages.map(p => ({
      date:    this.read.date(p, CONFIG.PROPS.SL_DATE),
      ore:     this.read.number(p, CONFIG.PROPS.SL_ORE),
      qualita: parseInt(this.read.select(p, CONFIG.PROPS.SL_QUALITA)) || null,
      hrv:     this.read.number(p, CONFIG.PROPS.SL_HRV),
    })).filter(s => s.date);
  },

  async getRecentHabits(n = 7) {
    const pages = await this.query(
      CONFIG.DB.DAILY_HABITS,
      null,
      [{ property: CONFIG.PROPS.DH_DATE, direction: "descending" }],
      n
    );
    return pages.map(p => ({
      date:  this.read.date(p, CONFIG.PROPS.DH_DATE),
      score: this.read.formula_number(p, CONFIG.PROPS.DH_SCORE),
    })).filter(h => h.date);
  },

  // Aggiorna entry esercizio esistente
  async updateExerciseEntry(pageId, sets, reps, kg, note) {
    const props = {};
    props[CONFIG.PROPS.EL_SETS] = API.prop.number(sets);
    props[CONFIG.PROPS.EL_REPS] = API.prop.number(reps);
    props[CONFIG.PROPS.EL_KG]   = API.prop.number(kg);
    if (note !== undefined) props[CONFIG.PROPS.EL_NOTE] = API.prop.rich_text(note);
    return this.update(pageId, props);
  },

  // ─── CARDIO ───
  async getCardioSessions(n = 50) {
    const pages = await this.query(
      CONFIG.DB.CARDIO_LOG,
      null,
      [{ property: CONFIG.PROPS.CA_DATE, direction: "descending" }],
      n
    );
    return pages.map(p => ({
      id:     p.id,
      name:   this.read.title(p, CONFIG.PROPS.CA_NAME),
      date:   this.read.date(p, CONFIG.PROPS.CA_DATE),
      tipo:   this.read.rich_text(p, CONFIG.PROPS.CA_TIPO),
      durata: this.read.number(p, CONFIG.PROPS.CA_DURATA),
      dist:   this.read.number(p, CONFIG.PROPS.CA_DIST),
      kcal:   this.read.number(p, CONFIG.PROPS.CA_KCAL),
      incl:   this.read.number(p, CONFIG.PROPS.CA_INCL),
      vel:    this.read.number(p, CONFIG.PROPS.CA_VEL),
      fatto:  this.read.checkbox(p, CONFIG.PROPS.CA_FATTO),
      note:   this.read.rich_text(p, CONFIG.PROPS.CA_NOTE),
    })).filter(c => c.date);
  },

  async saveCardio(data) {
    const props = {};
    const d = data.date || new Date().toISOString().split("T")[0];
    props[CONFIG.PROPS.CA_NAME] = API.prop.title((data.tipo || "Cardio") + " " + d);
    props[CONFIG.PROPS.CA_DATE] = API.prop.date(d);
    if (data.tipo)            props[CONFIG.PROPS.CA_TIPO]   = API.prop.rich_text(data.tipo);
    if (data.durata != null)  props[CONFIG.PROPS.CA_DURATA] = API.prop.number(data.durata);
    if (data.dist   != null)  props[CONFIG.PROPS.CA_DIST]   = API.prop.number(data.dist);
    if (data.kcal   != null)  props[CONFIG.PROPS.CA_KCAL]   = API.prop.number(data.kcal);
    if (data.incl   != null)  props[CONFIG.PROPS.CA_INCL]   = API.prop.number(data.incl);
    if (data.vel    != null)  props[CONFIG.PROPS.CA_VEL]    = API.prop.number(data.vel);
    props[CONFIG.PROPS.CA_FATTO] = API.prop.checkbox(!!data.fatto);
    if (data.note)            props[CONFIG.PROPS.CA_NOTE]   = API.prop.rich_text(data.note);
    return this.create(CONFIG.DB.CARDIO_LOG, props);
  },

  async updateCardioDone(id, done) {
    return this.update(id, { [CONFIG.PROPS.CA_FATTO]: API.prop.checkbox(done) });
  },

  // ─── SONNO ───
  async saveSleep(data) {
    const props = {};
    const d = data.date || new Date().toISOString().split("T")[0];
    props[CONFIG.PROPS.SL_NAME] = API.prop.title("Notte " + d);
    props[CONFIG.PROPS.SL_DATE] = API.prop.date(d);
    if (data.ore != null)     props[CONFIG.PROPS.SL_ORE]     = API.prop.number(data.ore);
    if (data.qualita)         props[CONFIG.PROPS.SL_QUALITA] = API.prop.select(String(data.qualita));
    if (data.hrv != null)     props[CONFIG.PROPS.SL_HRV]     = API.prop.number(data.hrv);
    if (data.energia)         props[CONFIG.PROPS.SL_ENERGIA] = API.prop.select(data.energia);
    if (data.note)            props[CONFIG.PROPS.SL_NOTE]    = API.prop.rich_text(data.note);
    return this.create(CONFIG.DB.SLEEP_LOG, props);
  },

  // ─── HABITS ───
  async getTodayHabit() {
    const today = new Date().toISOString().split("T")[0];
    const pages = await this.query(
      CONFIG.DB.DAILY_HABITS,
      { property: CONFIG.PROPS.DH_DATE, date: { equals: today } },
      null, 1
    );
    if (!pages.length) return null;
    const p = pages[0];
    return {
      id:     p.id,
      acqua:  this.read.number(p, CONFIG.PROPS.DH_ACQUA),
      passi:  this.read.number(p, CONFIG.PROPS.DH_PASSI),
      allen:  this.read.checkbox(p, CONFIG.PROPS.DH_ALLEN),
      prot:   this.read.checkbox(p, CONFIG.PROPS.DH_PROT),
      integ:  this.read.checkbox(p, CONFIG.PROPS.DH_INTEG),
      mobil:  this.read.checkbox(p, CONFIG.PROPS.DH_MOBIL),
      pesoReg:this.read.checkbox(p, CONFIG.PROPS.DH_PESO),
      umore:  this.read.select(p, CONFIG.PROPS.DH_UMORE),
      score:  this.read.formula_number(p, CONFIG.PROPS.DH_SCORE),
      note:   this.read.rich_text(p, CONFIG.PROPS.DH_NOTE),
    };
  },

  async saveHabit(data, existingId) {
    const today = new Date().toISOString().split("T")[0];
    const props = {};
    props[CONFIG.PROPS.DH_NAME]  = API.prop.title("Giorno " + today);
    props[CONFIG.PROPS.DH_DATE]  = API.prop.date(today);
    if (data.acqua != null) props[CONFIG.PROPS.DH_ACQUA] = API.prop.number(data.acqua);
    if (data.passi != null) props[CONFIG.PROPS.DH_PASSI] = API.prop.number(data.passi);
    props[CONFIG.PROPS.DH_ALLEN] = API.prop.checkbox(!!data.allen);
    props[CONFIG.PROPS.DH_PROT]  = API.prop.checkbox(!!data.prot);
    props[CONFIG.PROPS.DH_INTEG] = API.prop.checkbox(!!data.integ);
    props[CONFIG.PROPS.DH_MOBIL] = API.prop.checkbox(!!data.mobil);
    props[CONFIG.PROPS.DH_PESO]  = API.prop.checkbox(!!data.pesoReg);
    if (data.umore)  props[CONFIG.PROPS.DH_UMORE] = API.prop.select(String(data.umore));
    if (data.note)   props[CONFIG.PROPS.DH_NOTE]  = API.prop.rich_text(data.note);
    if (existingId) return this.update(existingId, props);
    return this.create(CONFIG.DB.DAILY_HABITS, props);
  },

  // ─── SCHEDE (gestione dall'app) ───
  COLOR_MAP: {
    "Rosso":"#FF3B2F", "Blu":"#3B82F6", "Verde":"#27D17F",
    "Arancione":"#F5A623", "Viola":"#A78BFA", "Rosa":"#F472B6", "Giallo":"#EAB308"
  },
  COLOR_REV: {
    "#FF3B2F":"Rosso", "#3B82F6":"Blu", "#27D17F":"Verde",
    "#F5A623":"Arancione", "#A78BFA":"Viola", "#F472B6":"Rosa", "#EAB308":"Giallo"
  },

  async getSchede() {
    const pages = await this.query(
      CONFIG.DB.SCHEDE_DB,
      null,
      [{ property: CONFIG.PROPS.SC_ORDINE, direction: "ascending" }],
      50
    );
    return pages.map(p => {
      let exercises = [];
      try { exercises = JSON.parse(this.read.rich_text(p, CONFIG.PROPS.SC_ESERCIZI) || "[]"); } catch {}
      const colorName = this.read.select(p, CONFIG.PROPS.SC_COLORE);
      return {
        id:      p.id,
        nome:    this.read.title(p, CONFIG.PROPS.SC_NOME),
        colore:  this.COLOR_MAP[colorName] || "#FF3B2F",
        coloreName: colorName,
        ordine:  this.read.number(p, CONFIG.PROPS.SC_ORDINE) || 0,
        exercises,
        attiva:  this.read.checkbox(p, CONFIG.PROPS.SC_ATTIVA),
        programma:   this.read.rich_text(p, CONFIG.PROPS.SC_PROG) || "La mia scheda",
        progAttivo:  this.read.checkbox(p, CONFIG.PROPS.SC_PROG_ON),
      };
    }).filter(s => s.attiva !== false);
  },

  // Una "seduta" è una riga del DB Schede (appartiene a un Programma)
  async createScheda(nome, colorName, exercises, ordine, programma, progAttivo) {
    const props = {};
    props[CONFIG.PROPS.SC_NOME]     = API.prop.title(nome);
    props[CONFIG.PROPS.SC_COLORE]   = API.prop.select(colorName || "Rosso");
    props[CONFIG.PROPS.SC_ORDINE]   = API.prop.number(ordine || 0);
    props[CONFIG.PROPS.SC_ESERCIZI] = API.prop.rich_text(JSON.stringify(exercises || []));
    props[CONFIG.PROPS.SC_ATTIVA]   = API.prop.checkbox(true);
    props[CONFIG.PROPS.SC_PROG]     = API.prop.rich_text(programma || "La mia scheda");
    props[CONFIG.PROPS.SC_PROG_ON]  = API.prop.checkbox(!!progAttivo);
    return this.create(CONFIG.DB.SCHEDE_DB, props);
  },

  async updateScheda(id, fields) {
    const props = {};
    if (fields.nome       != null) props[CONFIG.PROPS.SC_NOME]     = API.prop.title(fields.nome);
    if (fields.colorName  != null) props[CONFIG.PROPS.SC_COLORE]   = API.prop.select(fields.colorName);
    if (fields.ordine     != null) props[CONFIG.PROPS.SC_ORDINE]   = API.prop.number(fields.ordine);
    if (fields.exercises  != null) props[CONFIG.PROPS.SC_ESERCIZI] = API.prop.rich_text(JSON.stringify(fields.exercises));
    if (fields.programma  != null) props[CONFIG.PROPS.SC_PROG]     = API.prop.rich_text(fields.programma);
    if (fields.progAttivo != null) props[CONFIG.PROPS.SC_PROG_ON]  = API.prop.checkbox(!!fields.progAttivo);
    return this.update(id, props);
  },

  // Rende attivo un programma: imposta progAttivo su tutte le sue sedute, false sulle altre
  async setActiveProgram(programma, allSedute) {
    await Promise.all((allSedute || []).map(s =>
      this.update(s.id, { [CONFIG.PROPS.SC_PROG_ON]: API.prop.checkbox(s.programma === programma) })
    ));
  },

  async deleteScheda(id) {
    // Notion non cancella via API: archivia (Attiva = false)
    return this.update(id, { [CONFIG.PROPS.SC_ATTIVA]: API.prop.checkbox(false) });
  },

  // Test connessione
  async testConnection() {
    try {
      await this.call(`/databases/${CONFIG.DB.WORKOUT_LOG}`);
      return true;
    } catch {
      return false;
    }
  },
};
