// Isolated browser regression runner. No requests reach Notion or Gemini.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
let pw; try{pw=require('playwright')}catch(_){pw=require('C:/Users/Utente/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')}
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await pw.chromium.launch({...(process.platform==='win32'?{channel:'msedge'}:{}),headless:true});
 try{
 const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  if(!route.request().url().startsWith(base))return route.abort();
  if(new URL(route.request().url()).pathname==='/app.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'app.js'),'utf8')+'\nApp.init=async()=>{};'});
  return route.continue();
 });
 await page.goto(base+'/tests.html'); assert.match(await page.locator('#summary').innerText(),/Tutti i 81 test passati/);console.log('PASS 81 existing engine tests');
 await page.goto(base);
 await page.evaluate(()=>{
  document.getElementById('loading').style.display='none';App.setupNav();Accessibility.init();
  window.realDashboardLoad=Dashboard.load.bind(Dashboard);
  window.realRecoveryRender=Recovery.renderCard.bind(Recovery);
  for(const obj of [Dashboard,Session,Cardio,Progression,Body,Diary,Schede,ScienceUpdates,PredictiveCoach])obj.load=async()=>{};
  WeeklyReport.loadHistory=async()=>{};
  Dashboard.buildWeekSplit([]);
 });
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:800});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  assert.equal(overflow,false,'overflow at '+width);
 }
 console.log('PASS viewport overflow 320/390/768/1280');
 await page.setViewportSize({width:320,height:800});
 for(const name of ['Report','Scienza']){await page.getByRole('button',{name:'Altro',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('.page.active').getAttribute('id'),name==='Report'?'page-report':'page-science')}
 console.log('PASS mobile Report and Science navigation');
 await page.evaluate(async()=>{
  App.navigate('calendar');
  const b=Planning.bounds(0);
  API.getPlannerTasks=async()=>[{id:'p1',name:'Full Body 1',date:U.today(),type:'Allenamento',done:false}];
  API.getWorkoutSessions=async()=>[{id:'s1',name:'Full Body 1',date:U.today(),done:true}];
  await Planning.load(0);
  if(document.querySelectorAll('.calendar-day').length!==7)throw Error('Calendar does not render seven days');
  if(!document.getElementById('calendar-comparison').innerText.includes('100%'))throw Error('Planned versus actual mismatch');
  SyncCenter.init();if(!document.querySelector('[data-sync-label]').textContent)throw Error('Sync status missing');
 });
 console.log('PASS weekly planning, planned-vs-actual and sync status');
 await page.evaluate(async()=>{
  const today=U.today();
  API.getWorkoutSessions=async()=>[{id:'home-s1',name:'Full Body 1',date:today,done:true}];
  API.getBodyMetrics=async()=>[];API.getRecentSleep=async()=>[{ore:7.5}];API.getRecentHabits=async()=>[];API.getTodayHabit=async()=>null;
  API.getPlannerTasks=async(start,end)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('Invalid planner range');return [{id:'home-p1',name:'Full Body 1',date:today,type:'Allenamento',done:false}]};
  API.getTodayTasks=async()=>[];
  Volume.renderCard=()=>{};Volume.loadActual=()=>{};Recovery.renderCard=()=>{};JointLog.renderCard=()=>{};PatternBalance.renderCard=()=>{};Coach.renderAll=()=>{};WeeklyReport.checkAndGenerate=()=>{};
  await window.realDashboardLoad();
  if(document.getElementById('home-focus').innerText.includes('Preparazione'))throw Error('Home remained in loading state');
  if(!document.getElementById('home-focus').innerText.includes('completato'))throw Error('Home focus was not rendered');
  if(document.getElementById('planner-list').innerText.includes('Caricamento'))throw Error('Home planner remained in loading state');
 });
 console.log('PASS full Home load renders valid weekly dates and leaves no loading placeholders');
 await page.evaluate(()=>{
  Dashboard.buildChecklist([]);
  const empty=document.querySelector('#planner-list .planner-empty');
  if(!empty||!empty.innerText.includes('Pianifica'))throw Error('Planner empty state has no recovery action');
  Dashboard.buildChecklist([], 'error');
  if(!document.getElementById('planner-list').innerText.includes('non disponibile'))throw Error('Planner network failure looks like empty data');
  Dashboard.renderDataHealth(new Set(['planner']));
  if(document.getElementById('home-data-warning').hidden)throw Error('Partial data warning is hidden');
  Dashboard.renderDataHealth(new Set());
  localStorage.removeItem(Recovery.KEY);
  const muscles=Volume.MUSCLES;Volume.MUSCLES=['Spalle'];Volume._actualDir={Spalle:8};
  const latestFresh=Recovery.latestFresh;Recovery.latestFresh=()=>null;
  window.realRecoveryRender([],[],[]);
  Recovery.latestFresh=latestFresh;Volume.MUSCLES=muscles;
  const recovery=document.getElementById('dash-recovery');
  if(!recovery.querySelector('.recovery-empty')||recovery.querySelectorAll('.rmap-row').length)throw Error('Recovery renders misleading no-data rows');
 });
 console.log('PASS compact actionable empty states for Planner and Recovery');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{
  App.navigate('session');document.body.classList.remove('sess-landing','session-view');
  document.getElementById('bn-save').classList.add('show');
  App.syncBottomBarHeight();
  document.getElementById('rest-running').style.display='flex';
 });
 const timerLayout=await page.evaluate(()=>{const rect=e=>e.getBoundingClientRect();const t=rect(document.getElementById('rest-running')),n=rect(document.getElementById('bottom-nav'));return {timerBottom:t.bottom,navTop:n.top,timerZ:+getComputedStyle(document.getElementById('rest-running')).zIndex,navZ:+getComputedStyle(document.getElementById('bottom-nav')).zIndex}});
 assert.ok(timerLayout.timerBottom<=timerLayout.navTop,'active timer overlaps mobile navigation');
 assert.ok(timerLayout.timerZ>timerLayout.navZ,'active timer is behind mobile navigation');
 await page.evaluate(()=>{
  document.getElementById('rest-running').style.display='none';
  RestTimer.requestWake=async()=>{};RestTimer.releaseWake=()=>{};RestTimer.primeAudio=()=>{};
  RestTimer.scheduleAlarm=()=>{};RestTimer.ensureNotif=()=>{};RestTimer._mediaStart=()=>{};RestTimer.notify=()=>{};
  RestTimer.start(90);
 });
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(RestTimer.STORAGE_KEY)).state),'running','rest timer was not persisted');
 await page.locator('#rest-running .rest-stop').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(RestTimer.STORAGE_KEY)).state),'running','one accidental stop tap cancelled the timer');
 assert.match(await page.locator('#rest-running .rest-stop').innerText(),/Conferma/,'stop confirmation was not armed');
 await page.evaluate(()=>App.navigate('dashboard'));
 assert.equal(await page.locator('#rest-running').isVisible(),true,'rest timer disappeared after page navigation');
 await page.evaluate(()=>{
  RestTimer.endAt=Date.now()+42000;RestTimer.total=90;RestTimer._saveRunning();
  clearInterval(RestTimer.interval);RestTimer.interval=null;RestTimer.endAt=0;RestTimer.total=0;RestTimer.remaining=0;
  document.getElementById('rest-running').style.display='none';RestTimer.restore();
 });
 const restored=await page.evaluate(()=>({visible:getComputedStyle(document.getElementById('rest-running')).display!=='none',remaining:RestTimer.remaining,running:!!RestTimer.interval}));
 assert.ok(restored.visible&&restored.running&&restored.remaining>=40&&restored.remaining<=42,'rest timer did not resume after reload/suspension');
 await page.evaluate(()=>{
  clearInterval(RestTimer.interval);RestTimer.interval=null;
  localStorage.setItem(RestTimer.STORAGE_KEY,JSON.stringify({v:1,state:'running',total:90,endAt:Date.now()-1000}));
  RestTimer.endAt=0;RestTimer.total=0;RestTimer.remaining=0;RestTimer.restore();
 });
 assert.equal(await page.locator('#rest-finished').isVisible(),true,'expired timer was silently discarded');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(RestTimer.STORAGE_KEY)).state),'finished','finished state was not retained');
 await page.evaluate(()=>{RestTimer.dismissFinished();document.getElementById('bn-save').classList.remove('show');App.navigate('dashboard')});
 assert.equal(await page.evaluate(()=>localStorage.getItem(RestTimer.STORAGE_KEY)),null,'dismissed timer state was not cleared');
 console.log('PASS active rest timer stays visible above session navigation');
 console.log('PASS rest timer survives navigation, reload, suspension and expired-state recovery');
 await page.evaluate(()=>{
  App.navigate('session');document.getElementById('page-session').classList.remove('session-empty');document.body.classList.remove('sess-landing');
  Session.activeId='test';Session.sessions=[{id:'test',date:'2026-09-26',name:'Test',type:'Test'}];Session.viewMode=false;Session.sessionDone=false;
  Session.exercises=[
   {id:'set1',name:`Farmer's walk – Test – S1`,kg:20,reps:8,rrMin:8,rrMax:12},
   {id:'set2',name:`Farmer's walk – Test – S2`,kg:20,reps:0,rrMin:8,rrMax:12}
  ];Session.exOrder=[`Farmer's walk`];Session.prevExercises=[];Session._done=new Set();Session._prSets=new Set();
  Session._prevExerciseNotes={[`Farmer's walk`]:'Presa stretta'};Session.renderExercises();
  document.getElementById('sess-title').textContent='Seduta di prova';
  Session.addSet=name=>{window.clickedExercise=name};
  API.call=async()=>({properties:{[CONFIG.PROPS.WL_NOTE]:{rich_text:[]}}});API.update=async()=>({});
 });
 // Click the exercise label: the header also contains editable inputs, so its
 // geometric centre changes across responsive themes and isn't a stable target.
 await page.locator('.ex-name').click();
 assert.equal(await page.locator('.ex-block').evaluate(el=>el.classList.contains('collapsed')),false,'exercise did not open');
 // Una pressione lenta sull'header non deve più essere scambiata per drag.
 const headerBox=await page.locator('.ex-name').boundingBox();
 await page.mouse.move(headerBox.x+8,headerBox.y+8);await page.mouse.down();await page.waitForTimeout(350);await page.mouse.up();
 assert.equal(await page.evaluate(()=>!!Session._justDragged),false,'slow header press triggered drag');
 if(await page.locator('.ex-block').evaluate(el=>el.classList.contains('collapsed')))await page.locator('.ex-name').click();
 await page.locator('#setrow-set2 .set-hd').click();
 assert.equal(await page.locator('#setrow-set2').evaluate(el=>el.classList.contains('set-collapsed')),false,'second set did not open');
 await page.evaluate(()=>Session.renderExercises());
 assert.equal(await page.locator('.ex-block').evaluate(el=>el.classList.contains('collapsed')),false,'exercise closed after re-render');
 assert.equal(await page.locator('#setrow-set2').evaluate(el=>el.classList.contains('set-collapsed')),false,'open set disappeared after re-render');
 for(let i=0;i<6;i++){await page.locator('.ex-name').click();await page.locator('.ex-name').click()}
 if(await page.locator('.ex-block').evaluate(el=>el.classList.contains('collapsed')))await page.locator('.ex-name').click();
 assert.equal(await page.locator('.ex-block').evaluate(el=>el.classList.contains('collapsed')),false,'exercise toggle became unresponsive');
 await page.locator('.ex-note-in').fill('Ricorda la presa');
 assert.equal(await page.evaluate(()=>Notes.pending('test').exercises[`Farmer's walk`]),'Ricorda la presa');
 await page.locator('.add-set-btn').click();assert.equal(await page.evaluate(()=>window.clickedExercise),"Farmer's walk");
 assert.match(await page.locator('.prev-ex-note').innerText(),/Presa stretta/);
 console.log('PASS exercise and sets reliably open, survive re-render, and ignore slow-press drag');
 console.log('PASS exercise note and button with apostrophe');
 await page.evaluate(async()=>{
  // Regressione reale: una nuova sessione deve ricevere tutti i valori della
  // scheda, non il vecchio default 8-12 e non valori vuoti per recupero/RIR.
  const oldCreate=API.create,oldLoadSession=Session.loadSession;
  const writes=[];let exerciseNo=0,created=null;
  CONFIG.SCHEDE['Meta test']={exercises:[{
    nome:'Panca prova',serie:3,rrMin:5,rrMax:7,recupero:150,rir:2,
    tecnica:['Pausa'],cadenza:'3-1-1',gruppo:'Petto',info:'Controlla il fermo'
  }]};
  Session.sessions=[];
  API.create=async(db,props)=>{
    writes.push({db,props});
    return {id:db===CONFIG.DB.WORKOUT_LOG?'meta-session':`meta-set-${++exerciseNo}`,created_time:'2026-09-29T10:00:00.000Z'};
  };
  Session.loadSession=async(id,opts)=>{created={id,opts};};
  await Session._doCreateSession('Meta test');
  const made=created?.opts?.freshExercises;
  if(!made||made.length!==3)throw Error('New session did not create the planned sets');
  if(made.some(s=>s.rrMin!==5||s.rrMax!==7||s.recupero!==150||s.rir!==2||s.cadenza!=='3-1-1'))throw Error('Session metadata was not copied from Scheda');
  const setWrites=writes.filter(w=>w.db===CONFIG.DB.ESERCIZI_LOG);
  if(setWrites.some(w=>w.props[CONFIG.PROPS.EL_RR_MIN].number!==5||w.props[CONFIG.PROPS.EL_RR_MAX].number!==7||w.props[CONFIG.PROPS.EL_RECUPERO].number!==150||w.props[CONFIG.PROPS.EL_RIR].number!==2))throw Error('Saved Notion exercise metadata differs from Scheda');
  Session.loadSession=oldLoadSession;API.create=oldCreate;

  // Anche i set creati in seguito dal riallineamento della scheda devono
  // portare gli stessi metadati.
  const oldCreate2=API.create;const laterWrites=[];
  Session.activeId='meta-reconcile';Session.sessions=[{id:'meta-reconcile',name:'Meta test',date:'2026-09-29'}];Session.exercises=[];
  API.create=async(db,props)=>{laterWrites.push(props);return {id:`later-${laterWrites.length}`}};
  const later=await Session._createExerciseSets('Panca prova',2,{rrMin:5,rrMax:7,recupero:150,rir:2,tecnica:['Pausa'],cadenza:'3-1-1',gruppo:'Petto',info:'Controlla il fermo'});
  if(later.some(s=>s.rrMin!==5||s.rrMax!==7||s.recupero!==150||s.rir!==2||s.tecnica[0]!=='Pausa'))throw Error('Reconciled sets lost planned metadata');
  if(laterWrites.some(p=>p[CONFIG.PROPS.EL_RECUPERO].number!==150||p[CONFIG.PROPS.EL_RIR].number!==2))throw Error('Reconciled set metadata was not persisted');
  API.create=oldCreate2;
 });
 console.log('PASS new session and reconciled sets retain Scheda rep range, rest, RIR and technique metadata');
 await page.evaluate(()=>{
  // Completare S1/S2 deve aprire S2/S3 della stessa tendina; l'esercizio
  // seguente rimane chiuso anche dopo l'ultima serie.
  App.navigate('session');Session.activeId='flow';Session.sessions=[{id:'flow',date:'2026-09-29',name:'Flow',type:'Test'}];Session.viewMode=false;Session.sessionDone=false;
  Session.exercises=[
   {id:'p1',name:'Panca prova – Flow – S1',kg:0,reps:0,rrMin:5,rrMax:7,recupero:150},
   {id:'p2',name:'Panca prova – Flow – S2',kg:0,reps:0,rrMin:5,rrMax:7,recupero:150},
   {id:'p3',name:'Panca prova – Flow – S3',kg:0,reps:0,rrMin:5,rrMax:7,recupero:150},
   {id:'r1',name:'Rematore prova – Flow – S1',kg:0,reps:0,rrMin:8,rrMax:10,recupero:90}
  ];
  Session.exOrder=['Panca prova','Rematore prova'];Session.prevExercises=[];Session._done=new Set();Session._prSets=new Set();Session._openExercise='Panca prova';Session._openSetByExercise={'Panca prova':'p1'};
  RestTimer.start=secs=>{window.flowRest=secs};Session.renderExercises();
 });
 await page.evaluate(()=>Session.completeSet('p1','Panca prova'));
 assert.equal(await page.locator('#setrow-p2').evaluate(el=>el.classList.contains('set-collapsed')),false,'S1 did not open S2 of the current exercise');
 assert.equal(await page.locator('.ex-block[data-ex="Rematore prova"]').evaluate(el=>el.classList.contains('collapsed')),true,'S1 wrongly opened another exercise');
 await page.evaluate(()=>Session.completeSet('p2','Panca prova'));
 assert.equal(await page.locator('#setrow-p3').evaluate(el=>el.classList.contains('set-collapsed')),false,'S2 did not open S3 of the current exercise');
 await page.evaluate(()=>Session.completeSet('p3','Panca prova'));
 assert.equal(await page.locator('.ex-block[data-ex="Rematore prova"]').evaluate(el=>el.classList.contains('collapsed')),true,'Last set automatically opened another exercise');
 assert.equal(await page.evaluate(()=>window.flowRest),150,'rest timer ignored planned recovery');
 console.log('PASS completing sets advances only inside the current exercise and uses planned recovery');
 // Ripristina il fixture a un solo esercizio per le verifiche visuali e note
 // già presenti nella suite sotto.
 await page.evaluate(()=>{
  Session.activeId='test';Session.sessions=[{id:'test',date:'2026-09-26',name:'Test',type:'Test'}];Session.viewMode=false;Session.sessionDone=false;
  Session.exercises=[
   {id:'set1',name:`Farmer's walk – Test – S1`,kg:20,reps:8,rrMin:8,rrMax:12},
   {id:'set2',name:`Farmer's walk – Test – S2`,kg:20,reps:0,rrMin:8,rrMax:12}
  ];Session.exOrder=[`Farmer's walk`];Session.prevExercises=[];Session._done=new Set();Session._prSets=new Set();Session._openExercise=`Farmer's walk`;Session._openSetByExercise={[`Farmer's walk`]:'set1'};Session.renderExercises();
 });
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:path.join(root,'test-results','session-320.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()),'#070708');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()),'#FF3B2F');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim()),'17px');
 assert.equal(await page.locator('.add-set-btn').evaluate(el=>getComputedStyle(el).borderRadius),'10px');
 assert.equal(await page.locator('.rr-in-sm').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 59, 47)');
 await page.waitForTimeout(350);
 await page.screenshot({path:path.join(root,'test-results','session-320-dark.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'light'});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()),'#070708');
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:path.join(root,'test-results','session-1280.png'),fullPage:false});
 console.log('PASS hybrid premium theme stays black/orange and consistent across device themes');
 const sid=await page.evaluate(()=>[Session.sanitize('Leg curl'),Session.sanitize('Leg-curl')]);assert.notEqual(sid[0],sid[1]);
 await page.evaluate(()=>{
   const name=`Esercizio "dell'atleta" <img src=x onerror=alert(1)>`;
   const node=document.createElement('button');node.innerHTML='prova';
   const wrap=document.createElement('div');wrap.innerHTML=`<button onclick="Session.addSet(${U.arg(name)})">prova</button>`;
   document.body.appendChild(wrap);wrap.querySelector('button').click();
   if(window.clickedExercise!==name||wrap.querySelector('img'))throw Error('Special character handler regression');
   wrap.remove();
 });
 console.log('PASS quoted HTML-like names and unique exercise IDs');
 await page.evaluate(async()=>{
   let remote='';
   API.call=async()=>({properties:{[CONFIG.PROPS.WL_NOTE]:API.prop.rich_text(remote)}});
   API.update=async(id,props)=>{if(props[CONFIG.PROPS.WL_NOTE])remote=API.read.rich_text({properties:props},CONFIG.PROPS.WL_NOTE);return {}};
   API.getWorkoutSessions=async()=>[{id:'test',name:'Test',type:'Test',date:'2026-09-26',done:true,note:Notes.decode(remote).note,exerciseNotes:Notes.decode(remote).exercises}];
   Session.setExNote(`Farmer's walk`,'Nota salvata subito');
   await Session.saveSession();
   if(Notes.decode(remote).exercises[`Farmer's walk`]!=='Nota salvata subito')throw Error('Note missing after completion');
   const saved=(await API.getWorkoutSessions())[0];
   const html=ExportPDF._buildHTML('Test',[{...saved,exercises:Session.exercises}],{});
   if(!html.includes('Nota salvata subito'))throw Error('PDF note missing');
 });
 console.log('PASS immediate completion and PDF retain exercise note');
 await page.evaluate(()=>{
  const attack='<img src=x onerror="window.injected=true">';
  Cardio.sessions=[{id:'cardio',date:'2026-09-26',tipo:attack,note:attack,fatto:true}];Cardio.buildTable();
  App.programmi={[attack]:[{id:'p',nome:attack,colore:'#fff',exercises:[{name:attack}]}]};Schede.render();
  if(document.querySelector('#cardio-tbody img,#schede-list img'))throw Error('HTML injection');
  Dashboard.buildChecklist([{id:'task',name:attack,type:'Test',done:false}]);
  if(document.querySelector('#planner-list img'))throw Error('Planner injection');
 });
 console.log('PASS HTML injection inert in cardio, planner and programs');
 await page.evaluate(async()=>{
  const made=(id,nome,ordine)=>({id,nome,ordine,colore:'#FF3B2F',exercises:[{nome:'Test',serie:3}],programma:'Programma A'});
  const rows=[made('sa','Seduta A',1),made('sb','Seduta B',2),made('sc','Seduta C',3)];
  App.schede=rows;App.programmi={'Programma A':rows};App.activeProgram='Programma A';Schede._expanded=new Set(['Programma A']);
  const writes=[];API.updateScheda=async(id,fields)=>{writes.push([id,fields.ordine]);return {}};
  Schede.render();await Schede.moveSeduta('Programma A','sa',1);
  if(Object.keys(CONFIG.SCHEDE).join('|')!=='Seduta B|Seduta A|Seduta C')throw Error('Active program order not updated');
  if(writes.map(x=>x.join(':')).join('|')!=='sb:1|sa:2|sc:3')throw Error('Session order not persisted');
  API.updateScheda=async()=>{throw Error('offline')};
  await Schede.moveSeduta('Programma A','sa',-1);
  if(App.programmi['Programma A'].map(s=>s.nome).join('|')!=='Seduta B|Seduta A|Seduta C')throw Error('Failed reorder did not roll back');
 });
 await page.setViewportSize({width:320,height:800});
 assert.deepEqual(await page.locator('#schede-list .seduta-name').allTextContents(),['Seduta B','Seduta A','Seduta C']);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,'session order controls overflow on mobile');
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 await page.evaluate(()=>{document.getElementById('workout-summary').style.display='none';document.getElementById('toast-wrap').innerHTML='';App.navigate('schede');Schede.render()});
 await page.screenshot({path:path.join(root,'test-results','schede-320-hybrid.png'),fullPage:true});
 console.log('PASS workout sequence reorders, persists, rolls back on failure and fits mobile');
 await page.evaluate(async()=>{
   App.navigate('dashboard');Dashboard.buildChecklist([{id:'task',name:'Mobilità',done:false}]);
   API.completeTask=async()=>{throw Error('offline')};
   await document.querySelector('#planner-list button').onclick();
   if(document.querySelector('#planner-list button').getAttribute('aria-pressed')!=='false')throw Error('Planner rollback failed');
 });
 console.log('PASS planner failed save rolls back');
 await page.evaluate(async()=>{
   localStorage.setItem('gymos_backup_probe','originale');
   await ProgressPhotos._put({id:'backup-test',pose:'front',date:'2026-09-26',blob:new Blob(['photo-test'],{type:'image/jpeg'})});
   const data=await Backup.collect();
   if(data.values.gymos_backup_probe!=='originale'||!data.photos.length)throw Error('Backup incomplete');
   data.values.gymos_backup_probe='da non sovrascrivere';data.values.gymos_restored_probe='recuperato';
   data.checksum=await Backup.digest(data);
   await Backup.restore(data);
   if(localStorage.getItem('gymos_backup_probe')!=='originale'||localStorage.getItem('gymos_restored_probe')!=='recuperato')throw Error('Backup restore conflict');
   let rejected=false;try{Backup.validate({...data,values:{auth_token:'secret'}})}catch(_){rejected=true}
   if(!rejected)throw Error('Unsafe backup accepted');
   const tampered={...data,values:{...data.values,gymos_restored_probe:'alterato'}};let integrityRejected=false;
   try{await Backup.restore(tampered)}catch(_){integrityRejected=true}
   if(!integrityRejected)throw Error('Tampered backup accepted');
 });
 console.log('PASS local backup includes photos, preserves existing data and rejects secrets');
 const unlabeled=await page.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden'&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length);
 assert.equal(unlabeled,0);console.log('PASS accessible names on static and rendered fields');
 assert.deepEqual(errors,[]);console.log('PASS no browser JS errors');
 const offlineContext=await browser.newContext();
 await offlineContext.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 const offlinePage=await offlineContext.newPage();
 await offlinePage.goto(base);
 await offlinePage.evaluate(()=>navigator.serviceWorker.ready);
 await offlinePage.reload();
 await offlineContext.setOffline(true);
 const shell=await offlinePage.evaluate(async()=>{
   const r=await fetch('./index.html');
   const notes=await fetch('./notes.js');
   const vendor=await fetch('./vendor/idb.js');
   return r.ok&&notes.ok&&vendor.ok;
 });
 assert.equal(shell,true);console.log('PASS offline PWA shell, notes and photo library');
 await offlineContext.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
