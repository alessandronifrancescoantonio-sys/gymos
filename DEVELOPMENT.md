# GymOS — sviluppo e verifica

La build 103 corregge le note esercizio, la navigazione mobile e i difetti documentati negli audit del 26 settembre 2026.

## Comandi

```
npm ci
npm run build
npm test
npx playwright install chromium
node tests/browser.cjs
```

Su Windows il runner usa Edge installato. Negli altri ambienti usa Chromium di Playwright.
I test browser bloccano tutte le richieste esterne: non scrivono su Notion, non consumano quota Gemini e usano un profilo separato.

## Organizzazione

`features/` contiene le 18 aree funzionali, nell'ordine dichiarato in `features/manifest.json`.
Modificare questi sorgenti e poi eseguire `npm run build`: `modules.js` è il risultato generato per mantenere compatibilità con gli script globali esistenti.
`notes.js` contiene codec, coda persistente e sincronizzazione delle note; `ai-client.js` il trasporto autenticato; `accessibility.js` il supporto comune ai controlli.
Il numero unico di versione è in `version.json`. La build lo allinea a HTML, test e service worker.

## Note e recupero

La nota della seduta e le note esercizio sono salvate insieme nel campo Notion già esistente “Note sessione”, in un formato strutturato con prefisso `GYMOS_NOTES_V1`. Il frontend decodifica il testo e le singole note. Il vecchio testo semplice resta compatibile.
Ogni modifica è registrata immediatamente nel browser e poi inviata a Notion. Se manca la rete, la coda resta in `gymos_notes_pending_<id>` e viene ritentata all'avvio o al ritorno online. Il completamento attende il salvataggio remoto. Le note locali precedenti ancora presenti vengono migrate quando si apre la seduta. Le note già cancellate dalla vecchia versione non sono recuperabili senza un backup precedente.
Il browser contiene dati personali: non cancellare i dati del sito con sincronizzazioni pendenti.

Dal menu Altro o dalla barra laterale puoi scaricare un backup JSON locale, comprese le foto. Conservalo al sicuro: non è cifrato. Il ripristino inserisce solo dati e foto mancanti, senza sovrascrivere quelli già presenti. Le credenziali AI sono escluse. Questo backup non duplica il database Notion, che resta il deposito delle sessioni sincronizzate.

## Limiti verificati

Questi test usano dati sintetici. Non certificano una seduta reale su telefono, il suono del timer a schermo bloccato o un aggiornamento da tutte le vecchie installazioni PWA. Il salvataggio simultaneo della stessa nota da due dispositivi mantiene la semantica dell'ultima scrittura; non è un editor collaborativo.
La shell PWA è conservata come build coerente; l'uso completo dei dati Notion richiede connessione.
