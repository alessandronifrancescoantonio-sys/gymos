const {test}=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
function setup(){
  const storage={getItem(k){return this[k]??null},setItem(k,v){this[k]=String(v)},removeItem(k){delete this[k]}};
  const context=vm.createContext({localStorage:storage,console,Map});
  for(const f of ['config.js','notes.js','api.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),context);
  const api=vm.runInContext('API',context),notes=vm.runInContext('Notes',context),config=vm.runInContext('CONFIG',context);
  let remote='';
  api.call=async()=>({properties:{[config.PROPS.WL_NOTE]:api.prop.rich_text(remote)}});
  api.update=async(id,props)=>{remote=api.read.rich_text({properties:props},config.PROPS.WL_NOTE)};
  return {api,notes,storage,read:()=>remote};
}
test('legacy notes and formatted Notion rich text remain readable',()=>{
 const {notes,api}=setup(); assert.equal(notes.decode('nota vecchia').note,'nota vecchia');
 assert.equal(api.read.rich_text({properties:{N:{rich_text:[{plain_text:'prima '},{plain_text:'seconda'}]}}},'N'),'prima seconda');
});
test('exercise note survives save and independent reload',async()=>{
 const {notes,read}=setup(); notes.stage('s1',{note:'Sessione',exercises:{"Farmer's walk":'Presa stretta'}}); await notes.flush('s1');
 const result=setup().notes.decode(read()); assert.equal(result.note,'Sessione'); assert.equal(result.exercises["Farmer's walk"],'Presa stretta'); assert.equal(notes.pending('s1'),null);
});
test('offline failure retains note and retry saves it',async()=>{
 const {notes,api,read}=setup(); const update=api.update; api.update=async()=>{throw Error('offline')};
 notes.stage('s1',{exercises:{Panca:'Nuova nota'}}); await assert.rejects(notes.flush('s1'));
 assert.equal(notes.pending('s1').exercises.Panca,'Nuova nota'); api.update=update; await notes.retry();
 assert.equal(notes.decode(read()).exercises.Panca,'Nuova nota');
});
test('typing during network save is not discarded',async()=>{
 const {notes,api,read}=setup(); const update=api.update; let release; const gate=new Promise(r=>release=r);
 api.update=async(...args)=>{await gate;return update(...args)};
 notes.stage('s1',{exercises:{Panca:'Prima'}}); const one=notes.flush('s1');
 await new Promise(r=>setImmediate(r)); notes.stage('s1',{exercises:{Panca:'Seconda'}}); release(); await one;
 assert.equal(notes.pending('s1').exercises.Panca,'Seconda'); await notes.flush('s1'); assert.equal(notes.decode(read()).exercises.Panca,'Seconda');
});
test('long notes are chunked and round trip without truncation',()=>{
 const {api}=setup(); const text='a'.repeat(7000); const prop=api.prop.rich_text(text);
 assert.ok(prop.rich_text.every(x=>x.text.content.length<=2000)); assert.equal(api.read.rich_text({properties:{N:prop}},'N'),text);
});
test('pagination returns requested sessions beyond 100',async()=>{
 const {api}=setup();let calls=0;api.call=async()=>{calls++;return calls===1?{results:Array.from({length:100},(_,i)=>i),has_more:true,next_cursor:'next'}:{results:Array.from({length:50},(_,i)=>100+i)}};
 assert.equal((await api.query('db',null,null,150)).length,150);assert.equal(calls,2);
});
test('previous workout uses same-day creation order then older completed sessions',async()=>{
 const {api}=setup(),filters=[];
 api.query=async(db,filter,sorts,limit)=>{filters.push({filter,sorts,limit});return []};
 await api.getPreviousWorkoutSession({name:'A',type:'A',date:'2026-09-26',createdAt:'2026-09-26T15:00:00Z'});
 assert.equal(filters.length,2);
 assert.equal(filters[0].filter.and.find(f=>f.timestamp)?.created_time.before,'2026-09-26T15:00:00Z');
 assert.equal(filters[1].filter.and.find(f=>f.date)?.date.before,'2026-09-26');
 assert.ok(filters.every(q=>q.filter.and.some(f=>f.checkbox?.equals===true)&&q.limit===1));
});
