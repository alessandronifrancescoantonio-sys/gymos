// ═══════════════════════════════════════════════
//  GymOS — config.js  [GIÀ CONFIGURATO]
//  Database e Worker già compilati.
//  Devi solo: adattare SCHEDE/MISURE se vuoi.
// ═══════════════════════════════════════════════

const CONFIG = {

  // ─── URL del tuo Cloudflare Worker ───
  WORKER_URL: "https://gymos-api.alessandronifrancescoantonio.workers.dev/api",

  // ─── DATABASE IDs (dagli URL Notion) ───
  DB: {
    WORKOUT_LOG:     "8015f38fdf534c47957689203673012d",
    ESERCIZI_LOG:    "f9873bbbf029429bbe8eafd7d0b48da9",
    ESERCIZI_MASTER: "4f5453e0aaa34ec49513ef9a9d65536a",
    BODY_METRICS:    "6fe46b7f674440babaff5c324eabfe37",
    WEEKLY_PLANNER:  "4c02333d73b641bea8c3a53667575ec0",
    SLEEP_LOG:       "010da90871e64f6bab0b7929a27d3d27",
    DAILY_HABITS:    "0fb83772a017497b84c644b211b00bfa",
  },

  // ─── SCHEDE ───
  // Adatta gli esercizi alle TUE schede reali.
  // I nomi devono corrispondere esattamente a quelli in Esercizi Master.
  SCHEDE: {
    "Push": {
      color: "#FF3B2F",
      exercises: ["Panca piana", "Military press"]
    },
    "Pull": {
      color: "#3B82F6",
      exercises: ["Trazioni", "Lat Machine", "Curl bilanciere"]
    },
    "Legs": {
      color: "#22C55E",
      exercises: ["Squat", "Stacco", "Leg press"]
    },
  },

  // ─── MISURE CORPOREE ───
  MISURE: [
    { key: "vita",    label: "Vita",     unit: "cm", color: "#FF6B6B", downGood: true  },
    { key: "petto",   label: "Petto",    unit: "cm", color: "#60A5FA", downGood: false },
    { key: "fianchi", label: "Fianchi",  unit: "cm", color: "#A78BFA", downGood: true  },
    { key: "coscia",  label: "Coscia",   unit: "cm", color: "#34D399", downGood: false },
    { key: "braccio", label: "Braccio",  unit: "cm", color: "#FBBF24", downGood: false },
    { key: "bf",      label: "% Grasso", unit: "%",  color: "#F472B6", downGood: true  },
  ],

  // ─── NOMI PROPRIETÀ NOTION ───
  // Corrispondono ai database creati. Non modificare salvo rinomine.
  PROPS: {
    // Workout Log
    WL_NAME:   "Nome sessione",
    WL_DATE:   "Data",
    WL_TYPE:   "Tipo sessione",
    WL_DONE:   "Completata",
    WL_SPLIT:  "Split",

    // Esercizi Log
    EL_NAME:     "Nome",
    EL_EXERCISE: "Esercizio",
    EL_SESSION:  "Sessione",
    EL_SETS:     "Serie",
    EL_REPS:     "Ripetizioni",
    EL_KG:       "Carico (kg)",
    EL_RR_MIN:   "Rep range min",
    EL_RR_MAX:   "Rep range max",
    EL_NOTE:     "Note tecnica",
    EL_DATE:     "Data",

    // Body Metrics
    BM_DATE:    "Data",
    BM_PESO:    "Peso (kg)",
    BM_VITA:    "Vita (cm)",
    BM_PETTO:   "Petto (cm)",
    BM_FIANCHI: "Fianchi (cm)",
    BM_COSCIA:  "Coscia (cm)",
    BM_BRACCIO: "Braccio (cm)",
    BM_BF:      "% Grasso",
    BM_FASE:    "Fase",
    BM_NOTE:    "Note",

    // Weekly Planner
    WP_NAME: "Attività",
    WP_DATE: "Data",
    WP_TYPE: "Tipo",
    WP_DONE: "Completata",

    // Daily Habits
    DH_DATE:  "Data",
    DH_SCORE: "Habit score",

    // Sleep Log
    SL_DATE:    "Data",
    SL_ORE:     "Ore dormite",
    SL_QUALITA: "Qualità (1-5)",
    SL_HRV:     "HRV (ms)",
  },
};
