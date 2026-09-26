const Volume = {
  MUSCLES: ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Quadricipiti", "Femorali", "Glutei", "Polpacci", "Adduttori", "Addome", "Avambracci"],
  MEV: 10, MAV_HI: 20,   // zona ottimale (MAV): 10–20 serie/settimana

  // Classificatore automatico per nome esercizio → {muscolo: frazione}.
  // L'ORDINE conta: i pattern specifici stanno prima di quelli generici.
  classify(name) {
    const s = " " + (name || "").toLowerCase() + " ";
    const t = re => re.test(s);
    if (t(/polpacc|calf/)) return { Polpacci: 1 };
    if (t(/addutt/)) return { Adduttori: 1 };
    if (t(/addome|crunch|plank|abs |core|oblique/)) return { Addome: 1 };
    if (t(/glute|hip thrust|ponte/)) return { Glutei: 1 };
    if (t(/rdl|stacco rumeno|romanian|good morning/)) return { Femorali: 1, Glutei: 0.5 };
    if (t(/leg curl|femoral|nordic/)) return { Femorali: 1 };
    if (t(/leg ext|quadric/)) return { Quadricipiti: 1 };
    if (t(/squat|pressa|leg press|pendulum|belt|hack|affond|lunge|pistol/)) return { Quadricipiti: 1, Glutei: 0.5 };
    if (t(/avambracc|wrist|polso|forearm/)) return { Avambracci: 1 };
    if (t(/martell|hammer/)) return { Bicipiti: 1 };
    if (t(/curl|scott|bayes|bicip|preacher/)) return { Bicipiti: 1 };
    if (t(/push ?down|skull|french|overhead ext|tric|dip|kick ?back/)) return { Tricipiti: 1 };
    // Deltoidi posteriori PRIMA di "spalle" generico: niente tricipiti fantasma
    if (t(/rear|posterior|pec back|reverse|face pull/)) return { Spalle: 1 };
    if (t(/alz lat|laterali|lateral raise|alzate/)) return { Spalle: 1 };
    // "distensioni sopra la testa / militari / lento" = spinte sopra la testa →
    // SPALLE, da distinguere dalle "distensioni su panca/manubri" = PETTO sotto.
    if (t(/shoulder press|overhead press|militar|lento avanti|lento dietro|arnold|spalle|distensioni.*(sopra|alto|testa|dietro)/)) return { Spalle: 1, Tricipiti: 0.5 };
    if (t(/row|pulley|rematore|low row|lat mach|pulldown|trazion|pull ?up|upper back|dorso/)) return { Dorso: 1, Bicipiti: 0.5 };
    // Croci/fly: il gomito non si estende → niente tricipiti
    if (t(/croci|fly|pec deck/)) return { Petto: 1, Spalle: 0.5 };
    // "distensioni/distensione" (IT per le spinte) = petto di default (panca,
    // manubri, inclinata); le varianti sopra la testa sono già andate a Spalle.
    if (t(/pec|chest|panca|bench|dist |distension|piegament|push ?up|press/)) return { Petto: 1, Spalle: 0.5, Tricipiti: 0.5 };
    return {};   // sconosciuto → l'utente assegna a mano
  },

  // #3 PT scientifico — PATTERN di movimento, per valutare quanto un esercizio
  // è un buon SOSTITUTO di un altro (macchinario occupato ecc.). Non basta lo
  // stesso muscolo: la panca e le croci colpiscono il petto ma con pattern
  // diversi (spinta vs isolamento). L'isolamento monoarticolare va riconosciuto
  // PRIMA dei composti, e i composti hinge PRIMA dell'isolamento gambe (un RDL
  // non è isolamento). Ritorna: push | pull | squat | hinge | iso | core | calf.
  pattern(name) {
    const s = " " + (name || "").toLowerCase() + " ";
    const t = re => re.test(s);
    if (t(/polpacc|calf/)) return "calf";
    if (t(/addome|crunch|plank|abs |core|oblique|addutt/)) return "core";
    if (t(/rdl|stacco|romanian|good morning|hip thrust|deadlift/)) return "hinge";
    if (t(/squat|pressa|leg press|pendulum|belt|hack|affond|lunge|pistol/)) return "squat";
    if (t(/leg ext|leg curl|nordic|femoral/)) return "iso";
    if (t(/curl|scott|bayes|preacher|martell|hammer|bicip/)) return "iso";
    if (t(/push ?down|skull|french|overhead ext|kick ?back|tric/)) return "iso";
    if (t(/alz lat|laterali|lateral raise|alzate|rear|posterior|reverse|face pull|croci|\bfly\b|pec deck/)) return "iso";
    if (t(/avambracc|wrist|polso|forearm/)) return "iso";
    if (t(/row|pulley|rematore|low row|lat mach|pulldown|trazion|pull ?up|upper back/)) return "pull";
    if (t(/shoulder press|overhead press|military|lento|arnold|panca|bench|dist |distension|piegament|push ?up|\bdip\b|press|chest/)) return "push";
    return "";
  },

  _primary(name) {
    const m = this.musclesFor(name) || {};
    return Object.keys(m).find(k => m[k] >= 1) || null;
  },

  // Livello di `cand` come sostituto di `name`:
  //  "A" = stesso muscolo primario E stesso pattern (ottimo sostituto)
  //  "B" = stesso muscolo primario, pattern diverso (sostituto parziale)
  //  null = non è un sostituto
  subLevel(name, cand) {
    if (!name || !cand || name === cand) return null;
    const pa = this._primary(name), pb = this._primary(cand);
    if (!pa || !pb || pa !== pb) return null;
    const ma = this.pattern(name), mb = this.pattern(cand);
    return (ma && ma === mb) ? "A" : "B";
  },

  // Miglior sostituto tra gli esercizi già noti all'utente: preferisce il Livello A.
  bestSubstitute(name, candidates) {
    let a = null, b = null;
    (candidates || []).forEach(c => {
      const lvl = this.subLevel(name, c);
      if (lvl === "A" && !a) a = c;
      else if (lvl === "B" && !b) b = c;
    });
    return a ? { name: a, level: "A" } : (b ? { name: b, level: "B" } : null);
  },

  // Sostituto ARTICOLAZIONE-FRIENDLY — criterio OPPOSTO a bestSubstitute.
  // bestSubstitute cerca il più SIMILE (Livello A = stesso muscolo E stesso
  // pattern): giusto quando la macchina è occupata, ma SBAGLIATO per un dolore
  // articolare — stesso pattern = stesso stress sulla stessa articolazione.
  // Qui invece: stesso muscolo primario (l'allenamento non si perde) ma pattern
  // DIVERSO, e a parità preferiamo l'attrezzo guidato (macchina/cavo:
  // traiettoria vincolata, meno lavoro di stabilizzazione sull'articolazione
  // dolente) rispetto a bilanciere/manubri liberi.
  // Traiettoria guidata (macchina/cavo): il carico è vincolato, l'articolazione
  // lavora meno in stabilizzazione. Include i push-down/pulley: sugli ISOLAMENTI
  // l'attrezzo è la variabile che conta (due isolamenti hanno sempre lo stesso
  // "pattern", quindi il pattern da solo non distinguerebbe nulla).
  GUIDED_RE: /macchinar|machine|cavo|cable|pulley|push.?down|smith|pressa|chest press|pec deck|leg ext|leg curl|lat machine|selettor/i,
  FREE_RE: /bilancier|barbell|manubri|dumbbell|corpo libero|bodyweight/i,
  // Movimenti notoriamente esigenti per un'articolazione specifica: skull
  // crusher/french press (gomito), dietro-nuca e tirate al mento (spalla),
  // stacco/good morning (zona lombare). Non sono "cattivi" in assoluto — ma se
  // proprio quell'esercizio ti fa male da 3 sedute, non è lui il rimedio.
  HARSH_RE: /skull|french press|dietro la nuca|behind neck|upright row|tirate al mento|stacco|deadlift|good morning/i,

  // Quanto un esercizio "chiede" all'articolazione (più alto = più esigente).
  _jointStress(name) {
    let s = 0;
    if (this.GUIDED_RE.test(name)) s -= 2;
    if (this.FREE_RE.test(name))   s += 1;
    if (this.HARSH_RE.test(name))  s += 2;
    return s;
  },

  jointFriendlySubstitute(name, candidates) {
    // I candidati possono arrivare come stringa (legacy) O come oggetto
    // {nome,...} (schede da Notion): normalizza sempre, come fa _subFor.
    const asName = it => (typeof it === "string") ? it : (it && (it.nome || it.name)) || "";
    name = asName(name);
    const pa = this._primary(name);
    if (!pa) return null;
    const patA = this.pattern(name);
    const stressA = this._jointStress(name);
    let best = null, bestScore = 0;   // 0 = soglia: deve essere STRETTAMENTE più gentile
    (candidates || []).map(asName).forEach(c => {
      if (!c || c === name) return;
      if (this._primary(c) !== pa) return;              // deve allenare lo stesso muscolo
      const patC = this.pattern(c);
      let score = 0;
      if (patC && patA && patC !== patA) score += 3;    // movimento diverso = stress diverso
      score += (stressA - this._jointStress(c));        // quanto è più gentile del corrente
      if (score > bestScore) { bestScore = score; best = c; }
    });
    // Nessun candidato strettamente più gentile → null, e lo diciamo onestamente
    // all'utente invece di proporgli lo stesso problema con un altro nome.
    return best ? { name: best, score: bestScore } : null;
  },

  _overrides: null,
  // Chiave normalizzata: gli override del muscolo erano agganciati al nome
  // ESATTO, quindi uno spazio finale, una rinomina o uno spelling diverso tra
  // schede li orfanava (l'assegnazione "non si salvava"/"non si rifletteva").
  // Normalizzando (trim + spazi interni singoli) la scelta manuale combacia
  // col nome dell'esercizio ovunque venga usato (volume previsto E fatto).
  _normKey(name) { return String(name == null ? "" : name).trim().replace(/\s+/g, " "); },
  loadOverrides() {
    if (!this._overrides) {
      let raw;
      try { raw = JSON.parse(localStorage.getItem("gymos_muscle_map") || "{}"); } catch(e) { raw = {}; }
      // Migrazione una-tantum: ri-chiava con la forma normalizzata così i
      // vecchi override con spazi tornano a combaciare. In caso di collisione
      // vince l'ultimo scritto.
      const norm = {}; let changed = false;
      Object.keys(raw).forEach(k => { const nk = this._normKey(k); if (nk !== k) changed = true; if (nk) norm[nk] = raw[k]; });
      this._overrides = norm;
      if (changed) this.saveOverrides();
    }
    return this._overrides;
  },
  saveOverrides() { try { localStorage.setItem("gymos_muscle_map", JSON.stringify(this._overrides || {})); } catch(e){} },
  musclesFor(name) {
    const ov = this.loadOverrides()[this._normKey(name)];
    if (ov) { const m = { [ov.p]: 1 }; (ov.s || []).forEach(x => { if (x !== ov.p) m[x] = 0.5; }); return m; }
    return this.classify(name);
  },
  setPrimary(name, muscle) {
    const ov = this.loadOverrides();
    const key = this._normKey(name);
    if (!muscle || muscle === "—") { delete ov[key]; }   // torna all'automatico
    else {
      const auto = this.classify(name);
      const sec = Object.keys(auto).filter(m => auto[m] < 1 && m !== muscle);
      ov[key] = { p: muscle, s: sec };
    }
    this.saveOverrides();
    this.renderCard();
    this.renderEditor();
  },

  // Volume settimanale pianificato dal programma attivo (ogni seduta 1×/settimana).
  // Separa DIRETTO (muscolo primario, 1 serie) da INDIRETTO (secondario, ½ serie).
  compute() {
    const vol = {}, dir = {}, ind = {};
    this.MUSCLES.forEach(m => { vol[m] = 0; dir[m] = 0; ind[m] = 0; });
    const exList = [];
    Object.values(CONFIG.SCHEDE || {}).forEach(sc => {
      (sc.exercises || []).forEach(it => {
        const name = U.exName(it), sets = U.exSets(it);
        if (!name) return;
        exList.push(name);
        const m = this.musclesFor(name);
        Object.keys(m).forEach(mus => {
          if (vol[mus] == null) { vol[mus] = 0; dir[mus] = 0; ind[mus] = 0; }
          vol[mus] += sets * m[mus];
          if (m[mus] >= 1) dir[mus] += sets; else ind[mus] += sets * m[mus];
        });
      });
    });
    return { vol, dir, ind, exercises: [...new Set(exList)] };
  },

  zone(v) { return v === 0 ? "none" : v < this.MEV ? "low" : v <= this.MAV_HI ? "ok" : "high"; },

  // ═══ MRV — MASSIMO VOLUME RECUPERABILE (serie DIRETTE/settimana) ═══════════
  // Stime dalla letteratura RP (Israetel): variano molto per muscolo — i
  // piccoli/recuperanti (spalle, bicipiti) tollerano più serie dei grandi e
  // sistemici (quadricipiti, glutei). Sono STIME di popolazione, non verità
  // sul singolo: servono da tetto di sicurezza, non da obiettivo da inseguire.
  // Il feedback reale di recupero (Recovery) vale più di questa tabella.
  MRV: { Petto:22, Dorso:25, Spalle:26, Bicipiti:26, Tricipiti:24, Quadricipiti:20,
         Femorali:20, Glutei:16, Polpacci:25, Adduttori:16, Addome:25, Avambracci:20 },
  mrvFor(m) { return this.MRV[m] || 22; },

  // ═══ QUANTO SEI GIÀ VICINO AL TETTO — non solo "ci sei arrivato" ══════════
  // Prima il ramo "early" guardava SOLO se cur>=mrv (tutto o niente): un
  // muscolo a 21/22 prendeva +1 con lo stesso entusiasmo di uno a 12/22.
  // Sbagliato per due motivi già presenti nella scienza già raccolta in
  // quest'app (vedi memoria "gymos-pt-scientifico" punto 2, Schoenfeld
  // meta-analisi): il guadagno marginale per serie AGGIUNTIVA si riduce
  // avvicinandosi al MRV (dose-risposta non lineare, +0,37%/serie in media ma
  // la differenza alto-vs-basso volume è solo 3,9% totale) — quindi vale
  // sempre meno rischiare di sforare il recupero per l'ultima serie.
  // Frazione di quanto hai già "consumato" del margine MEV→MRV.
  _volumeProgress(cur, mev, mrv) {
    if (mrv <= mev) return 1;
    return Math.max(0, Math.min(1, (cur - mev) / (mrv - mev)));
  },
  // Sopra questa frazione, il motore non consiglia più +1 di default: ti dice
  // di consolidare (stesso tone="ok" del ramo "già al tetto", nessun allarme).
  PROXIMITY_HOLD: 0.75,
  // In fase di CUT la soglia è più bassa: lo stesso principio RED-S già usato
  // altrove in quest'app (Body._energyFlag, consensus IOC) — in deficit
  // calorico la capacità di recupero e la vera crescita muscolare sono ridotte,
  // quindi il margine "sicuro" per continuare a salire di volume si restringe.
  // Non è "mai aumentare in cut": è aumentare con più margine di sicurezza.
  PROXIMITY_HOLD_CUT: 0.5,

  // ═══ VOLUME DINAMICO (FASE 2.1) ═══════════════════════════════════════════
  // Retroazione sul volume della PROSSIMA settimana, dal recupero reale +
  // andamento della forza. Regole (RP/Israetel), con i limiti MEV..MRV come
  // guardrail: sotto MEV non si scende (perderesti stimolo), sopra MRV non si
  // sale (non lo recupereresti).
  //   indolenzimento sparito PRESTO  + forza ok   -> +1 serie
  //   sparito APPENA IN TEMPO                     -> invariato
  //   ANCORA indolenzito  OPPURE forza in calo    -> -1 serie (scarico se grave)
  // Restituisce SEMPRE un consiglio motivato: non tocca la scheda da solo.
  // `sleepBad`: sonno di stanotte rosso (HRV<45 o <6h — stessa soglia di
  // Dashboard.buildSemaforo). Non rende PIÙ caute le regole già caute
  // (still/scarico), ma frena la salita quando il segnale sarebbe "vai su":
  // una notte storta rende il "recupero completo" di oggi meno affidabile
  // come base per aggiungere carico, non un motivo per allarmarsi da solo.
  //
  // `phase`: fase corporea attuale ("Cut"/"Bulk"/"Mant.", dall'ultimo check-in
  // Misurazioni) — SOLO per abbassare la soglia di prossimità al MRV oltre cui
  // il motore consolida invece di salire (RED-S, vedi PROXIMITY_HOLD_CUT).
  // `diaryFatigue`: true se il diario di oggi o le note delle sedute recenti
  // parlano di stanchezza/spossatezza — segnale scritto dall'utente stesso,
  // più fresco e specifico di un DOMS dichiarato a inizio serie. Come
  // sleepBad, frena SOLO la salita: non rende più severi i rami già cauti.
  //
  // Nessuno dei due nuovi input tocca i rami still/perfDropped/just: sono già
  // le regole più caute, non c'è bisogno di renderle ANCORA più severe.
  nextVolume(muscle, currentDirect, domsState, perfDropped, sleepBad, phase, diaryFatigue) {
    const mev = this.MEV, mrv = this.mrvFor(muscle);
    const cur = Math.max(0, Number(currentDirect) || 0);
    const clamp = v => Math.max(mev, Math.min(mrv, v));
    if (!domsState) return null;                    // nessun feedback: nessun consiglio inventato
    // Il delta è SEMPRE derivato dal target, mai dichiarato a parte: se un
    // guardrail (MEV/MRV) blocca il movimento, il consiglio non deve continuare
    // a dire "-1 serie" mentre il volume resta identico.
    const out = (target, tone, why, deload) => {
      const t = Math.round(target);
      return { delta: t - cur, target: t, tone, why, deload: !!deload };
    };
    if (domsState === "still" && perfDropped) {
      // Due segnali negativi convergenti: non è volume da limare, è scarico.
      return out(Math.max(mev, cur * 0.6), "bad",
        "sei ancora indolenzito E la forza è calata: due segnali insieme. Meglio una settimana di scarico che insistere.", true);
    }
    if (domsState === "still") {
      return out(clamp(cur - 1), "bad",
        cur <= mev
          ? "arrivi ancora indolenzito, ma sei già al minimo utile: non è il volume il problema — guarda sonno, cibo e stress."
          : "arrivi ancora indolenzito: stai accumulando più di quanto recuperi.");
    }
    if (perfDropped) {
      return out(clamp(cur - 1), "bad",
        "il recupero c'è ma la forza è calata: alleggerisci un po' il volume.");
    }
    if (domsState === "just") {
      return out(clamp(cur), "ok",
        "l'indolenzimento è passato giusto in tempo: sei nel punto giusto, tieni questo volume.");
    }
    // "early": recuperato con margine e forza ok -> c'è spazio per crescere,
    // MA solo se nessun altro segnale (oggi, o strutturale) consiglia cautela.
    if (cur >= mrv) {
      return out(mrv, "ok",
        `recuperi bene, ma sei già al tetto stimato per questo muscolo (~${mrv} serie): meglio non salire ancora.`);
    }
    if (diaryFatigue) {
      return out(clamp(cur), "ok",
        "nel diario o nelle note recenti hai scritto di sentirti stanco: il muscolo sembra recuperato, ma aspetta che passi prima di salire di volume.");
    }
    if (sleepBad) {
      return out(clamp(cur), "ok",
        "il muscolo sembra recuperato, ma hai dormito poco stanotte: aspetta un'altra seduta con sonno migliore prima di salire, per non confondere un OK di oggi con un OK stabile.");
    }
    // Prossimità al MRV: più sei vicino al tetto, meno vale la pena rischiare
    // il recupero per l'ultima serie (guadagno marginale in calo, Schoenfeld —
    // vedi commento su PROXIMITY_HOLD). In Cut la soglia è più bassa (RED-S).
    const progress = this._volumeProgress(cur, mev, mrv);
    const isCut = /cut/i.test(phase || "");
    const holdAt = isCut ? this.PROXIMITY_HOLD_CUT : this.PROXIMITY_HOLD;
    if (progress >= holdAt) {
      return out(clamp(cur), "ok", isCut
        ? `sei già a ${cur}/${mrv} serie e in fase di cut: con un deficit calorico il margine di crescita è ridotto, meglio consolidare qui che salire ancora.`
        : `sei già a ${cur}/${mrv} serie, vicino al tetto stimato: il guadagno per serie aggiuntiva cala avvicinandosi al massimo, consolidare qui ha più senso che continuare a salire.`);
    }
    return out(clamp(cur + 1), "up",
      "recuperi con margine e la forza tiene: c'è spazio per una serie in più.");
  },

  // #batch2 raffinamento 4 — tetto di serie DIRETTE per SINGOLA seduta (non
  // solo il totale settimanale già coperto da MEV/MAV_HI): oltre questa soglia
  // il beneficio marginale in UNA sessione crolla (Nippard/Krieger meta-review,
  // Israetel — convergenza multipla). Dorso/Quadricipiti/Femorali/Glutei
  // tollerano di più per seduta.
  SESSION_SET_CEILING: 8,
  SESSION_SET_CEILING_HIGH: 12,
  _HIGH_TOLERANCE: ["Dorso", "Quadricipiti", "Femorali", "Glutei"],
  sedutaDirectSets(sc) {
    const dir = {};
    (sc.exercises || []).forEach(it => {
      const name = U.exName(it), sets = U.exSets(it);
      if (!name) return;
      const m = this.musclesFor(name);
      Object.keys(m).forEach(mus => { if (m[mus] >= 1) dir[mus] = (dir[mus] || 0) + sets; });
    });
    return dir;
  },
  sedutaOverCeiling(sc) {
    const dir = this.sedutaDirectSets(sc);
    return Object.keys(dir).filter(mus => dir[mus] > (this._HIGH_TOLERANCE.includes(mus) ? this.SESSION_SET_CEILING_HIGH : this.SESSION_SET_CEILING));
  },

  // Inizio settimana corrente (lunedì 00:00), coerente con lo split settimanale
  _weekStart() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));
    return monday;
  },

  // Serie realmente completate questa settimana (dalle sessioni fatte), per muscolo
  async loadActual(sessions) {
    const token = (this._actualToken = (this._actualToken || 0) + 1);
    const monday = this._weekStart();
    const wk = (sessions || []).filter(s => s.date && new Date(s.date) >= monday);
    const actual = {}, aDir = {}, aInd = {};
    this.MUSCLES.forEach(m => { actual[m] = 0; aDir[m] = 0; aInd[m] = 0; });
    let contributed = 0;
    for (const s of wk) {
      try {
        const ex = await API.getSessionExercises(s.id);
        if (token !== this._actualToken) return;   // dashboard ricaricata: abbandona
        let any = false;
        ex.forEach(row => {
          if ((row.reps || 0) <= 0) return;
          any = true;
          const name = U.exBase(row.name);
          const m = this.musclesFor(name);
          Object.keys(m).forEach(mus => {
            if (actual[mus] == null) { actual[mus] = 0; aDir[mus] = 0; aInd[mus] = 0; }
            actual[mus] += m[mus];
            if (m[mus] >= 1) aDir[mus] += 1; else aInd[mus] += m[mus];
          });
        });
        if (any) contributed++;
      } catch(e) { /* ignora la singola sessione non leggibile */ }
    }
    this._actual = actual;
    this._actualDir = aDir; this._actualInd = aInd;
    this._actualCount = contributed;   // solo sessioni con almeno una serie fatta
    this.renderCard();
    // La mappa di recupero legge il volume DIRETTO reale: si aggiorna qui,
    // appena il "fatto" della settimana è disponibile.
    try { if (typeof Recovery !== "undefined") Recovery.renderCard(); } catch (e) {}
    const modal = document.getElementById("vol-modal");
    if (modal && modal.style.display === "flex") this.renderEditor();
  },

  // Barra: zona target 10–20 + riempimento (fatto se disponibile, altrimenti
  // pianificato) + marcatore del volume pianificato dal programma.
  barHTML(planned, actual) {
    const max = this.MAV_HI + 6;
    const p = x => Math.min(100, (x / max) * 100);
    const mevPct = (this.MEV / max) * 100, mavPct = (this.MAV_HI / max) * 100;
    const fillVal = actual != null ? actual : planned;
    const mark = actual != null ? `<div class="vol-plan-mark" style="left:${Math.min(99, p(planned))}%" title="Previste dal programma"></div>` : "";
    return `<div class="vol-bar"><div class="vol-zone" style="left:${mevPct}%;width:${mavPct - mevPct}%"></div><div class="vol-fill vz-${this.zone(fillVal)}" style="width:${p(fillVal)}%"></div>${mark}</div>`;
  },
  // Punto, non virgola: stesso stile di U.fmt (kg/e1RM/rep) usato ovunque
  // nell'app — la card volume mostrava "10,5" serie accanto a "142.5" kg,
  // due convenzioni decimali diverse per lo stesso tipo di numero.
  fmt(v) { return Number.isInteger(v) ? v : v.toFixed(1); },

  // Una riga muscolo: mostra "fatto / previsto" se il fatto è disponibile.
  // Con split={dir,ind} aggiunge la scomposizione diretto/indiretto (½) sotto.
  _muscleRow(m, planned, split) {
    const a = this._actual ? (this._actual[m] || 0) : null;
    const shown = a != null ? a : planned;
    let detail = "";
    if (split) {
      detail = a != null
        ? `<div class="vol-split">diretto <b>${this.fmt(this._actualDir[m] || 0)}</b>/${this.fmt(split.dir)} · indiretto <b>${this.fmt(this._actualInd[m] || 0)}</b>/${this.fmt(split.ind)} <span class="vol-frac">(½)</span></div>`
        : `<div class="vol-split">diretto <b>${this.fmt(split.dir)}</b> · indiretto <b>${this.fmt(split.ind)}</b> <span class="vol-frac">(½)</span></div>`;
    }
    return `
      <div class="vol-rowwrap">
        <div class="vol-row">
          <span class="vol-name">${m}</span>
          ${this.barHTML(planned, a)}
          <span class="vol-val vz-${this.zone(shown)}">${this.fmt(shown)}${a != null ? `<span class="vol-plan">/${this.fmt(planned)}</span>` : ""}</span>
        </div>
        ${detail}
      </div>`;
  },

  renderCard() {
    const wrap = document.getElementById("dash-volume");
    if (!wrap) return;
    const prog = App.activeProgram || "—";
    const { vol } = this.compute();
    const rows = this.MUSCLES.filter(m => vol[m] > 0).sort((a, b) => vol[b] - vol[a]);
    if (!rows.length) {
      wrap.innerHTML = `<div class="card-title"><i class="ti ti-chart-bar"></i>Volume settimanale</div><div class="empty-state">Nessun esercizio nel programma attivo.</div>`;
      return;
    }
    const low = rows.filter(m => vol[m] < this.MEV).length;
    const hasA = !!this._actual;
    const foot = hasA
      ? `<b>Fatte</b> / previste a settimana · zona verde <b>10–20</b>`
      : `Serie allenanti / settimana · target <b>10–20</b>${low ? ` · <span class="vz-low">${low} sotto target</span>` : ""}`;
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-chart-bar"></i>Volume settimanale
        <span class="vol-prog">${this._esc(prog)}</span>
        <button class="vol-edit-btn" onclick="Volume.openEditor()"><i class="ti ti-adjustments"></i> Dettaglio</button>
      </div>
      <div class="vol-list">
        ${rows.slice(0, 6).map(m => this._muscleRow(m, vol[m])).join("")}
      </div>
      <div class="vol-foot">${foot} <button class="vol-more" onclick="Volume.openEditor()">vedi tutti →</button></div>`;
  },

  openEditor() { this._openSeds = new Set(); document.getElementById("vol-modal").style.display = "flex"; this.renderEditor(); },
  closeEditor(ev) { if (ev && ev.target !== ev.currentTarget) return; document.getElementById("vol-modal").style.display = "none"; },

  renderEditor() {
    const body = document.getElementById("vol-modal-body");
    if (!body) return;
    const { vol, dir, ind, exercises } = this.compute();
    const total = Object.values(vol).reduce((a, b) => a + b, 0);
    const totalA = this._actual ? Object.values(this._actual).reduce((a, b) => a + b, 0) : null;
    const bars = this.MUSCLES.map(m => this._muscleRow(m, vol[m], { dir: dir[m], ind: ind[m] })).join("");
    // Esercizi raggruppati per SEDUTA del programma attivo, in tendine
    const sedute = Object.entries(CONFIG.SCHEDE || {}).map(([nome, sc]) => {
      const exs = (sc.exercises || []).map(it => U.exName(it)).filter(Boolean);
      const toFix = exs.filter(e => Object.keys(this.musclesFor(e)).length === 0).length;
      const overCeiling = this.sedutaOverCeiling(sc);
      const isOpen = this._openSeds && this._openSeds.has(nome);
      return `
        <div class="vol-sed${isOpen ? " open" : ""}" data-sed="${String(nome).replace(/"/g, "&quot;")}">
          <button class="vol-sed-hd" onclick="Volume.toggleSed(this)" style="border-left:3px solid ${sc.color || "var(--accent)"}">
            <span class="vol-sed-name">${this._esc(nome)}</span>
            <span class="vol-sed-count">${exs.length} eserc.${toFix ? ` · <span class="vz-low">${toFix} da assegnare</span>` : ""}${overCeiling.length ? ` · <span class="vz-high">tante serie: ${overCeiling.join(", ")}</span>` : ""}</span>
            <i class="ti ti-chevron-down vol-sed-chev"></i>
          </button>
          <div class="vol-sed-body">${exs.map(e => this._exRow(e)).join("")}</div>
        </div>`;
    }).join("");
    body.innerHTML = `
      <div class="vol-total">${totalA != null
        ? `Questa settimana: <b>${this.fmt(totalA)}</b> fatte su <b>${this.fmt(total)}</b> previste${this._actualCount ? ` · ${this._actualCount} ${this._actualCount === 1 ? "sessione" : "sessioni"}` : ""}`
        : `Totale: <b>${this.fmt(total)}</b> serie allenanti / settimana`}</div>
      <div class="vol-legend"><span><i class="vz-low">■</i> sotto 10</span><span><i class="vz-ok">■</i> 10–20 ottimale</span><span><i class="vz-high">■</i> oltre 20</span>${totalA != null ? `<span><i class="vol-mark-legend"></i> previste dal programma</span>` : ""}</div>
      <div class="vol-note"><i class="ti ti-info-circle"></i> Ogni totale somma le serie <b>dirette</b> (muscolo primario, 1) e <b>indirette</b> (secondario, ½). La riga sotto ogni muscolo le mostra separate.</div>
      <div class="vol-list vol-list-full">${bars}</div>
      <div class="vol-sec-title"><i class="ti ti-body-scan"></i> Muscolo di ogni esercizio</div>
      <div class="vol-hint">Apri una seduta del programma e correggi il muscolo dove l'automatico sbaglia. Primario = 1 serie, secondari = ½. "Tante serie" avvisa quando in UNA seduta un muscolo supera ${this.SESSION_SET_CEILING} serie dirette (${this.SESSION_SET_CEILING_HIGH} per dorso/gambe/glutei): oltre, il beneficio in quella sessione cala.</div>
      <div class="vol-sed-list">${sedute}</div>`;
  },

  _openSeds: null,
  toggleSed(btn) {
    const wrap = btn.parentElement;
    if (!this._openSeds) this._openSeds = new Set();
    if (wrap.classList.toggle("open")) this._openSeds.add(wrap.dataset.sed);
    else this._openSeds.delete(wrap.dataset.sed);
  },

  // Riga singolo esercizio con selettore muscolo primario
  _exRow(ex) {
    const m = this.musclesFor(ex);
    const primary = Object.keys(m).find(k => m[k] >= 1) || "—";
    const sec = Object.keys(m).filter(k => m[k] < 1);
    const isAuto = !this.loadOverrides()[this._normKey(ex)];
    const info = [];
    if (sec.length) info.push("+ " + sec.join(", ") + " (½)");
    if (primary === "—") info.push("da assegnare");
    else if (isAuto) info.push("auto");
    const exAttr = ex;
    const opts = ["—", ...this.MUSCLES];
    return `
      <div class="vol-ex">
        <div class="vol-ex-main">
          <span class="vol-ex-name">${this._esc(ex)}</span>
          <span class="vol-ex-sec">${info.join(" · ")}</span>
        </div>
        <select class="vol-ex-sel" onchange="Volume.setPrimary(${U.arg(exAttr)}, this.value)">
          ${opts.map(o => `<option value="${o}"${o === primary ? " selected" : ""}>${o === "—" ? "Automatico" : o}</option>`).join("")}
        </select>
      </div>`;
  },

  _esc(s) { return U.escape(s); },
};

// ═══════════════════════════════════════════════
//  GymOS — Foto progressi (fisico/estetica)
//  Salvate SOLO sul dispositivo (IndexedDB), private, offline. Pose fronte/
//  lato/schiena, galleria per data, confronto prima/dopo. Immagini ridotte a
//  max 1280px per risparmiare spazio.
// ═══════════════════════════════════════════════
