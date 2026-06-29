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

    // Avvisi: vibrazione forte + suono + notifica + flash rosso a tutto schermo
    if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]);
    this.beep();
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
    this.stopAlarm();   // toccando lo schermo si zittisce l'allarme
  },

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.stopAlarm();
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
  _burst() {
    try {
      const ctx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      this.audioCtx = ctx;
      const tone = (t, f) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;   // triangle = più ricco/percepibile
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + t + 0.02);   // volume più alto
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.30);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.31);
      };
      tone(0, 880); tone(0.22, 1100); tone(0.44, 1320);
    } catch(e) {}
  },
  // Allarme ripetuto: continua a suonare/vibrare finché non si tocca lo schermo
  // (max ~20s di sicurezza), così non lo si perde quando ci si allena con la musica.
  beep() {
    this.stopAlarm();
    this._alarmStart = Date.now();
    this._burst();
    this._alarmInt = setInterval(() => {
      if (Date.now() - this._alarmStart > 20000) { this.stopAlarm(); return; }
      this._burst();
      if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
    }, 1500);
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
