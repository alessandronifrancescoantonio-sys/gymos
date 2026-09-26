// Weekly planning and planned-vs-actual comparison. Uses the existing Notion
// Weekly Planner database: no extra schema or mesocycle concept is introduced.
const Planning = {
  offset:0, tasks:[], sessions:[],
  iso(date) { const p=n=>String(n).padStart(2,"0"); return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`; },
  bounds(offset=this.offset) {
    const now=new Date(), monday=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    monday.setDate(monday.getDate()-((monday.getDay()+6)%7)+(offset*7));
    const sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
    return {start:this.iso(monday),end:this.iso(sunday),monday,sunday};
  },
  isWorkout(task) { return /allen|pesi|sessione|scheda|workout/i.test(`${task.type||""} ${task.name||""}`); },
  actualForWeek(sessions,bounds) { return (sessions||[]).filter(s=>s.done&&s.date>=bounds.start&&s.date<=bounds.end); },
  metrics(tasks,sessions,bounds=this.bounds()) {
    const planned=(tasks||[]).filter(t=>this.isWorkout(t));
    const actual=this.actualForWeek(sessions,bounds);
    const plannedDone=planned.filter(t=>t.done).length;
    const target=planned.length || Object.keys(CONFIG.SCHEDE||{}).length;
    return {planned:target,checked:plannedDone,actual:actual.length,adherence:target?Math.min(100,Math.round(actual.length/target*100)):0};
  },
  async load(offset=this.offset) {
    this.offset=offset; const b=this.bounds();
    const [tasks,sessions]=await Promise.all([API.getPlannerTasks(b.start,b.end),API.getWorkoutSessions(160)]);
    this.tasks=tasks;this.sessions=sessions;this.render();
  },
  shift(delta) { return this.load(this.offset+delta).catch(()=>U.toast("Calendario non aggiornato: riprova","err")); },
  render() {
    const host=document.getElementById("calendar-week"); if(!host)return;
    const b=this.bounds(), today=U.today();
    const label=document.getElementById("calendar-range");
    if(label)label.textContent=`${U.fmtDate(b.start)} – ${U.fmtDate(b.end)}`;
    const names=["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
    host.innerHTML="";
    for(let i=0;i<7;i++){
      const d=new Date(b.monday);d.setDate(d.getDate()+i);const iso=this.iso(d);
      const tasks=this.tasks.filter(t=>t.date===iso), sessions=this.sessions.filter(s=>s.done&&s.date===iso);
      const day=document.createElement("section");day.className="calendar-day"+(iso===today?" today":"" );
      const entries=[...tasks.map(t=>`<div class="calendar-entry${t.done?" done":""}"><button type="button" class="calendar-toggle" data-id="${U.escape(t.id)}" aria-pressed="${t.done}"><i class="ti ${t.done?"ti-circle-check-filled":"ti-circle"}"></i></button><span><b>${U.escape(t.name)}</b><small>${U.escape(t.type||"Attività")}</small></span><button type="button" class="calendar-delete" data-id="${U.escape(t.id)}" aria-label="Elimina ${U.escape(t.name)}"><i class="ti ti-x"></i></button></div>`),
        ...sessions.map(s=>`<div class="calendar-entry actual"><i class="ti ti-barbell"></i><span><b>${U.escape(s.name)}</b><small>Allenamento registrato</small></span></div>` )];
      day.innerHTML=`<header><span>${names[i]}</span><strong>${d.getDate()}</strong></header><div class="calendar-entries">${entries.join("")||'<span class="calendar-empty">Libero</span>'}</div>`;
      host.appendChild(day);
    }
    host.querySelectorAll(".calendar-toggle").forEach(btn=>btn.addEventListener("click",()=>this.toggle(btn.dataset.id)));
    host.querySelectorAll(".calendar-delete").forEach(btn=>btn.addEventListener("click",()=>this.remove(btn.dataset.id)));
    this.renderComparison();
    const date=document.getElementById("calendar-date");if(date&&!date.value)date.value=today;
  },
  renderComparison() {
    const host=document.getElementById("calendar-comparison");if(!host)return;
    const m=this.metrics(this.tasks,this.sessions);
    host.innerHTML=`<div><strong>${m.planned}</strong><span>programmate</span></div><div><strong>${m.actual}</strong><span>eseguite</span></div><div><strong>${m.adherence}%</strong><span>aderenza</span></div>`;
  },
  async add() {
    const name=document.getElementById("calendar-name")?.value.trim();
    const date=document.getElementById("calendar-date")?.value;
    const type=document.getElementById("calendar-type")?.value||"Allenamento";
    if(!name||!date){U.toast("Inserisci attività e data","err");return;}
    const btn=document.getElementById("calendar-add");if(btn)btn.disabled=true;
    try { await API.createPlannerTask({name,date,type});document.getElementById("calendar-name").value="";await this.load(this.offset);U.toast("Attività pianificata","ok"); }
    catch(_){U.toast("Attività non salvata: riprova","err");}
    finally{if(btn)btn.disabled=false;}
  },
  async toggle(id) {
    const task=this.tasks.find(t=>t.id===id);if(!task)return;const before=task.done;task.done=!before;this.render();
    try{await API.completeTask(id,task.done);}catch(_){task.done=before;this.render();U.toast("Modifica non salvata","err");}
  },
  async remove(id) {
    if(!await U.confirm("Eliminare questa attività dal calendario?",{okText:"Elimina",danger:true}))return;
    const before=this.tasks.slice();this.tasks=this.tasks.filter(t=>t.id!==id);this.render();
    try{await API.deletePlannerTask(id);U.toast("Attività eliminata","ok");}catch(_){this.tasks=before;this.render();U.toast("Eliminazione non riuscita","err");}
  },
  nextWorkout(tasks,sessions) {
    const today=U.today();
    const planned=(tasks||[]).filter(t=>!t.done&&t.date>=today&&this.isWorkout(t)).sort((a,b)=>a.date.localeCompare(b.date))[0];
    if(planned)return {title:planned.name,meta:planned.date===today?"Pianificata per oggi":`Pianificata ${U.fmtDate(planned.date)}`,source:"planner"};
    const names=Object.keys(CONFIG.SCHEDE||{});if(!names.length)return null;
    const completed=(sessions||[]).filter(s=>s.done).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
    const idx=completed?names.findIndex(n=>n===(completed.type||completed.name)):-1;
    const title=names[(idx+1+names.length)%names.length];
    return {title,meta:"Prossima seduta del programma attivo",source:"program"};
  },
};
