const PatternBalance = {
  // Coppie di pattern OPPOSTI da controllare, con la spiegazione se manca il
  // "lato B" e cosa suggerire. missingMsg/lowMsg sono la parte centrale della
  // riga fissa: "[Esercizio] → [missingMsg] → [suggerimento]".
  PAIRS: [
    { a: "push", b: "pull",
      missing: "manca lavoro di tirata", low: "poco lavoro di tirata rispetto alla spinta",
      suggestion: "aggiungi un rematore" },
    { a: "squat", b: "hinge",
      missing: "manca lavoro di catena posteriore", low: "poco lavoro di catena posteriore rispetto allo squat",
      suggestion: "aggiungi uno stacco rumeno" },
  ],
  // Soglia "poco" (non assente): il lato B esiste ma è sotto questa frazione
  // del lato A. 0.5 = il lato scarso ha meno della metà delle serie dell'altro.
  LOW_RATIO: 0.5,

  _esc(s) { return U.escape(s); },

  // Serie DIRETTE per pattern, dagli esercizi della scheda ATTIVA (stessa fonte
  // di Volume.compute(): CONFIG.SCHEDE). Ogni esercizio conta per intero nel
  // SUO pattern (a differenza di Volume.classify, qui non c'è da frazionare
  // tra muscoli: un push è un push).
  _computeBySchedaPattern() {
    const byPattern = {};          // pattern -> serie totali
    const topExByPattern = {};     // pattern -> {nome, serie} con più serie (per la riga d'avviso)
    Object.values(CONFIG.SCHEDE || {}).forEach(sc => {
      (sc.exercises || []).forEach(it => {
        const name = U.exName(it), sets = U.exSets(it);
        if (!name) return;
        const pat = Volume.pattern(name);
        if (!pat) return;
        byPattern[pat] = (byPattern[pat] || 0) + sets;
        if (!topExByPattern[pat] || sets > topExByPattern[pat].sets) topExByPattern[pat] = { name, sets };
      });
    });
    return { byPattern, topExByPattern };
  },

  // Un avviso per coppia sbilanciata, o null se non ce n'è nessuno da mostrare.
  check() {
    const { byPattern, topExByPattern } = this._computeBySchedaPattern();
    const out = [];
    this.PAIRS.forEach(p => {
      const setsA = byPattern[p.a] || 0, setsB = byPattern[p.b] || 0;
      if (setsA <= 0) return;   // niente lato A in scheda: non c'è nulla da sbilanciare
      const exA = topExByPattern[p.a];
      if (!exA) return;
      if (setsB <= 0) {
        out.push({ exercise: exA.name, issue: p.missing, suggestion: p.suggestion, severity: "missing" });
      } else if (setsB < setsA * this.LOW_RATIO) {
        out.push({ exercise: exA.name, issue: p.low, suggestion: p.suggestion, severity: "low" });
      }
    });
    return out;
  },

  renderCard() {
    const wrap = document.getElementById("dash-patternbalance");
    if (!wrap || typeof Volume === "undefined" || typeof CONFIG === "undefined") return;
    const warnings = this.check();
    if (!warnings.length) { wrap.style.display = "none"; wrap.innerHTML = ""; return; }
    wrap.style.display = "";
    // Riga fissa, UNA riga, nessuna spiegazione: solo l'output finale come
    // richiesto — "[Esercizio] → [inconsistenza] → [suggerimento]".
    const rows = warnings.map(w =>
      `<div class="pb-row"><b>${this._esc(w.exercise)}</b> → ${this._esc(w.issue)} → ${this._esc(w.suggestion)}</div>`
    ).join("");
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-arrows-diff"></i>Equilibrio scheda</div>
      <div class="pb-list">${rows}</div>`;
  },
};

