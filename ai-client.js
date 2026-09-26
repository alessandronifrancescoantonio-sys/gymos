// The private key is entered by the owner and held only in this tab session.
const AIClient = {
  async fetch(url, options = {}) {
    const send = () => {
      const headers = new Headers(options.headers);
      const key = sessionStorage.getItem("gymos_ai_key");
      if (key) headers.set("Authorization", "Bearer " + key);
      return fetch(url, { ...options, headers });
    };
    const response = await send();
    if ([401,503].includes(response.status) && !this._warned) {
      this._warned = true;
      U.toast(response.status === 401 ? "Coach AI: collega la chiave personale dal menu Altro" : "Coach AI: accesso privato non ancora configurato sul server", "info", 6000);
    }
    return response;
  },
  async configure() {
    const key = await U.prompt("Chiave personale per il coach AI", { okText:"Collega", type:"password" });
    if (!key) return;
    sessionStorage.setItem("gymos_ai_key", key.trim());
    try {
      const response = await this.fetch(CONFIG.AI_WORKER_URL + "/science-proposals", { signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Accesso non riuscito (" + response.status + ")");
      this._warned = false;
      U.toast("Coach collegato per questa sessione del browser", "ok");
    } catch (error) {
      sessionStorage.removeItem("gymos_ai_key");
      U.toast(error.message || "Collegamento non riuscito", "err");
    }
  },
};
