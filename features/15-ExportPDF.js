const ExportPDF = {
  _esc(s) { return U.escape(s); },
  _setNum(name) { const m = (name || "").split(" – ").pop().match(/S(\d+)/); return m ? +m[1] : 99; },

  async open() {
    let all = [];
    try { all = await API.getWorkoutSessions(200); } catch (e) {}
    const done  = all.filter(s => s.done);
    const types = [...new Set(done.map(s => s.type || s.name).filter(Boolean))];
    if (!done.length) { U.toast("Nessun allenamento completato da esportare", "info"); return; }
    const ov = document.createElement("div");
    ov.className = "app-modal-overlay"; ov.style.display = "flex";
    ov.innerHTML =
      '<div class="app-modal-box exp-box" onclick="event.stopPropagation()">' +
        '<div class="exp-title"><i class="ti ti-file-download"></i> Esporta in PDF</div>' +
        '<label class="exp-lbl">Tipo di allenamento</label>' +
        '<select class="select-dark" id="exp-type"><option value="__all__">Tutti i tipi</option>' +
          types.map(t => `<option value="${this._esc(t)}">${this._esc(t)}</option>`).join("") +
        '</select>' +
        '<label class="exp-lbl">Quante sessioni (dalle più recenti)</label>' +
        '<input class="field-inp" id="exp-limit" type="number" min="1" max="100" value="12">' +
        '<div class="exp-actions">' +
          '<button class="btn-secondary" id="exp-cancel">Annulla</button>' +
          '<button class="btn-primary" id="exp-go"><i class="ti ti-file-download"></i> Genera PDF</button>' +
        '</div>' +
      '</div>';
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
    ov.querySelector("#exp-cancel").onclick = () => ov.remove();
    ov.querySelector("#exp-go").onclick = () => {
      const type  = ov.querySelector("#exp-type").value;
      const limit = Math.max(1, parseInt(ov.querySelector("#exp-limit").value) || 12);
      ov.remove();
      this.generate(type, limit);
    };
  },

  async generate(type, limit) {
    U.toast("Preparo l'export…", "info");
    let all = [];
    try { all = await API.getWorkoutSessions(200); } catch (e) { U.toast("Errore nel recupero", "err"); return; }
    let sess = all.filter(s => s.done);
    if (type && type !== "__all__") sess = sess.filter(s => (s.type || s.name) === type);
    sess.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (limit) sess = sess.slice(-limit);
    if (!sess.length) { U.toast("Nessuna sessione da esportare", "info"); return; }
    const withEx = [];
    for (const s of sess) {
      let ex = [];
      try { ex = await API.getSessionExercises(s.id); } catch (e) {}
      withEx.push({ ...s, exercises: ex });
    }
    // Progressione PER ESERCIZIO — come la zona "Progressione" dell'app: il
    // VOLUME TOTALE della seduta (peso×rep sommato su tutte le serie), non
    // il solo set migliore — stesso fix e stesso motivo (un set di punta
    // invariato ma le altre serie migliorate è comunque progresso reale).
    // Per-esercizio, per-GIORNO (non per sessione): l'app può avere più di una
    // sessione "done" nella stessa data (una lasciata a metà + quella vera
    // completata, vedi Dashboard.buildWeekSplit) — Progression.groupSessions
    // le fonde per data; questo export prima non lo faceva, producendo due
    // punti/PR separati per lo stesso giorno invece di uno combinato.
    const byExDate = {};
    withEx.forEach(s => {
      const g = {};
      s.exercises.forEach(r => { if ((r.reps || 0) <= 0) return; const k = U.exBase(r.name); (g[k] = g[k] || []).push(r); });
      Object.keys(g).forEach(k => {
        const volume = g[k].reduce((t, r) => t + (r.reps || 0) * (r.kg || 0), 0);
        const repsTot = g[k].reduce((t, r) => t + (r.reps || 0), 0);
        byExDate[k] = byExDate[k] || {};
        const cur = byExDate[k][s.date];
        byExDate[k][s.date] = cur ? { date: s.date, volume: cur.volume + volume, repsTot: cur.repsTot + repsTot } : { date: s.date, volume, repsTot };
      });
    });
    const perEx = {};
    Object.keys(byExDate).forEach(k => { perEx[k] = Object.values(byExDate[k]).sort((a, b) => new Date(a.date) - new Date(b.date)); });
    // record: il volume totale (rep totali a corpo libero) supera tutti i
    // precedenti. isBW è una decisione GLOBALE per esercizio (stesso motivo
    // di Progression.groupSessions): se una singola seduta a corpo libero
    // finisce dentro uno storico altrimenti pesato, il suo volume=0 non è un
    // vero crollo — progVal resta null (buco onesto nel grafico PDF).
    Object.values(perEx).forEach(pts => {
      const isBW = pts.every(p => p.volume === 0);
      pts.forEach(p => { p.progVal = isBW ? p.repsTot : (p.volume === 0 ? null : p.volume); });
      let run = 0, hasPrior = false;
      pts.forEach(p => {
        if (p.progVal == null) { p.isPR = false; return; }
        p.isPR = hasPrior && p.progVal > run && p.progVal > 0;
        run = Math.max(run, p.progVal);
        hasPrior = true;
      });
    });
    const charts = {};
    for (const [name, pts] of Object.entries(perEx)) {
      if (pts.length >= 2) { try { charts[name] = this._chartURL(name, pts); } catch (e) {} }
    }
    this._printHTML(this._buildHTML(type, withEx, charts));
  },

  _chartURL(name, pts) {
    const c = document.createElement("canvas");
    c.width = 680; c.height = 240;
    const isBW = pts.every(p => p.volume === 0);
    const data = pts.map(p => p.progVal);
    const ptColors = pts.map(p => p.isPR ? "#F59E0B" : "#FF3B2F");   // record in ambra
    const ptRadius = pts.map(p => p.isPR ? 6 : 3);
    const chart = new Chart(c.getContext("2d"), {
      type: "line",
      data: {
        labels: pts.map(p => U.fmtDate(p.date)),
        datasets: [{ data, borderColor: "#FF3B2F", backgroundColor: "rgba(255,59,47,.10)", spanGaps: false,
          fill: true, tension: .3, pointRadius: ptRadius, pointBackgroundColor: ptColors, borderWidth: 2 }],
      },
      options: { responsive: false, animation: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: "#666", font: { size: 10 } }, grid: { color: "#eee" } },
                  y: { ticks: { color: "#666", font: { size: 10 }, callback: v => isBW ? U.fmt(v) + " r" : U.fmtV(v) }, grid: { color: "#eee" } } } },
    });
    const url = c.toDataURL("image/png");
    chart.destroy();
    return url;
  },

  _buildHTML(type, sessions, charts) {
    const esc = this._esc.bind(this);
    const scope = (type && type !== "__all__") ? esc(type) : "Tutti i tipi";
    const range = sessions.length ? `${U.fmtDate(sessions[0].date)} – ${U.fmtDate(sessions[sessions.length - 1].date)}` : "";
    // Un grafico di progressione per ESERCIZIO (come la zona Progressione dell'app)
    const chartCards = Object.keys(charts).sort().map(n =>
      `<div class="rp-chart"><div class="rp-chart-t">${esc(n)}</div><img src="${charts[n]}" alt=""></div>`).join("");
    const chartSec = chartCards
      ? `<h2 class="rp-h2">Progressione per esercizio <span class="rp-h2s">(volume totale per seduta · <span class="rp-pr">●</span> record)</span></h2>` +
        `<div class="rp-charts">${chartCards}</div>`
      : "";
    const sessBlocks = [...sessions].reverse().map(s => {
      let exNotes = { ...s.exerciseNotes }; try { Object.assign(exNotes, JSON.parse(localStorage.getItem("gymos_exnote_" + s.id) || "{}"), Notes.pending(s.id)?.exercises); } catch (e) {}
      const g = {}, order = [];
      s.exercises.forEach(r => { const k = U.exBase(r.name); if (!g[k]) { g[k] = []; order.push(k); } g[k].push(r); });
      const rows = order.map(k => {
        const sets = g[k].filter(r => (r.reps || 0) > 0).sort((a, b) => this._setNum(a.name) - this._setNum(b.name));
        if (!sets.length) return "";
        const setStr = sets.map(r => `${r.kg ? U.fmt(r.kg) + "kg" : "CL"}×${r.reps}`).join("  ·  ");
        const setNote = sets.map(r => r.note).filter(Boolean).join(" · ");
        const notes = [setNote, exNotes[k] || ""].filter(Boolean).join(" — ");
        return `<tr><td class="rp-ex">${esc(k)}</td><td class="rp-sets">${esc(setStr)}${notes ? `<div class="rp-note">${esc(notes)}</div>` : ""}</td></tr>`;
      }).join("");
      return `<div class="rp-sess"><div class="rp-sess-h"><b>${esc(s.name)}</b><span>${U.fmtDate(s.date)}${s.type ? " · " + esc(s.type) : ""}</span></div>` +
        (s.note ? `<div class="rp-snote">${esc(s.note)}</div>` : "") +
        `<table class="rp-tbl">${rows}</table></div>`;
    }).join("");
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>GymOS — Report allenamenti</title>` +
      `<style>${this._css()}</style></head><body>` +
      `<div class="rp-head"><div class="rp-logo">GYM<span>OS</span></div>` +
        `<div class="rp-meta"><div class="rp-mt">Report allenamenti</div><div>${scope} · ${sessions.length} sessioni</div><div>${range}</div></div></div>` +
      chartSec +
      `<h2 class="rp-h2">Dettaglio sessioni</h2>${sessBlocks}` +
      `<div class="rp-foot">Generato da GymOS</div></body></html>`;
  },

  _css() {
    return `*{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:22px;background:#fff;font-size:12px}
      .rp-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #FF3B2F;padding-bottom:10px;margin-bottom:16px}
      .rp-logo{font-weight:800;font-size:26px;letter-spacing:1px}.rp-logo span{color:#FF3B2F}
      .rp-meta{text-align:right;color:#555;font-size:11px;line-height:1.5}.rp-mt{font-weight:700;color:#1a1a1a;font-size:13px}
      .rp-h2{font-size:14px;margin:20px 0 10px;color:#FF3B2F;border-bottom:1px solid #eee;padding-bottom:4px}
      .rp-charts{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .rp-chart{border:1px solid #eee;border-radius:8px;padding:8px;break-inside:avoid}
      .rp-chart-t{font-weight:700;font-size:11px;margin-bottom:4px}.rp-chart img{width:100%;height:auto;display:block}
      .rp-h2s{font-weight:400;font-size:11px;color:#888}.rp-pr{color:#F59E0B;font-size:12px}
      .rp-sess{border:1px solid #eee;border-radius:8px;padding:10px 12px;margin-bottom:10px;break-inside:avoid}
      .rp-sess-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
      .rp-sess-h b{font-size:13px}.rp-sess-h span{color:#666;font-size:11px}
      .rp-snote{background:#f6f6f6;border-radius:6px;padding:5px 8px;font-size:11px;color:#444;margin-bottom:6px;font-style:italic}
      .rp-tbl{width:100%;border-collapse:collapse}
      .rp-tbl td{padding:4px 6px;border-top:1px solid #f0f0f0;vertical-align:top}
      .rp-ex{font-weight:700;width:38%}.rp-sets{font-family:'DM Mono',ui-monospace,monospace;color:#222}
      .rp-note{color:#888;font-size:10px;margin-top:2px;font-family:sans-serif}
      .rp-foot{margin-top:18px;text-align:center;color:#aaa;font-size:10px}
      @media print{.rp-chart,.rp-sess{break-inside:avoid}}
      @page{margin:14mm}`;
  },

  _printHTML(html) {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const fire = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { U.toast("Stampa non disponibile", "err"); }
      setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 60000);
    };
    if (iframe.contentWindow.document.readyState === "complete") setTimeout(fire, 400);
    else iframe.onload = () => setTimeout(fire, 400);
  },
};

// ═══════════════════════════════════════════════
//  GymOS — "Il punto di oggi" (#H): recap/consigli giornalieri in home.
//  Motore di insight sui segnali già disponibili (sedute, peso+fase, sonno/HRV,
//  abitudini, volume, segnale-forza). Regole evidence-based, ordinate per
//  urgenza. Niente falsa precisione: parla solo quando i dati lo giustificano.
// ═══════════════════════════════════════════════
