// ═══════════════════════════════════════════════
//  GymOS — timers.js
//  Timer durata sessione (manuale) + timer recupero
// ═══════════════════════════════════════════════

// ─── TIMER DURATA SESSIONE ───
// Parte SOLO con bottone Start. Persiste se chiudi il sito (salva timestamp).
// Si ferma SOLO al salvataggio sessione.
const DurationTimer = {
  startTime: null,
  interval:  null,
  sessionId: null,

  // Chiamato quando si carica una sessione: NON parte, controlla solo se era già avviato
  init(sessionId) {
    this.sessionId = sessionId;
    this.stopTicking();
    const saved = localStorage.getItem(`gymos_start_${sessionId}`);
    if (saved) {
      // Timer già avviato in precedenza → riprende
      this.startTime = parseInt(saved);
      this.startTicking();
      this.setBtnState("running");
    } else {
      // Non avviato
      this.startTime = null;
      this.renderIdle();
      this.setBtnState("idle");
    }
  },

  // Avvio manuale col bottone
  start() {
    if (!this.sessionId) return;
    this.startTime = Date.now();
    localStorage.setItem(`gymos_start_${this.sessionId}`, this.startTime);
    this.startTicking();
    this.setBtnState("running");
    if (navigator.vibrate) navigator.vibrate(20);
  },

  startTicking() {
    this.tick();
    clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), 1000);
  },

  stopTicking() {
    clearInterval(this.interval);
    this.interval = null;
  },

  tick() {
    if (!this.startTime) return;
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const disp = document.getElementById("duration-display");
    if (disp) {
      disp.textContent = h > 0
        ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`
        : `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
    }
  },

  renderIdle() {
    const disp = document.getElementById("duration-display");
    if (disp) disp.textContent = "00:00";
  },

  setBtnState(state) {
    const bar = document.querySelector(".sess-timer-bar");
    const btn = document.getElementById("duration-btn");
    if (!btn) return;
    if (state === "running") {
      if (bar) bar.classList.add("running");
      btn.style.display = "none"; // mentre gira, niente bottone (si ferma solo al salvataggio)
    } else {
      if (bar) bar.classList.remove("running");
      btn.innerHTML = '<i class="ti ti-player-play"></i> Avvia';
      btn.style.display = "inline-flex";
    }
  },

  getMinutes() {
    if (!this.startTime) return 0;
    return Math.round((Date.now() - this.startTime) / 60000);
  },

  // Chiamato al salvataggio: ferma e azzera
  finishAndReset() {
    const mins = this.getMinutes();
    this.stopTicking();
    if (this.sessionId) localStorage.removeItem(`gymos_start_${this.sessionId}`);
    this.startTime = null;
    this.renderIdle();
    this.setBtnState("idle");
    return mins;
  },
};

function startDurationTimer() { DurationTimer.start(); }

// ─── TIMER RECUPERO ───
const RestTimer = {
  total:     0,
  remaining: 0,
  interval:  null,
  endAt:     0,        // istante di fine (ms): preciso anche se il browser rallenta i tick
  wakeLock:  null,
  audioCtx:  null,
  _notifAsked: false,
  _scheduled: [],
  _audioScheduled: false,

  openPicker() {
    document.getElementById("rest-picker").style.display = "flex";
  },
  closePicker() {
    document.getElementById("rest-picker").style.display = "none";
  },

  start(seconds) {
    this.closePicker();
    this.total = seconds;
    this.endAt = Date.now() + seconds * 1000;
    this.remaining = seconds;
    document.getElementById("rest-running").style.display = "flex";
    const fab = document.getElementById("rest-fab");
    if (fab) fab.style.visibility = "hidden";   // evita sovrapposizione con la barretta

    // Tieni lo schermo acceso durante il recupero (niente standby, timer preciso)
    this.requestWake();
    // Prepara l'audio durante il tocco dell'utente (così il beep finale suona)
    this.primeAudio();
    // Programma il suono di fine IN ANTICIPO nel motore audio: così squilla
    // all'ora giusta anche a schermo spento (il tick JS lì sarebbe sospeso).
    this.scheduleAlarm(seconds);
    // Chiedi una volta il permesso notifiche (per l'avviso a schermo spento)
    this.ensureNotif();

    this.updateDisplay();
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.remaining = Math.max(0, Math.round((this.endAt - Date.now()) / 1000));
      this.updateDisplay();
      if (Date.now() >= this.endAt) this.finish();
    }, 250);
  },

  addTime(s) {
    this.endAt += s * 1000;
    this.total = Math.max(this.total, Math.round((this.endAt - Date.now()) / 1000));
    this.remaining = Math.round((this.endAt - Date.now()) / 1000);
    this.updateDisplay();
    // riprogramma il suono in base al nuovo istante di fine
    this.scheduleAlarm(Math.round((this.endAt - Date.now()) / 1000));
  },

  // Programma l'allarme sonoro IN ANTICIPO nel WebAudio (suona anche a schermo
  // spento) + un oscillatore "keep-alive" quasi muto che tiene attivo il
  // contesto audio in background, così gli eventi programmati partono davvero.
  scheduleAlarm(secs) {
    this.stopScheduled();
    this._audioScheduled = false;
    try {
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const start = ctx.currentTime + Math.max(0, secs);
      this._scheduled = [];
      // keep-alive: suono sub-udibile fino a poco dopo i rintocchi
      const ka = ctx.createOscillator(), kag = ctx.createGain();
      kag.gain.value = 0.0006; ka.frequency.value = 18;
      ka.connect(kag); kag.connect(ctx.destination);
      ka.start(ctx.currentTime); ka.stop(start + 2);
      this._scheduled.push(ka);
      // 3 rintocchi all'istante di fine (anche a schermo spento)
      this._scheduleBurst(ctx, start).forEach(o => this._scheduled.push(o));
      this._audioScheduled = true;
    } catch (e) { this._audioScheduled = false; }
  },
  stopScheduled() {
    if (this._scheduled) this._scheduled.forEach(o => { try { o.stop(0); } catch (e) {} });
    this._scheduled = [];
    this._audioScheduled = false;
  },

  updateDisplay() {
    const c = document.getElementById("rest-count");
    const m = Math.floor(this.remaining / 60);
    const s = this.remaining % 60;
    if (c) c.textContent = m > 0
      ? `${m}:${s.toString().padStart(2,"0")}`
      : this.remaining;

    const ring = document.getElementById("rest-ring-fg");
    if (ring) {
      const circ = 2 * Math.PI * 54;
      const pct = this.total > 0 ? this.remaining / this.total : 0;
      ring.style.strokeDasharray = circ;
      ring.style.strokeDashoffset = circ * (1 - pct);
      if (pct > 0.5) ring.style.stroke = "#27D17F";
      else if (pct > 0.2) ring.style.stroke = "#F5A623";
      else ring.style.stroke = "#FF3B2F";
    }
  },

  finish() {
    clearInterval(this.interval);
    this.interval = null;
    this.releaseWake();
    document.getElementById("rest-running").style.display = "none";
    const fab = document.getElementById("rest-fab");
    if (fab) fab.style.visibility = "";

    // Avvisi: vibrazione forte + notifica + flash rosso a tutto schermo
    if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]);
    // Il suono è già stato PROGRAMMATO in anticipo (scheduleAlarm) e parte anche
    // a schermo spento; suono dal vivo solo come riserva se la programmazione è
    // fallita (es. audio non sbloccato).
    if (!this._audioScheduled) this.beep();
    this.notify();
    this.showFinished();
  },

  // Flash rosso a tutto schermo finché non lo tocchi (auto-chiude dopo 20s)
  showFinished() {
    const o = document.getElementById("rest-finished");
    if (!o) return;
    o.style.display = "flex";
    clearTimeout(this._finTo);
    this._finTo = setTimeout(() => this.dismissFinished(), 20000);
  },
  dismissFinished() {
    const o = document.getElementById("rest-finished");
    if (o) o.style.display = "none";
    clearTimeout(this._finTo);
    this.stopAlarm();        // zittisce l'allarme dal vivo
    this.stopScheduled();    // e ferma gli eventi sonori programmati rimasti
  },

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.stopAlarm();
    this.stopScheduled();
    this.releaseWake();
    document.getElementById("rest-running").style.display = "none";
    const fab = document.getElementById("rest-fab");
    if (fab) fab.style.visibility = "";
  },

  // ── Wake Lock: schermo acceso durante il recupero ──
  async requestWake() {
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {});
      }
    } catch(e) {}
  },
  releaseWake() {
    try { if (this.wakeLock) { this.wakeLock.release(); this.wakeLock = null; } } catch(e) {}
  },

  // ── Audio: beep finale (preparato durante il tap per evitare blocchi) ──
  primeAudio() {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    } catch(e) {}
  },
  // Suona un singolo "burst" di 3 toni ascendenti (più udibile sopra la musica)
  // 3 rintocchi (toni) a partire dall'istante "base" del contesto audio.
  // Restituisce gli oscillatori creati (per poterli fermare se serve).
  _scheduleBurst(ctx, base) {
    const made = [];
    const tone = (t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = 880;   // rintocco chiaro, costante
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, base + t);
      g.gain.exponentialRampToValueAtTime(0.6, base + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, base + t + 0.34);
      o.start(base + t); o.stop(base + t + 0.36);
      made.push(o);
    };
    tone(0); tone(0.5); tone(1.0);   // 3 rintocchi distinti (~1.3s totali)
    return made;
  },
  // Suono dal vivo (riserva quando l'audio programmato non è disponibile)
  beep() {
    this.stopAlarm();
    try {
      const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      this.audioCtx = ctx;
      this._scheduleBurst(ctx, ctx.currentTime);
    } catch (e) {}
  },
  stopAlarm() {
    if (this._alarmInt) { clearInterval(this._alarmInt); this._alarmInt = null; }
  },

  // ── Notifica (utile se l'app è in secondo piano ma il telefono è acceso) ──
  ensureNotif() {
    try {
      if (this._notifAsked) return;
      this._notifAsked = true;
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch(e) {}
  },
  notify() {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const opts = { body: "Pronto per la prossima serie 💪", icon: "icon-192.png", badge: "icon-192.png",
        vibrate: [300, 120, 300, 120, 500], tag: "gymos-rest", renotify: true };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification("GymOS — Recupero finito!", opts)).catch(() => {
          new Notification("GymOS — Recupero finito!", opts);
        });
      } else {
        new Notification("GymOS — Recupero finito!", opts);
      }
    } catch(e) {}
  },
};

// Riprendi lo schermo acceso se torni sull'app mentre il recupero è in corso
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && RestTimer.interval) {
    RestTimer.requestWake();
    RestTimer.remaining = Math.max(0, Math.round((RestTimer.endAt - Date.now()) / 1000));
    RestTimer.updateDisplay();
    if (Date.now() >= RestTimer.endAt) RestTimer.finish();
  }
});
