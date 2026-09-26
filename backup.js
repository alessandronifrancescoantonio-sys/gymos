// Local backup: nothing is uploaded. Import only fills missing records.
const Backup = {
  allowedKey(key) { return /^gymos_/.test(key) && !/token|secret|ai_key/i.test(key); },
  async collect() {
    const values=Object.fromEntries(Object.keys(localStorage).filter(k=>this.allowedKey(k)).map(k=>[k,localStorage.getItem(k)]));
    const photos=[];
    for(const record of await ProgressPhotos._all()) {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(record.blob)});
      photos.push({...record,blob:undefined,data});
    }
    const payload={format:'gymos-local-backup',version:2,createdAt:new Date().toISOString(),values,photos};
    payload.checksum=await this.digest(payload);
    return payload;
  },
  async download() {
    try {
      const data=await this.collect();
      const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='gymos-backup-'+U.today()+'.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      U.toast('Backup scaricato: contiene dati personali e foto. Conservalo al sicuro.', 'info',6000);
    } catch (_) { U.toast('Backup non creato: controlla lo spazio e riprova', 'err'); }
  },
  validate(data) {
    if(data?.format!=='gymos-local-backup'||![1,2].includes(data.version)||!data.values||typeof data.values!=='object'||Array.isArray(data.values)||!Array.isArray(data.photos))throw Error('Formato backup non valido');
    if(data.version===2&&(!data.checksum||typeof data.checksum!=='string'))throw Error('Backup senza controllo di integrità');
    if(Object.keys(data.values).length>20000||data.photos.length>2000)throw Error('Backup troppo grande');
    for(const [key,value]of Object.entries(data.values))if(!this.allowedKey(key)||typeof value!=='string')throw Error('Chiave del backup non ammessa');
    for(const p of data.photos)if(!p||typeof p.id!=='string'||!p.id||!['front','side','back'].includes(p.pose)||typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(p.date)||typeof p.data!=='string'||!/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(p.data))throw Error('Foto nel backup non valida');
  },
  async digest(data) {
    const clean={...data};delete clean.checksum;
    const bytes=new TextEncoder().encode(JSON.stringify(clean));
    const hash=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  },
  async restore(data) {
    this.validate(data);
    if(data.version===2&&await this.digest(data)!==data.checksum)throw Error('Backup modificato o danneggiato');
    const db=await ProgressPhotos._open(),tx=db.transaction(ProgressPhotos.STORE,'readwrite');
    const inserted=[];let photoCount=0;
    try {
      for(const p of data.photos)if(!await tx.store.get(p.id)) {
        const [header,base64]=p.data.split(',');const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        const {data:ignored,...record}=p;
        await tx.store.put({...record,blob:new Blob([bytes],{type:header.slice(5,header.indexOf(';'))})});photoCount++;
      }
      for(const [key,value]of Object.entries(data.values))if(localStorage.getItem(key)===null){localStorage.setItem(key,value);inserted.push(key)}
      await tx.done;
      return {values:inserted.length,photos:photoCount};
    } catch(error) {
      try{tx.abort()}catch(_){} await tx.done.catch(()=>{});
      for(const key of inserted)localStorage.removeItem(key);
      throw error;
    }
  },
  async choose(file) {
    if(!file)return;
    try {
      if(file.size>100*1024*1024)throw Error('Il backup supera 100 MB');
      const result=await this.restore(JSON.parse(await file.text()));
      U.toast(`Ripristinati ${result.values} dati e ${result.photos} foto mancanti. I dati esistenti sono conservati. Riapri l'app.`, 'ok',7000);
    }catch(error){U.toast(error.message||'Ripristino non riuscito','err',6000)}
  },
};
