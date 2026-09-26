const ScienceUpdates = {
  proposals: [],
  errorMsg: null,

  _esc(s) { return U.escape(s); },

  // Timeout come tutte le altre fetch verso i worker (vedi API.call in
  // api.js) — senza AbortController una rete che cade a metà lascia la
  // sezione bloccata su "caricamento" per sempre, niente feedback.
  async _fetchWithTimeout(url, opts, ms = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await AIClient.fetch(url, { ...(opts || {}), signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  },

  async load() {
    const wrap = document.getElementById("sci-list");
    if (!wrap) return;
    this.errorMsg = null;
    try {
      const res = await this._fetchWithTimeout(`${CONFIG.AI_WORKER_URL}/science-proposals`);
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j && j.error ? j.error : ""; } catch (e) {}
        throw new Error(detail || `Errore ${res.status}`);
      }
      const j = await res.json();
      this.proposals = Array.isArray(j.proposals) ? j.proposals : [];
      this.render();
    } catch (e) {
      console.error("ScienceUpdates.load:", e);
      this.errorMsg = String(e && e.message || e);
      this.render();
    }
  },

  render() {
    const wrap = document.getElementById("sci-list");
    if (!wrap) return;
    if (this.errorMsg) {
      wrap.innerHTML = `<div class="empty-state sci-error"><i class="ti ti-plug-connected-x"></i><span class="es-title">Aggiornamenti non disponibili</span><span class="es-sub">${this._esc(this.errorMsg)}</span></div>`;
      return;
    }
    const pending = this.proposals.filter(p => p.status === "pending");
    const decided = this.proposals.filter(p => p.status !== "pending")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    let html = "";
    if (pending.length) {
      html += `<div class="sci-sub">Da decidere</div>`;
      html += pending.map(p => this._cardHTML(p, true)).join("");
    } else {
      html += `<div class="empty-state"><i class="ti ti-flask"></i><span class="es-title">Nessuna proposta in attesa</span><span class="es-sub">La pipeline gira una volta al mese, a rotazione tra le aree scientifiche coperte da GymOS.</span></div>`;
    }
    if (decided.length) {
      html += `<div class="sci-sub" style="margin-top:16px">Storico decisioni</div>`;
      html += decided.map(p => this._cardHTML(p, false)).join("");
    }
    wrap.innerHTML = html;
  },

  _verdictLabel(v) { return v === "conferma" ? "Conferma" : v === "contraddice" ? "Contraddice" : "Area nuova"; },
  _strengthLabel(s) { return s === "alta" ? "Alta" : s === "media" ? "Media" : "Bassa"; },

  _cardHTML(p, actionable) {
    const statusClass = p.status === "approved" ? "sci-approved" : p.status === "rejected" ? "sci-rejected" : "";
    const fonteHTML = p.source
      ? (p.sourceUrl
          ? `<a href="${U.url(p.sourceUrl)}" target="_blank" rel="noopener">${this._esc(p.source)}</a>${p.year ? ` (${this._esc(p.year)})` : ""}`
          : `${this._esc(p.source)}${p.year ? ` (${this._esc(p.year)})` : ""}`)
      : "Fonte non specificata";
    const actions = actionable
      ? `<div class="sci-actions">
          <button class="btn-secondary sci-btn-reject" onclick="ScienceUpdates.decide(${U.arg(p.id)}, false)"><i class="ti ti-x"></i>Rifiuta</button>
          <button class="btn-primary sci-btn-approve" onclick="ScienceUpdates.decide(${U.arg(p.id)}, true)"><i class="ti ti-check"></i>Approva</button>
        </div>`
      : `<div class="sci-status-tag">${p.status === "approved" ? '<i class="ti ti-circle-check"></i>Approvata' : '<i class="ti ti-circle-x"></i>Rifiutata'}</div>`;
    return `
      <div class="sci-card ${statusClass}">
        <div class="sci-card-head">
          <span class="sci-area">${this._esc(p.areaLabel)}</span>
          <span class="sci-verdict sci-v-${this._esc(p.verdict)}">${this._verdictLabel(p.verdict)}</span>
          <span class="sci-strength sci-s-${this._esc(p.evidenceStrength)}">Evidenza ${this._strengthLabel(p.evidenceStrength)}</span>
        </div>
        <div class="sci-claim">${this._esc(p.claim)}</div>
        <div class="sci-fonte"><i class="ti ti-book"></i>${fonteHTML}</div>
        ${p.diffText ? `<div class="sci-diff"><i class="ti ti-arrow-right"></i>${this._esc(p.diffText)}</div>` : ""}
        ${actions}
      </div>`;
  },

  // Guardia anti doppio-tap (stesso pattern di PredictiveCoach.decide): i
  // bottoni Approva/Rifiuta restavano interattivi per tutto il round-trip
  // (fino a 15s di timeout) — due tap veloci su una rete lenta mandavano due
  // decide() concorrenti per la stessa proposta.
  busy: false,
  async decide(id, approved) {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await this._fetchWithTimeout(`${CONFIG.AI_WORKER_URL}/science-proposals/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, approved }),
      });
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j && j.error ? j.error : ""; } catch (e) {}
        throw new Error(detail || `Errore ${res.status}`);
      }
      if (typeof U !== "undefined" && U.toast) U.toast(approved ? "Proposta approvata" : "Proposta rifiutata", "ok");
      await this.load();
    } catch (e) {
      console.error("ScienceUpdates.decide:", e);
      if (typeof U !== "undefined" && U.toast) U.toast("Errore: " + (e && e.message || e), "err");
    } finally {
      this.busy = false;
    }
  },
};

// ═══════════════════════════════════════════════
//  GymOS — Coach predittivo di fine mesociclo
//  Una volta al mese analizza 8+ settimane di dati REALI dell'utente (non
//  letteratura esterna, quello è ScienceUpdates sopra) e propone UNA modifica
//  concreta alla scheda attiva. v1: SOLO "sostituisci_esercizio" — è l'unico
//  tipo di modifica che si può validare e applicare in modo univoco e sicuro
//  su Notion (un nome esatto trovato/sostituito in un array); aggiungere
//  serie o cambiare rep-range richiederebbe decidere DI QUANTO in modo
//  altrettanto sicuro, scope rimandato a v2 per restare conservativi su dati
//  reali dell'utente. Sta nella pagina Schede (non una pagina a parte): la
//  proposta agisce direttamente sulla scheda che l'utente sta già gestendo lì.
// ═══════════════════════════════════════════════
