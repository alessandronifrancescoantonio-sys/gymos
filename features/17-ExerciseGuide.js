const ExerciseGuide = {
  BASE: "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main",
  _idx: null,

  _load() {
    if (!this._idx) this._idx = (typeof EXERCISE_GUIDE_IDX !== "undefined") ? EXERCISE_GUIDE_IDX : [];
    return this._idx;
  },
  _norm(s) { return String(s == null ? "" : s).toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " "); },
  _esc(s) { return U.escape(s); },

  // Match esatto prima (alta confidenza); altrimenti "contenuto per intero"
  // in entrambe le direzioni, solo se la query ha almeno 5 caratteri (sotto
  // quella soglia il rischio di falsi positivi è troppo alto).
  find(name) {
    const idx = this._load();
    const q = this._norm(name);
    if (!q || q.length < 3) return [];
    const exact = idx.filter(e => this._norm(e.n) === q);
    if (exact.length) return exact;
    if (q.length < 5) return [];
    return idx.filter(e => { const en = this._norm(e.n); return en.includes(q) || q.includes(en); });
  },

  async open(exName) {
    const candidates = this.find(exName);
    const overlay = this._ensureOverlay();
    if (!candidates.length) {
      overlay.innerHTML = this._shell(`<div class="eg-empty"><i class="ti ti-search-off"></i> «${this._esc(exName)}» non trovato nel database (873 esercizi, in inglese).</div>`);
      overlay.style.display = "flex";
      return;
    }
    if (candidates.length === 1) { await this._showDetail(candidates[0]); return; }
    // Ambiguo: MAI scegliere da solo, mostra sempre il selettore.
    overlay.innerHTML = this._shell(`
      <div class="eg-pick-lbl">${candidates.length} varianti trovate — quale intendevi?</div>
      <div class="eg-pick-list">${candidates.slice(0, 14).map(c =>
        `<button class="eg-pick-item" onclick="ExerciseGuide._showDetailById(${U.arg(c.id)})">${this._esc(c.n)}${c.m ? `<span>${this._esc(c.m)}</span>` : ""}</button>`).join("")}</div>`);
    overlay.style.display = "flex";
  },

  async _showDetailById(id) {
    const c = this._load().find(e => e.id === id);
    if (c) await this._showDetail(c);
  },

  async _showDetail(cand) {
    const overlay = this._ensureOverlay();
    overlay.innerHTML = this._shell(`<div class="eg-loading"><i class="ti ti-loader-2"></i> Carico la guida…</div>`);
    overlay.style.display = "flex";
    try {
      // Timeout 10s: su rete lenta lo spinner restava appeso per minuti
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${this.BASE}/exercises/${cand.id}.json`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error("fetch fallita");
      const d = await res.json();
      const img = (d.images && d.images[0]) ? `${this.BASE}/exercises/${d.images[0]}` : null;
      const steps = (d.instructions || []).map(s => `<li>${this._esc(s)}</li>`).join("");
      overlay.innerHTML = this._shell(`
        <div class="eg-title">${this._esc(d.name)}</div>
        ${cand.m ? `<div class="eg-muscle">${this._esc(cand.m)}</div>` : ""}
        ${img ? `<img class="eg-img" src="${img}" alt="" loading="lazy">` : ""}
        <ol class="eg-steps">${steps || "<li>Nessuna istruzione disponibile.</li>"}</ol>
        <div class="eg-src">Istruzioni originali in inglese · fonte: free-exercise-db (pubblico dominio)</div>`);
    } catch (e) {
      overlay.innerHTML = this._shell(`<div class="eg-empty"><i class="ti ti-wifi-off"></i> Non sono riuscito a caricare la guida: serve connessione.</div>`);
    }
  },

  _ensureOverlay() {
    let el = document.getElementById("eg-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "eg-overlay";
      el.className = "eg-overlay";
      el.onclick = e => { if (e.target === el) this.close(); };
      document.body.appendChild(el);
    }
    return el;
  },
  _shell(inner) {
    return `<div class="eg-box" onclick="event.stopPropagation()">
      <button class="eg-close" onclick="ExerciseGuide.close()"><i class="ti ti-x"></i></button>
      ${inner}
    </div>`;
  },
  close() { const el = document.getElementById("eg-overlay"); if (el) el.style.display = "none"; },
};

// ═══════════════════════════════════════════════
//  GymOS — "Chiedi al coach" (Q&A scienza-based, ricerca Google reale via
//  Gemini grounding). Feature SEPARATA dal consiglio veloce per-serie:
//  qui l'attesa (10-20s) è accettabile — la chiede l'utente, non blocca
//  l'allenamento. Errori mostrati esplicitamente (non silenziosi come il
//  consiglio automatico): l'utente ha chiesto attivamente, deve saperlo.
//  Modale riusabile da OVUNQUE (Home E Sessione, mentre ti alleni) —
//  stesso pattern di ExerciseGuide (overlay creato al volo, niente HTML
//  statico duplicato per contesto).
// ═══════════════════════════════════════════════
