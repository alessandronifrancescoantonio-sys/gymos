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
    const res = await fetch(`${CONFIG.WORKER_URL}${path}`, opts);
    if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
    return res.json();
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

  // ─── HELPERS: costruttori di proprietà Notion ───

  prop: {
    title: (val) => ({ title: [{ text: { content: String(val) } }] }),
    rich_text: (val) => ({ rich_text: [{ text: { content: String(val) } }] }),
    number: (val) => ({ number: val === null ? null : Number(val) }),
    checkbox: (val) => ({ checkbox: Boolean(val) }),
    select: (val) => ({ select: { name: String(val) } }),
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
    }));
  },

  // Storico di un esercizio specifico (per progression tracker)
  async getExerciseHistory(exerciseName) {
    const pages = await this.query(
      CONFIG.DB.ESERCIZI_LOG,
      {
        property: CONFIG.PROPS.EL_NAME,
        rich_text: { contains: exerciseName }
      },
      [{ property: CONFIG.PROPS.EL_DATE, direction: "ascending" }],
      50
    );
    return pages.map(p => ({
      id:   p.id,
      date: this.read.date(p, CONFIG.PROPS.EL_DATE),
      sets: this.read.number(p, CONFIG.PROPS.EL_SETS),
      reps: this.read.number(p, CONFIG.PROPS.EL_REPS),
      kg:   this.read.number(p, CONFIG.PROPS.EL_KG),
      note: this.read.rich_text(p, CONFIG.PROPS.EL_NOTE),
    })).filter(e => e.date);
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
    // Title = data per semplicità
    props[CONFIG.PROPS.WL_NAME] = API.prop.title(`Check-in ${d}`);
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
      ore:     this.read.formula_number(p, CONFIG.PROPS.SL_ORE) || this.read.number(p, CONFIG.PROPS.SL_ORE),
      qualita: this.read.number(p, CONFIG.PROPS.SL_QUALITA),
      hrv:     this.read.number(p, CONFIG.PROPS.SL_HRV),
    })).filter(s => s.date);
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
