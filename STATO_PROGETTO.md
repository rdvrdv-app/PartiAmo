# PartiAmo — stato del progetto

Web app di viaggio, vanilla JavaScript senza build step: `index.html` +
`assets/styles.css` (+ `assets/liquid-glass.css`, layer visivo additivo) +
moduli in `js/`, serviti da un piccolo server statico Node (`server.js`,
nessuna dipendenza npm) in locale, e da **GitHub Pages** in produzione
(`https://rdvrdv-app.github.io/PartiAmo/`, deploy automatico ad ogni push
su `main`). Backend dati su **Supabase** (Postgres + Auth + Edge
Functions).

Questo documento descrive cosa fa l'app **oggi**, verificato leggendo il
codice sorgente reale, non un elenco di intenzioni.

---

## Schermate

L'app ha 6 tab in nav (`UI.go(tab)`, cambio di vista senza routing/URL) +
la sezione Assistente, raggiungibile solo dal pulsante flottante
`#btn-ai-fab` (non ha un bottone in nav; icona 🤖, non più la stellina ✦
delle prime versioni — più esplicita a colpo d'occhio).

Ordine nav: **Home → Viaggio → Itinerario → Contatti → Checklist → Vault**.

### 🏠 Home (tab `dashboard`, non rinominato negli id/JS)
Riepilogo del viaggio attivo: un tile "Destinazione" che include anche il
countdown alla partenza come blocco centrato al suo interno, meteo
previsto, percentuale checklist completata, **avvisi automatici**
(documenti in scadenza, checklist indietro vicino alla partenza, allerte
neve/temporali, forti escursioni termiche), lista dei **prossimi
impegni** (voli/check-in dal Vault, check-in strutture, POI con giorno
assegnato, attività d'itinerario — ordinati cronologicamente, **ogni
giorno del viaggio con almeno un impegno resta rappresentato con almeno
una voce**, anche oltre il taglio a 8 voci dell'anteprima), e un blocco
**emergenza** (numero locale, tipo di presa/voltaggio, nota UE/Schengen,
link rapidi a ambasciata/ospedale/farmacia/polizia più vicini). Striscia
meteo giorno per giorno cliccabile, salta all'Itinerario al giorno
corrispondente.

Le tre card in alto sono cliccabili (`bindDashboard()` in `js/app.js`):
Destinazione e Meteo previsto portano all'Itinerario, Avanzamento
checklist porta alla Checklist.

### 🔐 Vault
Archivio documenti: passaporto, carta d'identità, carta d'imbarco,
prenotazione hotel, assicurazione, patente, altro. Scadenza opzionale
(alimenta gli avvisi), note, allegati foto/PDF (salvati in IndexedDB, mai
su cloud — **100% locale**, l'unica eccezione a tutto il resto dell'app,
per scelta deliberata). Ogni documento è scansionabile via OCR per
l'auto-compilazione.

### 🧳 Viaggio
Configurazione: destinazione, paese, date, tipo viaggio, mezzo di
trasporto, compagnia aerea + tariffa (guida le regole bagaglio),
disponibilità lavanderia, **data e ora di partenza del volo** (nuovo
campo, solo per programmare la notifica di check-in — vedi sezione
dedicata più sotto, non è collegato al Vault). Include anche il set
bagagli. Pannello **"🔔 Notifica di check-in volo"** con toggle
attiva/disattiva le notifiche push. Pulsante di azzeramento completo del
viaggio (locale + cloud).

### 📍 Itinerario
Pianificazione giorno per giorno, un pannello per ogni giorno del viaggio
(`<details>` — ricorda quali giorni erano aperti prima di ogni
re-render: cancellare/modificare un'attività non richiude più il giorno
su cui si sta lavorando), diviso in fasce (mattina/pranzo/pomeriggio/
cena/serata/giornata intera). Ogni attività ha orario e luogo opzionali,
selezionabile anche da un POI salvato (filtrato per giorno). Ogni giorno
mostra meteo e un consiglio testuale.

Pannello **"Versioni salvate"**: 3 slot per salvare/ripristinare
un'istantanea dell'itinerario (utile prima di lasciar riorganizzare le
tappe all'assistente, o per confrontare alternative) — copia profonda in
entrambe le direzioni, **restano solo sul dispositivo** (non
sincronizzate, come lo storico chat dell'assistente).

In fondo alla pagina, il form "Nuovo punto di interesse" e la lista POI
(i POI vivono qui, non nel tab Contatti).

### 📇 Contatti
**Contatti salvati** (elenco) poi il form "Nuovo contatto" sotto. Tipi:
struttura/emergenza/trasporto/ristorante/altro. I **POI** sono un
concetto separato che vive nel tab Itinerario, non qui. Entrambi
supportano l'incollaggio di un link Google Maps per auto-compilare
nome/indirizzo/categoria, e la scansione OCR di foto.

### ✅ Checklist
Generata automaticamente da durata del viaggio, meteo, tipo di viaggio,
mezzo di trasporto, lavanderia, set bagagli. Le spunte, le voci
personalizzate e quelle rimosse dall'utente sopravvivono alla
rigenerazione.

**Bagagli**: verifica franchigia contro le regole di 12 compagnie aeree,
calcolatore singolo collo, assegnazione automatica alla franchigia più
adatta, regola liquidi cabina.

### 🤖 Assistente — lettura e scrittura (con conferma) + ricerca web
Vedi sezione dedicata più sotto.

---

## Dati e sincronizzazione

- **Local-first**: stato strutturato in `localStorage` (`Store`, chiave
  `partiamo.state.v1`). Allegati binari in **IndexedDB** (`Media`).
- **Sync cloud opzionale**: se loggato, ogni salvataggio (debounced 1.2s)
  va a Supabase.
  - **Condiviso con i compagni di viaggio**: dati del viaggio
    (destinazione, date, tariffa, bagagli, **data/ora partenza volo**),
    POI, contatti, itinerario.
  - **Sincronizzato ma privato per utente** (l'altro partecipante non lo
    vede, ma tu lo ritrovi sui tuoi altri dispositivi): checklist,
    iscrizione alle notifiche push (`push_subscriptions` — un endpoint
    push è un dato di dispositivo, non di viaggio, quindi policy "solo il
    proprietario" come la checklist, non "is_trip_member" come
    POI/itinerario/contatti).
  - **100% locale, mai sul cloud**: documenti del Vault, storico chat
    dell'assistente (`assistantHistory`), le 3 versioni salvate
    dell'itinerario (`itinerarySnapshots`).
- **Multi-dispositivo**: al login e al rientro nell'app i dati locali e
  cloud vengono fusi con tombstone per propagare le cancellazioni senza
  travolgere aggiunte concorrenti di altri partecipanti.
- **Condivisione**: ogni viaggio ha un codice invito auto-generato
  (`DEST-1234`) e un link diretto (`?join=CODICE`); l'adesione passa da
  `join_trip_by_code` (Postgres, aggira la ricorsione RLS).
- **Autenticazione**: email + codice a 6 cifre o link magico, o Google.
  Vedi `GUIDA_SUPABASE.md` e `supabase_schema.sql` (schema completo,
  idempotente — tabelle `profiles`, `trips`, `trip_participants`, `pois`,
  `itinerary_items`, `contacts`, `vault_docs` **[mai scritta dal
  client]**, `checklists`, `push_subscriptions`).

---

## Meteo

API gratuita **Open-Meteo**: geocoding, previsioni fino a 16 giorni, oltre
usa dati storici dell'anno precedente come stima (segnalati come tali).

---

## Scansione documenti (OCR)

Tutto **client-side**, nessun upload a servizi esterni: `js/scan.js`
(Tesseract.js + pdf.js) estrae il testo, `js/ocr.js` lo interpreta (MRZ
passaporti/carte d'identità, PNR, volo, gate, posto, scadenze...).

---

## Stile visivo

- **Tema chiaro/scuro** commutabile dal pulsante `#btn-theme`.
- **Liquid Glass** (`assets/liquid-glass.css`, additivo): superfici in
  vetro traslucido con blur. Il layer fotografico punta a
  `assets/bg-day.jpg`/`bg-night.jpg`, **file non presenti nel repo** (404
  in produzione, mai risolto) — resta sempre il fallback a gradiente,
  visivamente accettabile ma non l'effetto voluto.
  - **`body` non deve mai avere un proprio `background` opaco** — vedi i
    livelli fissi `body::before`/`::after`.
  - **Safari/WebKit disegna un bordo visibile su elementi con
    `backdrop-filter`** anche a sfondo/bordo trasparenti (Chromium no —
    verifica su device reale quando qualcosa "sembra sparito" su
    Chromium ma l'utente lo segnala ancora presente).
  - **Componenti che ereditano i token del vetro senza farne davvero
    parte** sono un punto cieco ricorrente: `.item`/`.items` (righe della
    checklist) e le checkbox prendevano `--border`/`--surface`
    quasi-bianchi dal vetro globale ma senza il blur che dà loro
    contrasto — bianco su bianco, invisibili in entrambi i temi. Fix
    dedicato in `liquid-glass.css` (divisori con colore proprio, checkbox
    con `box-shadow` invece di `border`: un checkbox nativo — senza
    `appearance:none` — ignora il `border` dell'autore per il proprio
    contorno anche con `!important`, ma rispetta sempre il box-shadow,
    verificato). Se un altro componente "sembra sparito" solo nel layer
    vetro, sospettare lo stesso meccanismo prima di altro.
  - `.cards-grid` (liste contatti/POI) non aveva `margin-bottom`, a
    differenza di `.panel` che ce l'ha di serie: due card di vetro
    adiacenti senza spazio, coi rispettivi box-shadow da 40px di blur,
    davano l'impressione di sovrapporsi anche senza toccarsi — capitava
    identico su ogni larghezza, non è mai stato un problema di
    breakpoint. Occhio a qualunque coppia di elementi "vetro" stack senza
    margine esplicito tra loro.
  - Il FAB dell'assistente (`#btn-ai-fab`, `position:fixed`) è un cerchio
    con la sola icona sotto i 760px (etichetta completa solo da desktop
    in su): da pillola larga con testo copriva un quarto di schermo,
    finendo sopra ai campi di form lunghi (es. "Nuovo contatto") in
    qualunque punto di scroll, dato che un `position:fixed` non si sposta
    mai. Se si nota di nuovo qualcosa che "sembra sovrapposto" su mobile,
    controllare per primi gli elementi `position:fixed`/`sticky`.
- **Cache-busting su CSS *e* script**: `index.html` carica ogni
  `<link>`/`<script>` con `?v=N` (oggi **v=15**) — **incrementare N su
  entrambi insieme ad ogni modifica rilevante a un file css o js**. Prima
  copriva solo i CSS: gli script venivano serviti senza query di
  versione, quindi un fix lato JS poteva restare invisibile per giorni su
  una PWA installata anche dopo il deploy — causa più probabile di "ho
  fatto il fix ma vedo ancora il comportamento vecchio" quando il codice
  è corretto e il deploy è confermato riuscito.
- **PWA installabile**: manifest valido, icone 192/512, `display:
  standalone`. **Service worker presente** (`sw.js`, dalla feature
  notifiche push) ma minimale apposta: gestisce solo `push`/
  `notificationclick`, **nessuna cache applicativa** — l'aggiornamento
  dei file statici passa sempre e solo dal cache-busting `?v=N` sopra,
  un service worker con cache propria lo complicherebbe invece di
  aiutarlo.

---

## 🤖 Assistente virtuale — lettura, scrittura (con conferma) e ricerca web

Il tab Assistente (raggiungibile solo da `#btn-ai-fab`) e
`js/assistant.js` raccolgono il contesto del viaggio (destinazione, date,
meteo, checklist, bagagli, itinerario, POI, contatti — **mai** file o
note del Vault, solo tipo/scadenza documenti) e chiamano una **Supabase
Edge Function**, `supabase/functions/assistant/index.ts` (Deno).

**Lettura e scrittura, sempre con conferma esplicita, selezionabile voce
per voce**: oltre a rispondere a parole, l'assistente può proporre
modifiche in QUATTRO e sole categorie — **POI**, **itinerario**,
**contatti**, **checklist**. Fuori scope, mai toccati: Vault, config del
viaggio, bagagli, account/condivisione.

- **Lato Edge Function**: passa 12 `tools` di scrittura (add/edit/delete
  × POI/contatto/attività itinerario/voce checklist) **più** il tool
  server-side di Anthropic `web_search_20260209` (gira sui server
  Anthropic, `max_uses:3` a richiesta) — usato con criterio per trovare
  dati reali mancanti (telefono, indirizzo, orari) prima di proporre un
  POI/contatto, mai inventati se la ricerca non trova nulla di
  affidabile. Gestisce `stop_reason: "pause_turn"` (il ciclo di ricerca
  server-side può sospendersi da solo oltre le 10 iterazioni interne di
  Anthropic): si reinvia la conversazione con la risposta parziale
  accodata, fino a un tetto di tentativi.
- **Lato client** (`js/assistant.js`): ogni azione ricevuta viene
  **sempre rivalidata** prima di comparire in chat (tool tra i 12
  consentiti, id esistente, campi/enum validi). Le azioni valide
  compaiono come riepilogo con **una checkbox per voce** (selezionata di
  default: si può scartare solo qualcuna delle modifiche proposte, non è
  tutto-o-niente) e due bottoni "Annulla"/"✅ Applica selezionate":
  nessuna scrittura su `Store.s` prima del click. Alla conferma ogni
  azione selezionata viene *rivalidata una seconda volta* e poi eseguita
  con lo stesso pattern usato altrove (`Store.uid()`/`uuid()`,
  `Store.tombstone()` per le cancellazioni di POI/contatti/itinerario,
  `Store.save()`, poi i render pertinenti).
- Il contesto include l'**id** di ogni POI/contatto/voce checklist e i
  contatti (necessari per riferirsi a una voce esistente senza
  indovinare).

**Storico persistito**: `Store.s.assistantHistory`, ultime 60 battute,
**mai sincronizzato** (locale come il Vault). Bottone "🗑️ Nuova
conversazione" lo svuota. La Edge Function limita comunque l'invio a
Claude alle ultime 12 battute.

Modello `claude-opus-5`, system prompt che rifiuta in una riga le domande
non legate al viaggio, rate limit 20 richieste/10 minuti per IP.

**Per (ri)attivarla dopo una modifica** (nessuna CLI necessaria — questa
sessione non ha accesso deploy, solo lettura log — incolla il contenuto
di `supabase/functions/assistant/index.ts` in Dashboard → Edge Functions
→ `assistant` → Deploy, oppure via CLI):
```
supabase functions deploy assistant --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

---

## 🔔 Notifica push di check-in volo (anche ad app chiusa)

Richiede vera infrastruttura server-side: una notifica ad app chiusa può
partire solo se qualcosa che gira sempre (un cron server-side) sa quando
"svegliare" il dispositivo — il browser da solo non può farlo.

- **`trip.departureAt` / `trip.returnDepartureAt`**: due campi (tab
  Viaggio, andata e ritorno), inseriti a mano, **deliberatamente separati
  dal Vault** (che resta 100% locale) — sono gli unici dati che uno scopo
  puramente di notifica fanno arrivare al cloud. Salvati come ISO UTC
  assoluto: `<input type=datetime-local>` non porta il fuso, la
  conversione avviene subito lato client
  (`new Date(valore-locale).toISOString()`) nel fuso di chi lo compila,
  non lasciata al server. Compilarne uno solo notifica solo quel volo.
- **`js/push.js` + `sw.js`**: pannello "🔔 Notifica di check-in volo"
  (tab Viaggio) con toggle attiva/disattiva. Registra il service worker,
  chiede il permesso notifiche, sottoscrive il browser (`PushManager`,
  chiave pubblica VAPID hardcoded nel client — è per definizione
  pubblica) e salva l'iscrizione (endpoint + chiavi) su Supabase.
  **Richiede un account** (l'iscrizione vive sul cloud) e, su iPhone, che
  l'app sia aggiunta alla schermata Home (iOS 16.4+ — Safari normale non
  supporta le push web, vincolo di piattaforma non aggirabile).
- **`push_subscriptions`** (tabella, in coda a `supabase_schema.sql`):
  endpoint/chiavi/trip_id/user_id/notified_for/notified_for_return (una
  colonna di tracciamento per gamba di volo, così andata e ritorno si
  notificano in modo indipendente). Policy "solo il proprietario" (non
  condivisa con gli altri partecipanti: un endpoint push è un dato di
  dispositivo).
- **`supabase/functions/send-checkin-reminders/index.ts`**: Edge
  Function schedulata via cron (pg_cron + pg_net, `net.http_post` ogni 15
  minuti, protetta da un header `x-cron-secret` condiviso — vedi
  `CRON_SECRET`). Con la service role key, per ogni viaggio e per ciascuna
  gamba (andata/ritorno) la cui partenza cade nella finestra "tra 24h e
  adesso" manda una push a ogni iscrizione non ancora notificata per
  quella data (`notified_for`/`notified_for_return` evitano doppi invii,
  si "riarmano" da soli se la data cambia). Usa la libreria `web-push`
  (via `esm.sh`, nessuna dipendenza npm nel repo) per firma VAPID e
  cifratura payload. Iscrizioni scadute (404/410 dal servizio push)
  vengono rimosse in automatico.

**Verificato** (senza un deploy reale, quindi senza consegna push
end-to-end): registrazione service worker, conversione datetime-local↔ISO
con fuso corretto, round-trip del campo alla ricarica del form, messaggi
di errore quando manca la data o l'account.

**Per attivarla** (4 passaggi, tutti via Dashboard — dettagli completi
nella chat che ha implementato la feature, non ripetuti qui per
brevità):
1. Rieseguire `supabase_schema.sql` (SQL Editor) — aggiunge
   `push_subscriptions`.
2. Deploy di `send-checkin-reminders` (Edge Functions).
3. Secret: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `CRON_SECRET` (valori già generati in una sessione precedente — se
   persi, rigenerabili con `npx web-push generate-vapid-keys` per le
   chiavi VAPID; `CRON_SECRET` è una stringa a piacere).
4. `select cron.schedule(...)` (SQL Editor) ogni 15 minuti verso
   `.../functions/v1/send-checkin-reminders` con l'header
   `x-cron-secret`.

Se non risulta ancora attiva: controllare Dashboard → Edge Functions →
`send-checkin-reminders` → Logs (ogni esecuzione del cron risponde
`{tripsChecked, sent, skipped, cleaned}`).

---

## File di riferimento

- `GUIDA_SUPABASE.md` — configurazione Supabase, template email, URL di
  redirect, limiti di invio, pulizia doppioni storici.
- `supabase_schema.sql` — schema completo del database, idempotente.
- `avvia.bat` — avvio rapido del server locale su Windows.

---

## Come riprendere il lavoro in una nuova sessione/chat

Questo file è pensato per essere letto per intero all'inizio di una nuova
sessione — sostituisce il bisogno di re-incollare contesto a mano. Se hai
appena aperto una chat nuova su questo progetto: leggi questo documento,
poi guarda `git log --oneline -20` per i dettagli commit-per-commit più
recenti (ogni commit di questo progetto spiega il *perché*, non solo il
*cosa*, nel corpo del messaggio).

Non risolto/da verificare, in ordine di probabile priorità:
1. **Notifiche push**: i 4 passaggi Supabase sopra non sono ancora stati
   eseguiti (o lo sono, ma la consegna end-to-end non è stata confermata
   su un dispositivo reale) — verificare coi Logs della Edge Function.
2. **Foto di sfondo Liquid Glass mancanti**: `assets/bg-day.jpg` e
   `bg-night.jpg` non sono mai stati caricati nel repo (404 silenzioso,
   fallback a gradiente sempre attivo, esteticamente accettabile ma non
   l'effetto voluto) — servirebbero due foto reali (1600px+, non
   pre-sfocate) se si vuole completare l'effetto.
