// ═══════════════════════════════════════════════
//  GymOS — config.js  [CONFIGURATO]
// ═══════════════════════════════════════════════

const CONFIG = {

  WORKER_URL: "https://gymos-api.alessandronifrancescoantonio.workers.dev/api",

  DB: {
    WORKOUT_LOG:     "8015f38fdf534c47957689203673012d",
    ESERCIZI_LOG:    "f9873bbbf029429bbe8eafd7d0b48da9",
    ESERCIZI_MASTER: "4f5453e0aaa34ec49513ef9a9d65536a",
    BODY_METRICS:    "6fe46b7f674440babaff5c324eabfe37",
    WEEKLY_PLANNER:  "4c02333d73b641bea8c3a53667575ec0",
    SLEEP_LOG:       "010da90871e64f6bab0b7929a27d3d27",
    DAILY_HABITS:    "0fb83772a017497b84c644b211b00bfa",
    CARDIO_LOG:      "cee200aa0ce34d1785522c9f2c90bb38",
    SCHEDE_DB:       "f53798e7cb2b4b0cb1de4fe9df24bd67",
  },

  SCHEDE: {
    "Full Body 1": {
      color: "#FF3B2F",
      exercises: [
        "Adduttori",
        "Overhead Ext",
        "RDL Bilanciere",
        "Pec Back",
        "Belt Squat",
        "Shoulder Press",
        "Circular Upper Back",
        "Curl Martello Panca 50",
      ]
    },
    "Full Body 2": {
      color: "#3B82F6",
      exercises: [
        "Polpacci in Piedi",
        "Alz Lat Cavo Basso",
        "Pendulum",
        "Illiac",
        "Leg Curl Seduto",
        "Smith 32",
        "Bayesan Curl",
        "Push Down Triangolo",
      ]
    },
    "Full Body 3": {
      color: "#22C55E",
      exercises: [
        "Adduttori",
        "Polpacci Seduto",
        "Alz Lat Macchinario",
        "Dist 0 Macchinario",
        "Leg Ext",
        "Low Row",
        "Leg Curl",
        "Skull Crash",
        "Panca Scott Macchinario",
      ]
    },
    "Full Body 4": {
      color: "#F59E0B",
      exercises: [
        "Polpacci Seduto",
        "Alz Lat Macchinario",
        "Leg Curl Seduto",
        "Pressa",
        "Chest Press Inclined",
        "Macchinario Tric Overhead",
        "Pulley Triangolo",
        "Curl Martello al Cavo",
        "Spalle Posteriori",
      ]
    },
  },

  MISURE: [
    { key: "vita",    label: "Vita",     unit: "cm", color: "#FF6B6B", downGood: true  },
    { key: "petto",   label: "Petto",    unit: "cm", color: "#60A5FA", downGood: false },
    { key: "fianchi", label: "Fianchi",  unit: "cm", color: "#A78BFA", downGood: true  },
    { key: "coscia",  label: "Coscia",   unit: "cm", color: "#34D399", downGood: false },
    { key: "braccio", label: "Braccio",  unit: "cm", color: "#FBBF24", downGood: false },
    { key: "bf",      label: "% Grasso", unit: "%",  color: "#F472B6", downGood: true  },
  ],

  // Tecniche di intensità selezionabili nella sessione (devono esistere come
  // opzioni nel multi-select "Tecnica" del DB Esercizi Log su Notion).
  TECNICHE: [
    { name: "Drop set",     color: "#FF3B2F" },
    { name: "Stripping",    color: "#FF6B6B" },
    { name: "Rest-pause",   color: "#F5A623" },
    { name: "Myo-reps",     color: "#EAB308" },
    { name: "Superset",     color: "#3B82F6" },
    { name: "Giant set",    color: "#A78BFA" },
    { name: "Eccentriche",  color: "#27D17F" },
    { name: "Tempo lento",  color: "#34D399" },
  ],
  GRUPPI: ["A", "B", "C", "D", "E", "F"],

  PROPS: {
    WL_NAME:   "Nome sessione",
    WL_DATE:   "Data",
    WL_TYPE:   "Tipo sessione",
    WL_DONE:   "Completata",
    WL_SPLIT:  "Split",
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
    EL_TECNICA:  "Tecnica",
    EL_CADENZA:  "Cadenza",
    EL_GRUPPO:   "Gruppo",
    EL_RECUPERO: "Recupero (s)",
    EL_INFO:     "Info tecnica",
    BM_NAME:    "Check-in",
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
    WP_NAME: "Attività",
    WP_DATE: "Data",
    WP_TYPE: "Tipo",
    WP_DONE: "Completata",
    DH_NAME:  "Giorno",
    DH_DATE:  "Data",
    DH_ACQUA: "Acqua (L)",
    DH_PASSI: "Passi",
    DH_ALLEN: "Allenamento",
    DH_PROT:  "Proteine ok",
    DH_INTEG: "Integratori",
    DH_MOBIL: "Mobilità",
    DH_PESO:  "Peso registrato",
    DH_UMORE: "Umore (1-5)",
    DH_SCORE: "Habit score",
    DH_NOTE:  "Note",
    SL_NAME:    "Notte",
    SL_DATE:    "Data",
    SL_ORE:     "Ore dormite",
    SL_QUALITA: "Qualità (1-5)",
    SL_HRV:     "HRV (ms)",
    SL_ENERGIA: "Energia al risveglio",
    SL_NOTE:    "Note",

    // Cardio Log
    CA_NAME:    "Nome",
    CA_DATE:    "Data",
    CA_TIPO:    "Tipo",
    CA_DURATA:  "Durata (min)",
    CA_DIST:    "Distanza (km)",
    CA_KCAL:    "Calorie",
    CA_INCL:    "Inclinazione (%)",
    CA_VEL:     "Velocità (km/h)",
    CA_FATTO:   "Fatto",
    CA_NOTE:    "Note",

    // Schede
    SC_NOME:     "Nome",
    SC_COLORE:   "Colore",
    SC_ORDINE:   "Ordine",
    SC_ESERCIZI: "Esercizi",
    SC_ATTIVA:   "Attiva",
    SC_NOTE:     "Note",
    SC_PROG:     "Programma",
    SC_PROG_ON:  "Programma attivo",
  },
};
