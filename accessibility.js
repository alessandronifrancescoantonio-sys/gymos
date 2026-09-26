const Accessibility = {
  enhance(root=document) {
    const query=selector=>[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
    for(const input of query('input,select,textarea')) {
      if(input.type==='hidden'||input.getAttribute('aria-label')||input.getAttribute('aria-labelledby')||input.labels?.length)continue;
      const field=input.closest('.field,.tech-field,.ex-editor-f');
      const text=field?.querySelector('label,span')?.textContent.trim();
      input.setAttribute('aria-label',text||input.placeholder||input.title||({k:'Peso in kg',r:'Ripetizioni'}[input.dataset.f])||'Valore');
    }
    for(const el of query('[onclick]')) {
      if(!['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(el.tagName)) {
        el.setAttribute('role','button');el.tabIndex=0;
      }
    }
    for(const button of query('button,[role="button"]')) {
      if(button.textContent.trim()||button.getAttribute('aria-label')||button.getAttribute('aria-labelledby'))continue;
      const icons={ 'ti-x':'Chiudi', 'ti-trash':'Elimina', 'ti-pencil':'Modifica', 'ti-help-circle':'Guida esercizio', 'ti-message-chatbot':'Apri coach', 'ti-chevron-down':'Espandi', 'ti-chevron-right':'Espandi' };
      const icon=[...button.querySelectorAll('i')].flatMap(i=>[...i.classList]).find(c=>icons[c]);
      button.setAttribute('aria-label',button.title||icons[icon]||'Apri dettagli');
    }
  },
  init() {
    this.enhance();
    new MutationObserver(records=>{
      for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)this.enhance(n);
    }).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('keydown',event=>{
      if(event.target.matches('[role="button"][onclick]')&&!['BUTTON','A'].includes(event.target.tagName)&&['Enter',' '].includes(event.key)){
        event.preventDefault();event.target.click();
      }
    });
  },
};
