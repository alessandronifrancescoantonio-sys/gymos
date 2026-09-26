const Body = {
  checkins:     [],
  activeMisura: CONFIG.MISURE[0].key,
  activeFase:   "Cut",
  pesoChart:    null,
  misuraChart:  null,

  FASE_COLORS: {
    "Cut":   { bg: "rgba(239,68,68,.12)",  border: "rgba(239,68,68,.3)",  text: "#EF4444" },
    "Bulk":  { bg: "rgba(34,197,94,.12)",  border: "rgba(34,197,94,.3)",  text: "#22C55E" },
    "Mant.": { bg: "rgba(59,130,246,.12)", border: "rgba(59,130,246,.3)", text: "#3B82F6" },
  },

  async load() {
    try {
      this.checkins = await API.getBodyMetrics(30);
      this.render();
    } catch(e) { console.error("Body.load:", e); }
  },

  render() {
    this.buildStats();
    this.buildEnergyFlag();
    this.buildPesoChart();
    this.buildMisureGrid();
    this.buildMisuraChart();
    this.buildFaseRow();
    this.buildHistTable();
    if (typeof ProgressPhotos !== "undefined") ProgressPhotos.renderCard();
  },

  // #6 PT scientifico — ENERGIA DISPONIBILE (RED-S). Se coincidono un calo di
  // forza DIFFUSO (segnale persistito da Session, non un solo esercizio) e una
  // perdita di peso RAPIDA (>~1%/settimana), avvisa: può essere troppo poca
  // energia disponibile → calano forza, ormoni, recupero (consenso IOC 2023).
  // NON calcola l'EA precisa (servirebbe un diario alimentare, fuori scope):
  // cita il concetto e la soglia proteica evidence-based (Morton 2018: la
  // curva si appiattisce a ~1,6 g/kg, tetto difendibile ~2,2 g/kg).
  _energyFlag() {
    try {
      const sig = JSON.parse(localStorage.getItem("gymos_strength_signal") || "null");
      if (!sig || !sig.down) return null;
      // Segnale forza troppo vecchio (>28 gg) → non più affidabile
      if (sig.ts && (Date.now() - sig.ts) > 28 * 86400000) return null;

      const w = this.checkins.filter(c => c.peso != null && c.peso > 0);
      if (w.length < 2) return null;
      const last = w[w.length - 1];
      const lastT = new Date(last.date).getTime();
      // Riferimento: il check-in più vecchio in una finestra di 10-45 giorni
      let ref = null;
      for (const c of w) {
        const dd = (lastT - new Date(c.date).getTime()) / 86400000;
        if (dd >= 10 && dd <= 45) { ref = c; break; }
      }
      if (!ref) return null;
      const days = (lastT - new Date(ref.date).getTime()) / 86400000;
      const dKg  = Math.round((last.peso - ref.peso) * 10) / 10;
      if (dKg >= 0 || days <= 0) return null;                 // non sta calando
      const pctPerWeek = (dKg / ref.peso) * 100 / (days / 7);
      if (pctPerWeek > -1.0) return null;                     // calo non "rapido"

      const pMin = Math.round(last.peso * 1.6);
      const pMax = Math.round(last.peso * 2.2);
      return { dKg: Math.abs(dKg), days: Math.round(days), pMin, pMax,
        rate: Math.abs(Math.round(pctPerWeek * 10) / 10) };
    } catch (e) { return null; }
  },

  buildEnergyFlag() {
    const el = document.getElementById("energy-flag");
    if (!el) return;
    const f = this._energyFlag();
    if (!f) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="energy-flag">
        <i class="ti ti-bolt"></i>
        <div class="ef-txt">
          <span class="ef-title">Occhio all'energia disponibile</span>
          <span class="ef-body">La forza cala su più esercizi <b>e</b> il peso scende in fretta (−${U.fmt(f.dKg)} kg in ${f.days} giorni, ~${U.fmt(f.rate)}%/settimana). Un deficit troppo aggressivo (RED-S) fa calare forza, ormoni e recupero. Tieni le proteine alte — per te <b>~${f.pMin}–${f.pMax} g al giorno</b> — e valuta di rallentare il taglio.</span>
        </div>
      </div>`;
  },

  last()  { return this.checkins[this.checkins.length - 1] || {}; },
  first() { return this.checkins[0] || {}; },
  delta(key) {
    const l = this.last()[key], f = this.first()[key];
    return (l != null && f != null) ? Math.round((l - f) * 10) / 10 : null;
  },

  buildStats() {
    const l  = this.last();
    const fc = this.FASE_COLORS[l.fase] || this.FASE_COLORS["Mant."];
    document.getElementById("fase-badge-hd").innerHTML =
      `<span class="fase-badge" style="background:${fc.bg};border-color:${fc.border};color:${fc.text}">${U.escape(l.fase || "—")}</span>`;

    const dp = this.delta("peso");
    const strip = document.getElementById("body-stats");
    strip.innerHTML = `
      <div class="bstat"><div class="bstat-v">${U.fmt(l.peso)}<span class="bstat-u">kg</span></div><div class="bstat-l">Peso attuale</div>${dp != null ? `<div class="bstat-d" style="color:${dp < 0 ? "var(--green)" : "var(--red)"}">${dp > 0 ? "+" : ""}${U.fmt(dp)} kg da inizio</div>` : ""}</div>
      <div class="bstat"><div class="bstat-v">${U.fmt(l.bf)}<span class="bstat-u">%</span></div><div class="bstat-l">% Grasso</div></div>
      <div class="bstat"><div class="bstat-v">${U.fmt(l.vita)}<span class="bstat-u">cm</span></div><div class="bstat-l">Vita</div></div>
      <div class="bstat"><div class="bstat-v">${this.checkins.length}</div><div class="bstat-l">Check-in totali</div></div>
    `;
  },

  buildPesoChart() {
    // distruggi PRIMA del return su dati vuoti (altrimenti l'istanza resta viva)
    if (this.pesoChart && !this.checkins.length) { this.pesoChart.destroy(); this.pesoChart = null; }
    if (!this.checkins.length) return;
    const data   = this.checkins.map(c => c.peso);
    const labels = this.checkins.map(c => U.fmtDate(c.date));
    const minD   = Math.min(...data.filter(Boolean));
    const maxD   = Math.max(...data.filter(Boolean));
    const pad    = (maxD - minD) * 0.4 || 0.5;
    const ttEl   = document.getElementById("peso-tt");
    const h      = this.checkins;

    if (this.pesoChart) this.pesoChart.destroy();
    const ctx = document.getElementById("peso-chart").getContext("2d");
    const opts = U.baseChartOptions(ttEl, idx => {
      const c  = h[idx];
      const dp = idx > 0 ? Math.round((c.peso - h[idx-1].peso) * 10) / 10 : null;
      return `
        <div class="tt-date">${U.fmtDate(c.date)}</div>
        <div class="tt-main" style="color:#FF3B2F">${U.fmt(c.peso)} kg</div>
        ${dp != null ? `<div class="tt-sub" style="color:${dp < 0 ? "var(--green)" : "var(--red)"}">${dp > 0 ? "+" : ""}${U.fmt(dp)} vs prec.</div>` : ""}
        ${c.note ? `<div class="tt-note">${U.escape(c.note)}</div>` : ""}
      `;
    }, ".card");
    opts.scales.y.min = minD - pad;
    opts.scales.y.max = maxD + pad;
    // U.fmt (non toFixed(1) fisso) — un peso intero come 78 deve leggersi "78
    // kg" sull'asse esattamente come nel tooltip ("78.0 kg" vs "78 kg" era
    // lo stesso numero mostrato in due modi diversi nello stesso grafico).
    opts.scales.y.ticks.callback = v => U.fmt(v) + " kg";

    this.pesoChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: "#FF3B2F", backgroundColor: "transparent",
        borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: "#FF3B2F",
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 8, tension: .35 }] },
      options: opts,
    });
  },

  buildMisureGrid() {
    const grid = document.getElementById("misure-grid");
    const l    = this.last();
    grid.innerHTML = "";
    CONFIG.MISURE.forEach(m => {
      const val = l[m.key];
      const d   = this.delta(m.key);
      const dColor = d == null ? "var(--dim)" : (m.downGood ? (d < 0 ? "var(--green)" : "var(--red)") : (d > 0 ? "var(--green)" : "var(--red)"));
      const card = document.createElement("div");
      card.className = "misura-card" + (m.key === this.activeMisura ? " active" : "");
      card.innerHTML = `
        <div class="misura-name">${m.label}</div>
        <div class="misura-val">${U.fmt(val)}<span class="misura-unit">${m.unit}</span></div>
        ${d != null ? `<div class="misura-delta" style="color:${dColor}">${d > 0 ? "+" : ""}${U.fmt(d)} ${m.unit}</div>` : ""}
      `;
      card.onclick = () => { this.activeMisura = m.key; this.buildMisureGrid(); this.buildMisuraChart(); };
      grid.appendChild(card);
    });
  },

  buildMisuraChart() {
    if (this.misuraChart && !this.checkins.length) { this.misuraChart.destroy(); this.misuraChart = null; }
    if (!this.checkins.length) return;
    const m      = CONFIG.MISURE.find(x => x.key === this.activeMisura);
    const data   = this.checkins.map(c => c[m.key]);
    const labels = this.checkins.map(c => U.fmtDate(c.date));
    const valid  = data.filter(Boolean);
    // Misura mai compilata in nessun check-in: Math.min(...[]) darebbe
    // Infinity → assi y NaN e grafico rotto. Distruggi e esci puliti.
    if (!valid.length) { if (this.misuraChart) { this.misuraChart.destroy(); this.misuraChart = null; } return; }
    const minD   = Math.min(...valid), maxD = Math.max(...valid);
    const pad    = (maxD - minD) * 0.4 || 0.5;
    const ttEl   = document.getElementById("misura-tt");
    const h      = this.checkins;

    if (this.misuraChart) this.misuraChart.destroy();
    const ctx  = document.getElementById("misura-chart").getContext("2d");
    const opts = U.baseChartOptions(ttEl, idx => {
      const c  = h[idx];
      const dv = idx > 0 ? Math.round((c[m.key] - h[idx-1][m.key]) * 10) / 10 : null;
      return `
        <div class="tt-date">${U.fmtDate(c.date)}</div>
        <div class="tt-main" style="color:${m.color}">${U.fmt(c[m.key])} ${m.unit}</div>
        ${dv != null ? `<div class="tt-sub" style="color:${m.downGood ? (dv < 0 ? "var(--green)" : "var(--red)") : (dv > 0 ? "var(--green)" : "var(--red)")}">${dv > 0 ? "+" : ""}${U.fmt(dv)} vs prec.</div>` : ""}
      `;
    }, ".card");
    opts.scales.y.min = minD - pad;
    opts.scales.y.max = maxD + pad;
    opts.scales.y.ticks.callback = v => U.fmt(v) + " " + m.unit;

    this.misuraChart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ data, borderColor: m.color, backgroundColor: "transparent",
        borderWidth: 2, pointRadius: 5, pointBackgroundColor: m.color,
        pointBorderColor: "#0D0D0F", pointBorderWidth: 2, pointHoverRadius: 8, tension: .35 }] },
      options: opts,
    });
  },

  buildFaseRow() {
    const row = document.getElementById("fase-row");
    row.innerHTML = "";
    Object.keys(this.FASE_COLORS).forEach(f => {
      const b = document.createElement("button");
      b.className = "pill-btn" + (f === this.activeFase ? " on" : "");
      b.textContent = f;
      b.onclick = () => { this.activeFase = f; this.buildFaseRow(); };
      row.appendChild(b);
    });
  },

  buildHistTable() {
    const tbody = document.getElementById("body-hist-tbody");
    tbody.innerHTML = "";
    [...this.checkins].reverse().forEach((c, ri) => {
      const i    = this.checkins.length - 1 - ri;
      const prev = i > 0 ? this.checkins[i - 1] : null;
      const dp   = prev ? Math.round((c.peso - prev.peso) * 10) / 10 : null;
      const fc   = this.FASE_COLORS[c.fase] || this.FASE_COLORS["Mant."];
      const faseBadge = `<span class="fase-badge" style="background:${fc.bg};color:${fc.text};border-color:${fc.border}">${U.escape(c.fase || "—")}</span>`;
      const dpHTML    = dp != null ? U.deltaHTML(dp, true) : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${U.fmtDate(c.date)}</td><td>${faseBadge}</td>
        <td class="mono">${U.fmt(c.peso)} kg</td><td>${dpHTML}</td>
        <td class="mono">${U.fmt(c.vita)} cm</td><td class="mono">${U.fmt(c.petto)} cm</td>
        <td class="mono">${U.fmt(c.coscia)} cm</td><td class="mono">${U.fmt(c.braccio)} cm</td>
        <td class="mono">${U.fmt(c.bf)}%</td>
        <td class="note-text">${U.escape(c.note || "—")}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  // Peso poco credibile rispetto all'ultimo check-in: quasi sempre un errore di
  // battitura (78 invece di 87). Un dato così sporco avvelena TUTTO a valle —
  // trend, fase, avviso RED-S.
  //
  // La soglia NON è fissa: il margine cresce col tempo passato. 3 kg in tre
  // giorni sono un refuso; gli stessi 3 kg in due mesi sono un bulk normale.
  // Massimo fisiologico ~1,5%/settimana + 2% di rumore (acqua, cibo, bilancia).
  _implausibleWeight(peso) {
    const done = (this.checkins || []).filter(c => c.peso > 0);
    if (!done.length) return null;                       // primo check-in: niente con cui confrontare
    const last = done[done.length - 1];
    const days  = Math.max(1, Math.round((Date.now() - new Date(last.date).getTime()) / 86400000));
    const maxPct = 2 + 1.5 * (days / 7);
    const pct = Math.abs(peso - last.peso) / last.peso * 100;
    if (pct <= maxPct) return null;
    return { last: last.peso, days, pct: Math.round(pct * 10) / 10 };
  },

  async addCheckin() {
    const get = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const note = document.getElementById("inp-note-body")?.value || "";
    const peso = get("inp-peso");
    if (!peso) return;
    // Fuori scala umana: è un errore, non un dato.
    if (!(peso > 25 && peso < 350)) {
      U.alert(`${U.fmt(peso)} kg non è un peso plausibile. Ricontrolla il numero.`);
      return;
    }
    // Sospetto ma possibile → CHIEDIAMO, non scartiamo in silenzio: un salto
    // grosso può essere vero (malattia, rientro da uno stop), e buttare via un
    // dato reale dell'utente senza dirglielo sarebbe peggio del refuso.
    const susp = this._implausibleWeight(peso);
    if (susp) {
      const quando = susp.days === 1 ? "ieri" : `${susp.days} giorni fa`;
      const okGo = await U.confirm(
        `Hai scritto <b>${U.fmt(peso)} kg</b>, ma l'ultimo check-in (${quando}) era <b>${U.fmt(susp.last)} kg</b>: ${U.fmt(susp.pct)}% di differenza in poco tempo.<br><br>Se è un errore di battitura, correggilo. Se è davvero così, procedi pure.`,
        { okText: "Sì, è giusto", cancelText: "Correggo" }
      );
      if (!okGo) { document.getElementById("inp-peso")?.focus(); return; }
    }
    const data = {
      fase: this.activeFase, peso,
      vita:    get("inp-vita"),
      petto:   get("inp-petto"),
      fianchi: get("inp-fianchi"),
      coscia:  get("inp-coscia"),
      braccio: get("inp-braccio"),
      bf:      get("inp-bf"),
      note,
    };
    await API.saveBodyCheckin(data);
    ["inp-peso","inp-vita","inp-petto","inp-fianchi","inp-coscia","inp-braccio","inp-bf","inp-note-body"]
      .forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = ""; });
    await this.load();
    const msg = document.getElementById("body-save-msg");
    msg.style.display = "flex";
    setTimeout(() => msg.style.display = "none", 2500);
  },
};

function addCheckin() { Body.addCheckin(); }

// ═══════════════════════════════════════════════
//  GymOS — dashboard.js
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  GymOS — Volume settimanale per gruppo muscolare
//  Conteggio frazionato (primario 1, secondario 0,5), target 10–20 serie/sett
//  (Schoenfeld et al.). Si riferisce SEMPRE al programma attivo (CONFIG.SCHEDE):
//  se cambi programma, cambia tutto.
// ═══════════════════════════════════════════════
