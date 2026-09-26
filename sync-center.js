// One place to understand device/network state. No credentials or personal
// content are logged: only timestamps, counters and connection outcomes.
const SyncCenter = {
  KEY:"gymos_sync_status_v1", state:{busy:0,lastOk:null,lastError:null},
  init() {
    try{this.state={...this.state,...JSON.parse(localStorage.getItem(this.KEY)||"{}")}}catch(_){}
    addEventListener("online",()=>{this.render();this.retry(false)});
    addEventListener("offline",()=>this.render());
    this.render();
  },
  persist(){localStorage.setItem(this.KEY,JSON.stringify({lastOk:this.state.lastOk,lastError:this.state.lastError}));},
  start(){this.state.busy++;this.render();},
  success(){this.state.busy=Math.max(0,this.state.busy-1);this.state.lastOk=new Date().toISOString();this.state.lastError=null;this.persist();this.render();},
  failure(message){this.state.busy=Math.max(0,this.state.busy-1);this.state.lastError=String(message||"Errore di rete").slice(0,160);this.persist();this.render();},
  pending(){return Object.keys(localStorage).filter(k=>k.startsWith("gymos_notes_pending_")).length+(localStorage.getItem("gymos_active")?1:0);},
  snapshot(){return {online:navigator.onLine,busy:this.state.busy,pending:this.pending(),lastOk:this.state.lastOk,lastError:this.state.lastError,ai:Boolean(sessionStorage.getItem("gymos_ai_key"))};},
  label(){const s=this.snapshot();if(!s.online)return "Offline";if(s.busy)return "Sincronizzazione…";if(s.pending)return `${s.pending} modifica in attesa`;if(s.lastError)return "Richiede attenzione";return "Tutto sincronizzato";},
  render(){
    const s=this.snapshot(),label=this.label();
    document.querySelectorAll("[data-sync-label]").forEach(el=>el.textContent=label);
    document.querySelectorAll("[data-sync-dot]").forEach(el=>{el.className="sync-dot "+(!s.online||s.lastError?"bad":s.busy||s.pending?"wait":"ok")});
    const panel=document.getElementById("sync-details");if(panel)panel.innerHTML=`
      <div class="sync-row"><span>Rete</span><strong>${s.online?"Online":"Offline"}</strong></div>
      <div class="sync-row"><span>Modifiche in attesa</span><strong>${s.pending}</strong></div>
      <div class="sync-row"><span>Ultimo salvataggio</span><strong>${s.lastOk?new Date(s.lastOk).toLocaleString("it-IT"):"Non ancora verificato"}</strong></div>
      <div class="sync-row"><span>Coach AI</span><strong>${s.ai?"Collegato in questa sessione":"Non collegato"}</strong></div>
      ${s.lastError?`<div class="sync-error">${U.escape(s.lastError)}</div>`:""}`;
  },
  open(){const d=document.getElementById("sync-center");if(!d)return;this.render();d.showModal();},
  close(){document.getElementById("sync-center")?.close();},
  async retry(showToast=true){
    if(!navigator.onLine){if(showToast)U.toast("Sei offline: riproverò automaticamente","info");return false;}
    const btn=document.getElementById("sync-retry");if(btn)btn.disabled=true;
    try{await Notes.retry();const ok=await API.testConnection();if(!ok)throw Error("Notion non raggiungibile");this.success();if(showToast)U.toast("Sincronizzazione completata","ok");return true;}
    catch(e){this.failure(e.message);if(showToast)U.toast("Sincronizzazione non completata","err");return false;}
    finally{if(btn)btn.disabled=false;this.render();}
  },
};
