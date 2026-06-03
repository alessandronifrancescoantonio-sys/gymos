# 🏋️ GymOS — Ultimo passo: GitHub Pages

Il Worker Cloudflare funziona e i database Notion sono pronti.
Resta solo da mettere online la web app. ~5 minuti.

---

## Cosa caricare

Questi 8 file (NON worker.js, quello è già su Cloudflare):

- index.html
- style.css
- config.js   ← già configurato con i tuoi ID
- api.js
- app.js
- modules.js
- session.js
- README.md   (opzionale)

---

## STEP 1 — Crea il repository

1. Vai su https://github.com/new
2. Repository name: `gymos`
3. Lascia **Public** (necessario per GitHub Pages gratis)
4. Clicca **Create repository**

---

## STEP 2 — Carica i file

1. Nella pagina del repo appena creato, clicca **"uploading an existing file"**
   (oppure: Add file → Upload files)
2. Trascina tutti gli 8 file
3. In basso clicca **"Commit changes"**

---

## STEP 3 — Attiva GitHub Pages

1. Nel repo vai su **Settings** (in alto)
2. Menu a sinistra: **Pages**
3. Sotto "Branch" seleziona **main** e cartella **/ (root)**
4. Clicca **Save**
5. Aspetta ~1 minuto. In cima apparirà:
   `Your site is live at https://TUO-USERNAME.github.io/gymos/`

---

## STEP 4 — Apri l'app

Vai su `https://TUO-USERNAME.github.io/gymos/`

Se vedi "Notion connesso" in basso a sinistra → **tutto funziona!**

---

## STEP 5 — Embed in Notion (opzionale)

1. In Notion crea/apri una pagina
2. Scrivi `/embed` e premi invio
3. Incolla l'URL `https://TUO-USERNAME.github.io/gymos/`
4. Ridimensiona il blocco

---

## ⚠️ Se vedi "Connessione fallita"

È un problema CORS. Soluzione:

1. Torna su Cloudflare → Worker `gymos-api` → Edit code
2. Trova la riga `"Access-Control-Allow-Origin": "*"`
3. È già impostata su `*` quindi dovrebbe funzionare da subito.
   Se per sicurezza vuoi restringerla, sostituisci `*` con:
   `"https://TUO-USERNAME.github.io"`
4. Deploy

---

## Prima di usare l'app davvero

L'app legge dai database Notion. Perché mostri qualcosa devi avere:
- Almeno una **sessione** nel Workout Log (con esercizi nel Esercizi Log)
- Almeno un **check-in** in Body Metrics
- Task in Weekly Planner per la dashboard "oggi"

Puoi inserirli a mano in Notion, oppure direttamente dall'app
(la sezione Body Metrics ha già il form per i check-in).

---

## Adattare le tue schede

Apri `config.js` e modifica la sezione `SCHEDE`:
metti i nomi esatti dei tuoi esercizi (come in Esercizi Master).
Poi ri-carica il file su GitHub (Add file → Upload → commit).
