const ProgressPhotos = {
  DBN: "gymos-photos", STORE: "photos", _db: null,
  POSE: { front: "Fronte", side: "Lato", back: "Schiena" },
  _filter: "all", _compare: false, _cmpA: null, _cmpB: null, _pending: null, _urls: [], _cardUrls: [],

  // Wrapper Promise-based su IndexedDB (idb di Jake Archibald), caricato con
  // import() dinamico: gli script dell'app sono classici (non type="module",
  // altrimenti le variabili top-level smetterebbero di essere globali per
  // session.js/app.js), ma import() dinamico funziona ovunque.
  _open() {
    if (this._db) return Promise.resolve(this._db);
    if (!this._openPromise) {
      this._openPromise = import("./vendor/idb.js")
        .then(({ openDB }) => openDB(this.DBN, 1, {
          upgrade: db => { if (!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE, { keyPath: "id" }); },
        }))
        .then(db => { this._db = db; return db; })
        // Fallimento (es. CDN irraggiungibile offline al primo uso): NON
        // cache-are la promise rigettata, altrimenti ogni operazione foto
        // resterebbe rotta fino al reload anche una volta tornati online.
        .catch(e => { this._openPromise = null; throw e; });
    }
    return this._openPromise;
  },
  async _all() { const db = await this._open(); return db.getAll(this.STORE); },
  async _put(rec) { const db = await this._open(); return db.put(this.STORE, rec); },
  async _del(id) { const db = await this._open(); return db.delete(this.STORE, id); },
  async _get(id) { const db = await this._open(); return db.get(this.STORE, id); },

  // Data LOCALE (YYYY-MM-DD): evita l'off-by-one del fuso orario di toISOString()
  _localDate(d) { d = d || new Date(); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); },
  // Punto, non virgola: stesso stile di U.fmt (kg/e1RM/rep) usato ovunque
  // nell'app — il peso corporeo qui mostrava "74,3 kg" mentre la Dashboard
  // mostra "74.3 kg" per lo stesso identico dato.
  _fmtW(w) { return (w == null) ? "" : String(w) + " kg"; },
  // Ultimo peso registrato nei check-in corporei (per pre-compilare)
  _latestWeight() {
    try {
      if (typeof Body === "undefined" || !Body.checkins) return null;
      const w = Body.checkins.filter(c => c.peso != null && c.peso > 0);
      return w.length ? w[w.length - 1].peso : null;   // checkins ordinati per data crescente
    } catch (e) { return null; }
  },
  // Chiede il peso da abbinare alla foto (facoltativo), con anteprima
  _askWeight(previewUrl, pose) {
    return new Promise(resolve => {
      let el = document.getElementById("ph-confirm");
      if (!el) { el = document.createElement("div"); el.id = "ph-confirm"; el.className = "ph-confirm"; document.body.appendChild(el); }
      const pre = this._latestWeight();
      el.innerHTML = `
        <div class="ph-confirm-box">
          <div class="ph-confirm-head"><i class="ti ti-camera"></i> ${this.POSE[pose]} · oggi</div>
          <img class="ph-confirm-img" src="${previewUrl}" alt="">
          <label class="ph-confirm-lbl">Peso di oggi (kg) — facoltativo</label>
          <input class="ph-confirm-inp" id="ph-w-inp" type="number" inputmode="decimal" step="0.1" min="0" placeholder="es. 78.5" value="${pre != null ? pre : ""}">
          <div class="ph-confirm-btns">
            <button class="btn-primary" id="ph-w-save"><i class="ti ti-check"></i> Salva foto</button>
            <button class="btn-cancel" id="ph-w-skip">Senza peso</button>
          </div>
        </div>`;
      el.style.display = "flex";
      const done = w => { el.style.display = "none"; resolve(w); };
      el.querySelector("#ph-w-save").onclick = () => { const v = parseFloat(el.querySelector("#ph-w-inp").value); done(isNaN(v) || v <= 0 ? null : Math.round(v * 10) / 10); };
      el.querySelector("#ph-w-skip").onclick = () => done(null);
      el.onclick = e => { if (e.target === el) done(null); };
      setTimeout(() => { const i = el.querySelector("#ph-w-inp"); if (i) i.focus(); }, 60);
    });
  },
  _url(blob, bucket) { const u = URL.createObjectURL(blob); (bucket === "card" ? this._cardUrls : this._urls).push(u); return u; },
  _revoke(bucket) {
    const arr = bucket === "card" ? this._cardUrls : this._urls;
    arr.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    if (bucket === "card") this._cardUrls = []; else this._urls = [];
  },

  // Ridimensiona (max 1280px) e comprime in JPEG. Tripla via robusta perché
  // una foto dal telefono si salvi SEMPRE: createImageBitmap → <img> → dataURL.
  async _process(file) {
    let src = null, w0 = 0, h0 = 0;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w0 = src.width; h0 = src.height; }
    catch (e) { try { src = await createImageBitmap(file); w0 = src.width; h0 = src.height; } catch (e2) { src = null; } }
    if (!src) {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("img")); im.src = dataUrl; });
      w0 = src.naturalWidth; h0 = src.naturalHeight;
    }
    const max = 1280, sc = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(src, 0, 0, w, h);
    let blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
    if (!blob) {   // fallback estremo: dataURL → Blob
      const durl = cv.toDataURL("image/jpeg", 0.85), bin = atob(durl.split(",")[1]), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: "image/jpeg" });
    }
    if (src && src.close) { try { src.close(); } catch (e) {} }
    return { blob, w, h };
  },

  pick(pose) { this._pending = pose; const inp = document.getElementById("photo-file"); if (inp) { inp.value = ""; inp.click(); } },
  async onFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { if (typeof U !== "undefined") U.toast("Serve un'immagine", "err"); return; }
    const pose = this._pending || "front"; this._pending = null;
    try {
      const { blob, w, h } = await this._process(file);
      // chiedi il peso da abbinare (facoltativo), con anteprima
      const previewUrl = URL.createObjectURL(blob);
      const weight = await this._askWeight(previewUrl, pose);
      try { URL.revokeObjectURL(previewUrl); } catch (e) {}
      const now = new Date();
      const rec = { id: "p" + Date.now() + Math.floor(Math.random() * 1000), date: this._localDate(now), ts: now.getTime(), pose, blob, w, h, weight: weight };
      await this._put(rec);
      const check = await this._get(rec.id);          // verifica reale della scrittura
      if (!check || !check.blob) throw new Error("non salvata");
      if (typeof U !== "undefined") U.toast("Foto salvata 📸", "ok");
      this.renderCard();
      const ov = document.getElementById("photos-overlay");
      if (ov && ov.style.display === "flex") this.renderOverlay();
    } catch (e) { console.error("photo add:", e); if (typeof U !== "undefined") U.toast("Foto non caricata — riprova", "err"); }
  },

  _ts(r) { return r.ts || (r.date ? new Date(r.date).getTime() : 0); },
  _day(r) { return (r.date || "").split("T")[0]; },

  async renderCard() {
    const wrap = document.getElementById("photos-card"); if (!wrap) return;
    this._revoke("card");
    const all = await this._all().catch(() => []);
    const latest = ["front", "side", "back"]
      .map(p => all.filter(x => x.pose === p).sort((a, b) => this._ts(b) - this._ts(a))[0]).filter(Boolean);
    const thumbs = latest.length
      ? latest.map(r => `<div class="ph-thumb"><img src="${this._url(r.blob, "card")}" alt=""><span>${this.POSE[r.pose]}</span></div>`).join("")
      : `<div class="ph-empty">Nessuna foto. Aggiungi la prima da una posa qui sotto 👇</div>`;
    wrap.innerHTML = `
      <div class="card-title"><i class="ti ti-camera"></i>Foto progressi ${all.length ? `<span class="ph-count">${all.length}</span>` : ""}
        <button class="vol-edit-btn" onclick="ProgressPhotos.openGallery()"><i class="ti ti-photo"></i> Galleria</button>
      </div>
      <div class="ph-latest">${thumbs}</div>
      <div class="ph-add-row">
        <button class="ph-add" onclick="ProgressPhotos.pick('front')"><i class="ti ti-plus"></i> Fronte</button>
        <button class="ph-add" onclick="ProgressPhotos.pick('side')"><i class="ti ti-plus"></i> Lato</button>
        <button class="ph-add" onclick="ProgressPhotos.pick('back')"><i class="ti ti-plus"></i> Schiena</button>
      </div>
      <div class="ph-note"><i class="ti ti-lock"></i> Le foto restano solo sul tuo telefono, private.</div>`;
  },

  openGallery() { const o = document.getElementById("photos-overlay"); if (!o) return; o.style.display = "flex"; this.renderOverlay(); },
  closeGallery(ev) { if (ev && ev.target !== ev.currentTarget) return; const o = document.getElementById("photos-overlay"); if (o) o.style.display = "none"; this._revoke(); this._compare = false; },
  setFilter(k) { this._filter = k; this.renderOverlay(); },
  toggleCompare() { this._compare = !this._compare; if (this._compare && this._filter === "all") this._filter = "front"; this.renderOverlay(); },

  async renderOverlay() {
    const tabsEl = document.getElementById("ph-tabs"), gal = document.getElementById("ph-gallery");
    if (!tabsEl || !gal) return;
    this._revoke();
    const all = (await this._all().catch(() => [])).sort((a, b) => this._ts(b) - this._ts(a));
    const poses = [["all", "Tutte"], ["front", "Fronte"], ["side", "Lato"], ["back", "Schiena"]];
    tabsEl.innerHTML = poses.map(([k, l]) => `<button class="ph-chip${this._filter === k ? " on" : ""}" onclick="ProgressPhotos.setFilter(${U.arg(k)})">${l}</button>`).join("")
      + `<button class="ph-chip ph-cmp${this._compare ? " on" : ""}" onclick="ProgressPhotos.toggleCompare()"><i class="ti ti-arrows-diff"></i> Confronta</button>`;
    const list = this._filter === "all" ? all : all.filter(x => x.pose === this._filter);
    if (this._compare) { gal.innerHTML = this._compareHTML(list); return; }
    if (!list.length) { gal.innerHTML = `<div class="empty-state">Nessuna foto${this._filter !== "all" ? " per questa posa" : ""}.</div>`; return; }
    const groups = {};
    list.forEach(r => { const d = this._day(r); (groups[d] = groups[d] || []).push(r); });
    gal.innerHTML = Object.keys(groups).map(d => `
      <div class="ph-day">
        <div class="ph-day-h">${U.fmtDate(d)}</div>
        <div class="ph-grid">${groups[d].map(r => `
          <button class="ph-cell" onclick="ProgressPhotos.view(${U.arg(r.id)})">
            <img src="${this._url(r.blob)}" alt="" loading="lazy">
            <span class="ph-cell-pose">${this.POSE[r.pose]}</span>
            ${r.weight ? `<span class="ph-cell-w">${this._fmtW(r.weight)}</span>` : ""}
          </button>`).join("")}</div>
      </div>`).join("");
  },

  _compareHTML(list) {
    if (list.length < 2) return `<div class="empty-state">Servono almeno 2 foto${this._filter === "all" ? " — scegli una posa per un confronto pulito" : " di questa posa"}.</div>`;
    const chron = [...list].sort((a, b) => this._ts(a) - this._ts(b));
    if (!this._cmpA || !chron.find(x => x.id === this._cmpA)) this._cmpA = chron[0].id;
    if (!this._cmpB || !chron.find(x => x.id === this._cmpB)) this._cmpB = chron[chron.length - 1].id;
    const A = chron.find(x => x.id === this._cmpA), B = chron.find(x => x.id === this._cmpB);
    const opt = sel => chron.map(r => `<option value="${r.id}"${r.id === sel ? " selected" : ""}>${U.fmtDate(this._day(r))}</option>`).join("");
    const col = (ph, which, lbl) => `
      <div class="ph-cmp-col">
        <div class="ph-cmp-tag">${lbl}</div>
        <div class="ph-cmp-imgwrap">
          <img src="${this._url(ph.blob)}" alt="">
          ${ph.weight ? `<span class="ph-wtag">${this._fmtW(ph.weight)}</span>` : ""}
        </div>
        <div class="ph-cmp-cap">${U.fmtDate(this._day(ph))}${ph.weight ? ` · <b>${this._fmtW(ph.weight)}</b>` : ""}</div>
        <select class="ph-cmp-sel" onchange="ProgressPhotos._cmp${which}=this.value;ProgressPhotos.renderOverlay()">${opt(which === "A" ? this._cmpA : this._cmpB)}</select>
      </div>`;
    return `<div class="ph-compare">${col(A, "A", "Prima")}${col(B, "B", "Dopo")}</div>`;
  },

  async view(id) {
    const all = await this._all(); const r = all.find(x => x.id === id); if (!r) return;
    let v = document.getElementById("ph-viewer");
    if (!v) { v = document.createElement("div"); v.id = "ph-viewer"; v.className = "ph-viewer"; document.body.appendChild(v); }
    const url = this._url(r.blob);
    v.innerHTML = `
      <div class="ph-viewer-bar">
        <span>${U.fmtDate(this._day(r))} · ${this.POSE[r.pose]}${r.weight ? ` · ${this._fmtW(r.weight)}` : ""}</span>
        <div class="ph-vbtns">
          <a class="ph-vbtn" href="${url}" download="gymos-${r.pose}-${r.date.split("T")[0]}.jpg" title="Scarica"><i class="ti ti-download"></i></a>
          <button class="ph-vbtn" onclick="ProgressPhotos.del(${U.arg(r.id)}, this)" title="Elimina"><i class="ti ti-trash"></i></button>
          <button class="ph-vbtn" onclick="ProgressPhotos.closeViewer()" title="Chiudi"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <img class="ph-viewer-img" src="${url}" alt="">`;
    v.style.display = "flex";
  },
  closeViewer() { const v = document.getElementById("ph-viewer"); if (v) v.style.display = "none"; },
  del(id, btn) {
    if (btn && btn.dataset.armed !== "1") {
      btn.dataset.armed = "1"; btn.classList.add("armed"); btn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { if (btn) { btn.dataset.armed = "0"; btn.classList.remove("armed"); btn.innerHTML = '<i class="ti ti-trash"></i>'; } }, 3000);
      return;
    }
    this._del(id).then(() => {
      this.closeViewer();
      const ov = document.getElementById("photos-overlay");
      if (ov && ov.style.display === "flex") this.renderOverlay();
      this.renderCard();
      if (typeof U !== "undefined") U.toast("Foto eliminata", "ok");
    }).catch(e => { console.error("photo del:", e); if (typeof U !== "undefined") U.toast("Eliminazione fallita", "err"); });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  RECUPERO — feedback di indolenzimento (DOMS) e stato per muscolo
//
//  QUANDO si chiede, e perché: a INIZIO seduta, non a fine. I DOMS crescono
//  24-48h DOPO l'allenamento: chiederli mentre esci dalla palestra non
//  misurerebbe niente. La domanda giusta è "come stavi arrivando qui oggi?",
//  ed è esattamente il segnale che serve per decidere il volume (Israetel:
//  l'indolenzimento residuo all'inizio della sessione t+1 è il marcatore
//  pratico di volume oltre la capacità di recupero).
//
//  Tre stati, non una scala 1-10: una scala fine darebbe falsa precisione su
//  una sensazione grossolana, e nessuno la compila davvero ogni volta.
//  Salvato ON-DEVICE (come foto e note esercizio): nessun cambio di schema Notion.
// ═══════════════════════════════════════════════════════════════════════════
