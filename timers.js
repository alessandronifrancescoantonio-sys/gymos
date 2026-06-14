// ═══════════════════════════════════════════════
//  GymOS — timers.js
//  Timer durata sessione + timer recupero
// ═══════════════════════════════════════════════

// ─── TIMER DURATA SESSIONE ───
const DurationTimer = {
  startTime: null,
  interval:  null,

  start(sessionId) {
    // Recupera start salvato per questa sessione, o inizia ora
    const saved = localStorage.getItem(`gymos_start_${sessionId}`);
    if (saved) {
      this.startTime = parseInt(saved);
    } else {
      this.startTime = Date.now();
      localStorage.setItem(`gymos_start_${sessionId}`, this.startTime);
    }
    this.tick();
    clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), 1000);
  },

  tick() {
    if (!this.startTime) return;
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const disp = document.getElementById("duration-display");
    if (disp) disp.textContent =
      `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
  },

  getMinutes() {
    if (!this.startTime) return 0;
    return Math.round((Date.now() - this.startTime) / 60000);
  },

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  },

  reset(sessionId) {
    localStorage.removeItem(`gymos_start_${sessionId}`);
    this.startTime = null;
  },
};

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

    // Anello progressivo
    const ring = document.getElementById("rest-ring-fg");
    if (ring) {
      const circ = 2 * Math.PI * 54;
      const pct = this.remaining / this.total;
      ring.style.strokeDasharray = circ;
      ring.style.strokeDashoffset = circ * (1 - pct);
      // colore: verde → ambra → rosso man mano che scende
      if (pct > 0.5) ring.style.stroke = "#27D17F";
      else if (pct > 0.2) ring.style.stroke = "#F5A623";
      else ring.style.stroke = "#FF3B2F";
    }
  },

  finish() {
    clearInterval(this.interval);
    this.interval = null;
    // Vibrazione breve
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    // Flash visivo veloce
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
