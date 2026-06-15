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

  openPicker() {
    document.getElementById("rest-picker").style.display = "flex";
  },
  closePicker() {
    document.getElementById("rest-picker").style.display = "none";
  },

  start(seconds) {
    this.closePicker();
    this.total = seconds;
    this.remaining = seconds;
    document.getElementById("rest-running").style.display = "flex";
    this.updateDisplay();
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.remaining--;
      this.updateDisplay();
      if (this.remaining <= 0) this.finish();
    }, 1000);
  },

  addTime(s) {
    this.remaining += s;
    this.total = Math.max(this.total, this.remaining);
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
      const pct = this.remaining / this.total;
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
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    const overlay = document.getElementById("rest-running");
    overlay.classList.add("rest-done-flash");
    setTimeout(() => {
      overlay.classList.remove("rest-done-flash");
      overlay.style.display = "none";
    }, 700);
  },

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    document.getElementById("rest-running").style.display = "none";
  },
};
