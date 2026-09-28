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
 await page.evaluate(()=>{document.getElementById('rest-running').style.display='none';document.getElementById('bn-save').classList.remove('show');App.navigate('dashboard')});
 console.log('PASS active rest timer stays visible above session navigation');
 await page.evaluate(()=>{
  App.navigate('session');document.getElementById('page-session').classList.remove('session-empty');document.body.classList.remove('sess-landing');
  Session.activeId='test';Session.sessions=[{id:'test',date:'2026-09-26',name:'Test',type:'Test'}];Session.viewMode=false;Session.sessionDone=false;
  Session.exercises=[{id:'set1',name:`Farmer's walk – Test – S1`,kg:20,reps:8,rrMin:8,rrMax:12}];Session.exOrder=[`Farmer's walk`];Session.prevExercises=[];Session._done=new Set();Session._prSets=new Set();
  Session._prevExerciseNotes={[`Farmer's walk`]:'Presa stretta'};Session.renderExercises();
  document.getElementById('sess-title').textContent='Seduta di prova';
  Session.addSet=name=>{window.clickedExercise=name};
  API.call=async()=>({properties:{[CONFIG.PROPS.WL_NOTE]:{rich_text:[]}}});API.update=async()=>({});
 });
 // Click the exercise label: the header also contains editable inputs, so its
 // geometric centre changes across responsive themes and isn't a stable target.
 await page.locator('.ex-name').click();
 await page.locator('.ex-note-in').fill('Ricorda la presa');
 assert.equal(await page.evaluate(()=>Notes.pending('test').exercises[`Farmer's walk`]),'Ricorda la presa');
 await page.locator('.add-set-btn').click();assert.equal(await page.evaluate(()=>window.clickedExercise),"Farmer's walk");
 assert.match(await page.locator('.prev-ex-note').innerText(),/Presa stretta/);
 console.log('PASS exercise note and button with apostrophe');
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:path.join(root,'test-results','session-320.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'dark'});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()),'#070708');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()),'#FF3B2F');
 assert.equal(await page.locator('.rr-in-sm').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 59, 47)');
 await page.waitForTimeout(350);
 await page.screenshot({path:path.join(root,'test-results','session-320-dark.png'),fullPage:true});
 await page.emulateMedia({colorScheme:'light'});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()),'#070708');
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:path.join(root,'test-results','session-1280.png'),fullPage:false});
 console.log('PASS consistent black and orange appearance across device themes');
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
