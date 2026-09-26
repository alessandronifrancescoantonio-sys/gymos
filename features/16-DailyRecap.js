const DailyRecap = {
  SEV: { alert: 0, warn: 1, info: 2, good: 3 },

  _weekDone(sessions) {
    // Settimana da LUNEDÌ (allineata a Volume._weekStart e a buildStats)
    const now = new Date(), sow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    sow.setDate(sow.getDate() - ((now.getDay() + 6) % 7));
    return (sessions || []).filter(s => s.done && s.date && new Date(s.date) >= sow).length;
  },

  // Trend peso: %/settimana su una finestra utile (ref = check-in più vecchio a
  // >=4 giorni). null se dati insufficienti. Coerente con Body._energyFlag.
  _weightTrend(checkins) {
    const w = (checkins || []).filter(c => c.peso != null && c.peso > 0);
    if (w.length < 2) return null;
    const last = w[w.length - 1], lastT = new Date(last.date).getTime();
    let ref = null;
    for (const c of w) { const dd = (lastT - new Date(c.date).getTime()) / 86400000; if (dd >= 4) { ref = c; break; } }
    if (!ref) ref = w[0];
    const days = (lastT - new Date(ref.date).getTime()) / 86400000;
    if (days < 4) return null;
    const dKg = Math.round((last.peso - ref.peso) * 10) / 10;
    return { rate: (dKg / ref.peso) * 100 / (days / 7), dKg, days, peso: last.peso };
  },

  // Punto, non virgola: era l'unico posto a mostrare "-0,1%/sett" mentre il
  // resto dell'app (kg, e1RM, volume) usa il punto ovunque — stesso valore,
  // stile diverso a seconda di dove lo guardavi (vedi #daily-recap "PESO/SETT").
  _fmtRate(r) { const v = Math.round(r * 10) / 10; return `${v > 0 ? "+" : ""}${v}%/sett`; },
  _protein(peso) { return peso ? `${Math.round(peso * 1.6)}–${Math.round(peso * 2.2)} g/die` : "1,6–2,2 g/kg"; },

  // Quanti check-in CONSECUTIVI (dal più recente a ritroso) sono nella stessa
  // fase attuale — stima grezza di "da quanto sei in questa fase" usando solo
  // dati già tracciati (fase per check-in), niente nuovo campo. Non è un
  // conteggio esatto di settimane (dipende da quanto spesso ti pesi), solo un
  // segnale per capire se una fase si sta protraendo.
  _phaseStreak(checkins, re) {
    let n = 0;
    for (let i = (checkins || []).length - 1; i >= 0; i--) {
      if (re.test(checkins[i].fase || "")) n++; else break;
    }
    return n;
  },
  // Giorni di calendario coperti dallo streak (dal primo check-in della
  // sequenza all'ultimo) — un utente che si pesa più volte nello stesso
  // giorno farebbe salire `_phaseStreak` senza che sia passato tempo reale;
  // questo evita di scattare il diet-break dopo pochi giorni scambiati per
  // "8 settimane" solo perché i check-in sono frequenti.
  _phaseStreakDays(checkins, re) {
    const arr = checkins || [];
    let start = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!re.test(arr[i].fase || "")) break;
      start = arr[i];
    }
    if (!start || !arr.length) return 0;
    const last = arr[arr.length - 1];
    return (new Date(last.date).getTime() - new Date(start.date).getTime()) / 86400000;
  },

  build(d) {
    const ins = [];
    const add = (sev, icon, title, msg) => ins.push({ sev, icon, title, msg });

    // ── ALLENAMENTO — frequenza ──
    const done = this._weekDone(d.sessions);
    const target = Object.keys((typeof CONFIG !== "undefined" && CONFIG.SCHEDE) || {}).length || 3;
    const dow = new Date().getDay();   // 0 = domenica
    if (target > 0 && done >= target) add("good", "ti-flame", "Settimana completata", `${done}/${target} sedute fatte: ottima costanza.`);
    else if (done === 0 && (dow >= 4 || dow === 0)) add("info", "ti-barbell", "Settimana ancora ferma", "Nessuna seduta finora: se puoi, recuperane almeno una.");
    else add("info", "ti-barbell", "Allenamenti", `${done}/${target} sedute questa settimana: tieni il ritmo.`);

    // ── ALLENAMENTO — volume sotto il minimo ──
    if (d.volume && d.volume.vol) {
      const low = Object.keys(d.volume.vol).filter(m => d.volume.vol[m] > 0 && d.volume.vol[m] < 10);
      if (low.length) add("info", "ti-chart-bar", "Volume basso", `Sotto le 10 serie/sett su: ${low.slice(0, 3).join(", ")}.`);
    }

    // ── SPINTA / FATICA — segnale forza diffuso ──
    // Stessa finestra di freschezza usata da Body._energyFlag e
    // Recovery.renderCard (28gg, non 21): prima disallineate, la card
    // "Recupero muscolare" poteva trattare il segnale come ancora valido
    // (<=28gg) mentre "Il punto di oggi" lo considerava già scaduto (>21gg)
    // per lo STESSO identico segnale — un giorno la finestra a 24gg mostrava
    // consigli contraddittori fianco a fianco sulla stessa Home.
    const sig = d.strengthSig;
    const sigFresh = sig && sig.ts && (Date.now() - sig.ts) < 28 * 86400000;
    const strDown = sigFresh && sig.down;
    if (strDown) add("warn", "ti-battery-2", "Forza in calo diffuso", "Cali su più esercizi: stai accumulando fatica. Valuta una seduta più leggera o un giorno di stacco, e cura sonno e cibo.");

    // ── SCARICO PROATTIVO (calendario, non reattivo) — soft, informativo:
    // non sostituisce/contraddice lo scarico reattivo (basato su calo reale),
    // è solo un'idea se non ci sono già segnali e non ne parli da un po'.
    const DELOAD_CALENDAR_DAYS = 56;   // ~8 settimane (Nippard: ogni ~2 mesi)
    const deloadDue = !strDown && d.lastDeloadTs > 0 && (Date.now() - d.lastDeloadTs) >= DELOAD_CALENDAR_DAYS * 86400000;
    if (deloadDue) add("info", "ti-refresh", "Scarico proattivo?", "Non hai avuto segnali di calo da un po': una settimana leggera ogni tanto (-25/50% carico-volume) aiuta tecnica e articolazioni anche senza bisogno reale — solo un'idea, non un obbligo.");

    // ── RECUPERO — sonno / HRV ──
    const sl = d.sleep && d.sleep[0];
    const avgSleep = d.sleep && d.sleep.length ? d.sleep.reduce((a, s) => a + (s.ore || 0), 0) / d.sleep.length : null;
    if (sl) {
      if ((sl.hrv && sl.hrv < 45) || (sl.ore || 7) < 6)
        add("alert", "ti-zzz", "Recupero basso oggi", `${sl.hrv && sl.hrv < 45 ? `HRV ${sl.hrv}ms basso` : "hai dormito poco"}: oggi meglio alleggerire o recuperare.`);
      else if ((sl.ore || 7) < 7)
        add("warn", "ti-zzz", "Recupero moderato", "Notte corta: tieni un'intensità controllata oggi.");
    }
    if (avgSleep != null && avgSleep < 6.5)
      add("warn", "ti-moon", "Dormi poco", `Media ${avgSleep.toFixed(1)}h a notte: il sonno è il primo motore di recupero e crescita. Punta a 7–8h.`);

    // ── FASE & NUTRIZIONE — peso vs fase (la parte "calorie") ──
    const wt = this._weightTrend(d.checkins);
    const fase = (d.checkins && d.checkins.length) ? (d.checkins[d.checkins.length - 1].fase || "") : "";
    if (wt && fase) {
      const r = wt.rate, prot = this._protein(wt.peso);
      if (/cut|defin|tagl/i.test(fase)) {
        if (r > -0.15) {
          const cutRe = /cut|defin|tagl/i;
          const longCut = this._phaseStreak(d.checkins, cutRe) >= 8 && this._phaseStreakDays(d.checkins, cutRe) >= 40;
          const dietBreak = longCut ? " Sei in questa fase da un po': oltre a tagliare le calorie, una pausa di 1-2 settimane a mantenimento può aiutare aderenza e fame senza rovinare i progressi." : "";
          add("warn", "ti-flame", "Definizione ferma", `In definizione ma il peso non scende (${this._fmtRate(r)}). Se resta fermo 1–2 settimane, taglia un po' le calorie.${dietBreak}`);
        }
        else if (r < -1.0 && strDown) add("alert", "ti-bolt", "Taglio troppo aggressivo", `Peso giù in fretta (${this._fmtRate(r)}) e forza in calo: rischio RED-S. Alza le calorie, tieni le proteine (~${prot}) e rallenta.`);
        else if (r < -1.0) add("warn", "ti-flame", "Taglio veloce", `Perdi in fretta (${this._fmtRate(r)}): occhio a non perdere muscolo. Proteine alte (~${prot}).`);
        else add("good", "ti-flame", "Definizione on track", `Perdi ~${this._fmtRate(r)}: ritmo giusto per tenere il muscolo.`);
      } else if (/bulk|massa|surplus/i.test(fase)) {
        if (r < 0.1) add("warn", "ti-trending-up", "Massa ferma", `In massa ma il peso non sale (${this._fmtRate(r)}): per crescere serve un lieve surplus, aumenta un po' le calorie.`);
        else if (r > 1.0) add("warn", "ti-trending-up", "Massa troppo rapida", `Sali in fretta (${this._fmtRate(r)}): modera il surplus per limitare il grasso (più sei avanzato, più conviene restare vicino a ~0,5–1%/mese).`);
        else add("good", "ti-trending-up", "Massa on track", `Cresci di ~${this._fmtRate(r)}: ritmo pulito.`);
      } else {
        if (Math.abs(r) < 0.3) add("good", "ti-equal", "Peso stabile", `Mantenimento ok (${this._fmtRate(r)}).`);
        else add("info", "ti-scale", "Peso in movimento", `${this._fmtRate(r)} in mantenimento: se non è voluto, rivedi le calorie.`);
      }
    }

    ins.sort((a, b) => this.SEV[a.sev] - this.SEV[b.sev]);
    const strTrend = strDown ? "giù" : (sigFresh ? "su" : "—");
    return {
      insights: ins,
      headline: ins[0] || null,
      stats: { done, target, avgSleep, rate: wt ? wt.rate : null, fase, strTrend, deloadFired: deloadDue, strDown },
    };
  },

  render(data) {
    const wrap = document.getElementById("daily-recap");
    if (!wrap) return;
    let strengthSig = null;
    try { strengthSig = JSON.parse(localStorage.getItem("gymos_strength_signal") || "null"); } catch (e) {}
    let volume = null;
    try { volume = (typeof Volume !== "undefined") ? Volume.compute() : null; } catch (e) {}
    // Scarico calendario: timestamp on-device dell'ultimo nudge/segnale, per
    // non ripetere il consiglio ogni giorno. Al primissimo utilizzo (mai
    // scritto prima) si "semina" senza mostrare nulla — evita di accogliere
    // un utente nuovo con un consiglio di scarico al primo avvio.
    let lastDeloadTs = 0;
    try { lastDeloadTs = parseInt(localStorage.getItem("gymos_last_deload_nudge_ts") || "0", 10) || 0; } catch (e) {}
    const r = this.build({ ...data, volume, strengthSig, lastDeloadTs });
    try {
      // Usa `r.stats.strDown` (calcolato in build(), già verificato per
      // freschezza entro 21gg) invece del `strengthSig.down` grezzo — un
      // segnale vecchio di settimane non deve resettare il timer all'infinito.
      if (!lastDeloadTs || r.stats.deloadFired || r.stats.strDown) localStorage.setItem("gymos_last_deload_nudge_ts", String(Date.now()));
    } catch (e) {}
    if (!r.insights.length) { wrap.innerHTML = ""; return; }
    const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hd = r.headline;
    // strip analitiche
    const chips = [];
    chips.push(`<div class="rc-chip"><span class="rc-cv">${r.stats.done}/${r.stats.target}</span><span class="rc-cl">sedute</span></div>`);
    if (r.stats.avgSleep != null) chips.push(`<div class="rc-chip"><span class="rc-cv">${r.stats.avgSleep.toFixed(1)}h</span><span class="rc-cl">sonno</span></div>`);
    if (r.stats.rate != null) chips.push(`<div class="rc-chip"><span class="rc-cv">${this._fmtRate(r.stats.rate).replace("/sett", "")}</span><span class="rc-cl">peso/sett</span></div>`);
    const trIc = r.stats.strTrend === "giù" ? "↓" : r.stats.strTrend === "su" ? "↑" : "→";
    chips.push(`<div class="rc-chip"><span class="rc-cv">${trIc}</span><span class="rc-cl">forza</span></div>`);
    // altre insight (oltre l'headline)
    const rest = r.insights.slice(1);
    const cards = rest.map(i => `
      <div class="rc-item rc-${i.sev}">
        <i class="ti ${i.icon}"></i>
        <div class="rc-txt"><span class="rc-it">${esc(i.title)}</span><span class="rc-im">${esc(i.msg)}</span></div>
      </div>`).join("");
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-sparkles"></i>Il punto di oggi</div>
      ${hd ? `<div class="rc-head rc-${hd.sev}">
        <i class="ti ${hd.icon}"></i>
        <div class="rc-txt"><span class="rc-it">${esc(hd.title)}</span><span class="rc-im">${esc(hd.msg)}</span></div>
      </div>` : ""}
      <div class="rc-strip">${chips.join("")}</div>
      ${cards ? `<div class="rc-list">${cards}</div>` : ""}
      <div class="rc-foot">Sintesi automatica dai tuoi dati · non è un consiglio medico</div>`;
  },
};

// ═══════════════════════════════════════════════
//  GymOS — "Come si esegue?" (free-exercise-db, pubblico dominio)
//  Indice leggero locale (EXERCISE_GUIDE_IDX, ~65KB) per il matching;
//  istruzioni+immagine caricate ON-DEMAND via CDN jsdelivr (mai scaricate in
//  anticipo, l'app resta leggera). Matching onesto: se ambiguo, SEMPRE un
//  selettore per l'utente — mai una scelta indovinata in silenzio.
// ═══════════════════════════════════════════════
