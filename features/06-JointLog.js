const JointLog = {
  KEY: "gymos_joint_log",
  KEEP: "gymos_joint_keep",
  _load() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch (e) { return {}; } },
  _save(m) { try { localStorage.setItem(this.KEY, JSON.stringify(m)); } catch (e) {} },
  _keep() { try { return JSON.parse(localStorage.getItem(this.KEEP) || "{}"); } catch (e) { return {}; } },
  _esc(s) { return U.escape(s); },

  // Chiamato dalla sessione quando l'avviso scatta / l'utente decide.
  touch(exName, subName, date, action) {
    if (!exName) return;
    const m = this._load();
    const e = m[exName] || { first: date || null, action: null };
    e.last = date || e.last || null;
    if (subName) e.sub = subName;
    if (action) e.action = action;         // "sub" = sostituito · "keep" = tenuto
    m[exName] = e;
    this._save(m);
  },
  forget(exName) {
    const m = this._load(); delete m[exName]; this._save(m);
    const k = this._keep(); delete k[exName];
    try { localStorage.setItem(this.KEEP, JSON.stringify(k)); } catch (e) {}
    this.renderCard();
    try { U.toast(`"${exName}" dimenticato: se torna il fastidio, te lo ridico.`, "ok"); } catch (e) {}
  },
  entries() {
    const m = this._load();
    return Object.keys(m).map(k => ({ name: k, ...m[k] }))
      .sort((a, b) => String(b.last || "").localeCompare(String(a.last || "")));
  },

  renderCard() {
    const wrap = document.getElementById("dash-jointlog");
    if (!wrap) return;
    const list = this.entries();
    if (!list.length) { wrap.style.display = "none"; wrap.innerHTML = ""; return; }
    wrap.style.display = "";
    const fmtD = d => { try { return new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "short" }); } catch (e) { return d || "—"; } };
    const rows = list.map(e => {
      const arg = String(e.name);
      const stato = e.action === "sub"
        ? `<span class="jl-tag jl-sub"><i class="ti ti-refresh"></i>Sostituito con ${this._esc(e.sub || "—")}</span>`
        : e.action === "keep"
        ? `<span class="jl-tag jl-keep"><i class="ti ti-hand-stop"></i>Lo tieni comunque</span>`
        : `<span class="jl-tag jl-open"><i class="ti ti-alert-circle"></i>Nessuna scelta ancora</span>`;
      const alt = (e.sub && e.action !== "sub")
        ? `<div class="jl-alt">Alternativa proposta: <b>${this._esc(e.sub)}</b></div>` : "";
      return `
        <div class="jl-row">
          <div class="jl-head">
            <span class="jl-name">${this._esc(e.name)}</span>
            <button class="jl-forget" onclick="JointLog.forget(${U.arg(arg)})" title="Non mi dà più fastidio">
              <i class="ti ti-x"></i>
            </button>
          </div>
          <div class="jl-meta">Dolore ricorrente · rilevato ${fmtD(e.first)}${e.last && e.last !== e.first ? ` · ultimo ${fmtD(e.last)}` : ""}</div>
          ${stato}
          ${alt}
        </div>`;
    }).join("");
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-alert-hexagon"></i>Esercizi che ti danno fastidio</div>
      <div class="jl-list">${rows}</div>
      <div class="jl-foot">Rilevati dalle tue note: dolore da almeno 3 sedute di fila sullo stesso esercizio. Non è una diagnosi — se un dolore persiste, sentine un professionista.</div>`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  BILANCIAMENTO DEI PATTERN DI MOVIMENTO (scheda attiva)
//
//  Riusa SOLO la classificazione già esistente (Volume.pattern → push/pull/
//  squat/hinge/iso/core/calf, righe ~607-628) — nessuna ricerca nuova, nessun
//  classificatore nuovo. Principio di programmazione consolidato (non uno
//  studio specifico da citare): squilibrio spinta/tirata sulla parte alta è
//  associato a problemi di spalla/postura; squilibrio squat/hinge sulla parte
//  bassa lascia scoperta la catena posteriore. È lo stesso motivo per cui
//  push/pull/squat/hinge esistono già come categorie nel classificatore.
//
//  Onestà: qui NON c'è "falsa precisione" da study specifico — è la stessa
//  logica di buon senso di programmazione che l'app applica già altrove
//  (es. Volume.MEV/MAV per il volume). Soglie conservative, avviso neutro.
// ═══════════════════════════════════════════════════════════════════════════
