# PartiAmo — stato del progetto

Web app di viaggio, vanilla JavaScript senza build step: `index.html` +
`assets/styles.css` (+ `assets/liquid-glass.css`, layer visivo additivo) +
moduli in `js/`, serviti da un piccolo server statico Node (`server.js`,
nessuna dipendenza npm). Backend dati su **Supabase** (Postgres + Auth).

Questo documento descrive cosa fa l'app **oggi**, verificato leggendo il
codice sorgente reale, non un elenco di intenzioni.

---

## Schermate

L'app ha 6 tab in nav (`UI.go(tab)`, cambio di vista senza routing/URL) +
la sezione Assistente, raggiungibile solo dal pulsante flottante
`#btn-ai-fab` (non ha un bottone in nav):

Ordine nav: **Home → Viaggio → Itinerario → Contatti → Checklist → Vault**.

### 🏠 Home (tab `dashboard`, non rinominato negli id/JS)
Riepilogo del viaggio attivo: un tile "Destinazione" che include anche il
countdown alla partenza come blocco centrato al suo interno (non è più una
card separata), meteo previsto, percentuale checklist completata,
**avvisi automatici** (documenti in scadenza, checklist indietro vicino
alla partenza, allerte neve/temporali, forti escursioni termiche), lista
dei **prossimi impegni** (voli/check-in dal Vault, check-in strutture, POI
con giorno assegnato, attività d'itinerario — ordinati cronologicamente),
e un blocco **emergenza** (numero locale, tipo di presa/voltaggio, nota
UE/Schengen, link rapidi a ambasciata/ospedale/farmacia/polizia più
vicini). Striscia meteo giorno per giorno cliccabile, salta all'Itinerario
al giorno corrispondente.

Le tre card in alto sono cliccabili (`bindDashboard()` in `js/app.js`):
Destinazione e Meteo previsto portano all'Itinerario, Avanzamento
checklist porta alla Checklist. Il bottone "↻ Aggiorna meteo" dentro la
card Meteo ha il suo click isolato (non fa scattare anche la
navigazione).

### 🔐 Vault
Archivio documenti: passaporto, carta d'identità, carta d'imbarco,
prenotazione hotel, assicurazione, patente, altro — ciascuno con campi e
suggerimenti dedicati. Scadenza opzionale (alimenta gli avvisi), note,
allegati foto/PDF (salvati in IndexedDB, mai su cloud). Ogni documento è
scansionabile via OCR per l'auto-compilazione (vedi sotto).

### 🧳 Viaggio
Configurazione: destinazione, paese, date, tipo viaggio (urbano / business /
trekking / relax), mezzo di trasporto, compagnia aerea + tariffa (guida le
regole bagaglio), disponibilità lavanderia (limita il cambio abiti a un
ciclo di 7 giorni). Include anche il set bagagli (aggiungi/rimuovi colli
condiviso con la sezione Bagagli). Pulsante di azzeramento completo del
viaggio (locale + cloud).

### 📍 Itinerario
Pianificazione giorno per giorno, un pannello per ogni giorno del viaggio,
diviso in fasce (mattina/pranzo/pomeriggio/cena/serata/giornata intera).
Ogni attività ha orario e luogo opzionali, selezionabile anche da un POI
salvato — il selettore "Scegli dai POI salvati…" mostra un POI con
giorno assegnato SOLO nel form di quel giorno (prima compariva identico
in ogni giorno, letto dagli utenti come un doppione). Ogni giorno mostra
meteo e un consiglio testuale generato in base alle condizioni previste.
In fondo alla pagina, il form "Nuovo punto di interesse" e la lista POI
(vedi sotto — i POI vivono qui, non nel tab Contatti).

### 📇 Contatti
Due liste, in quest'ordine nel markup: **Contatti salvati** (elenco) poi
il form "Nuovo contatto" sotto. Tipi: struttura/emergenza/trasporto/
ristorante/altro, con campi su misura come orari di check-in/out. I
**POI** (punti d'interesse) sono un concetto separato che vive nel tab
Itinerario, non qui. Entrambi (contatti e POI) supportano l'incollaggio
di un link Google Maps per auto-compilare nome/indirizzo/categoria (con
geocoding inverso e risoluzione dei link abbreviati `maps.app.goo.gl`), e
la scansione OCR di foto (biglietti da visita, voucher). Il form POI
azzera un flag `dataset.submitting` a fine salvataggio per evitare
doppioni da doppio tap prima che il salvataggio precedente finisca;
`UI.dedupePois()` (chiamata all'avvio) unisce automaticamente eventuali
POI già duplicati nello stato salvato (stesso nome+indirizzo+giorno+
categoria), mettendo i doppioni in tombstone così la rimozione si
propaga anche al cloud.

### ✅ Checklist
Generata automaticamente da: durata del viaggio, medie meteo (min/max),
tipo di viaggio, mezzo di trasporto, disponibilità lavanderia, set bagagli
dichiarato. Aggiunge condizionalmente: strati termici/guanti sotto i 5°C,
cappello/occhiali da sole sopra i 24°C, kit pioggia se piove, scarponi da
neve se prevista, nota "vestizione a strati" con forte escursione termica.
Voci specifiche per tipo di viaggio (business: abiti eleganti/biglietti da
visita; trekking: scarponi/borraccia/frontalino/cerotti; relax: costume/doposole;
urbano: outfit serale/borsa antifurto). Destinazioni extra-UE aggiungono
l'assicurazione di viaggio, quelle UE mantengono la Tessera Sanitaria/TEAM.
Le spunte, le voci personalizzate e quelle rimosse dall'utente sopravvivono
alla rigenerazione.

**Bagagli**: verifica franchigia contro le regole di 12 compagnie aeree
(Ryanair, easyJet, Wizz Air, Vueling, ITA, Lufthansa, Air France, British
Airways, Iberia, Turkish, Emirates + generica), con avvisi se il set
dichiarato non rientra nella tariffa scelta. Calcolatore singolo collo
(L×W×H×kg → quale franchigia lo accetta, indipendente dall'orientamento),
assegnazione automatica di ogni collo del set alla franchigia più adatta,
e regola liquidi cabina (100ml/1L) adattata alla presenza di bagaglio in
stiva. Per mezzi diversi dall'aereo, note specifiche al posto delle
franchigie.

### ✦ Assistente — lettura e scrittura (con conferma) su POI, itinerario, contatti, checklist
Raggiungibile solo dal pulsante flottante `#btn-ai-fab` (si nasconde da
solo quando sei già sul tab Assistente, per non coprire l'input/Invia).
Vedi sezione dedicata più sotto.

---

## Dati e sincronizzazione

- **Local-first**: stato strutturato (viaggio, meteo, checklist, bagagli,
  documenti, contatti, POI, itinerario) in `localStorage`
  (`Store`, chiave `partiamo.state.v1`). Allegati binari (foto/PDF) in
  **IndexedDB** (`Media`, database `partiamo-media`).
- **Sync cloud opzionale**: se l'utente ha fatto login, ogni salvataggio
  (debounced 1.2s) viene inviato a Supabase. **I documenti del Vault non
  vengono mai sincronizzati** — restano solo sul dispositivo, per scelta.
  Viaggio, POI, contatti e itinerario sono condivisi con i compagni di
  viaggio; la checklist sincronizza ma resta privata per utente.
- **Multi-dispositivo**: al login e al rientro nell'app (throttle 30s) i
  dati locali e cloud vengono fusi senza sovrascritture cieche, con
  tombstone per propagare le cancellazioni senza travolgere aggiunte
  concorrenti di altri partecipanti.
- **Condivisione**: ogni viaggio ha un codice invito auto-generato
  (`DEST-1234`) e un link diretto; l'adesione passa da una funzione
  Postgres (`join_trip_by_code`) che aggira la ricorsione RLS.
- **Autenticazione**: email + codice a 6 cifre o link magico (accetta
  entrambi nello stesso campo — utile perché il link, una volta aperto, si
  consuma e diventa inutilizzabile su un secondo dispositivo). Anche login
  Google. Vedi `GUIDA_SUPABASE.md` per la configurazione del template email
  e `supabase_schema.sql` per lo schema completo (tabelle `profiles`,
  `trips`, `trip_participants`, `pois`, `itinerary_items`, `contacts`,
  `vault_docs`, `checklists`, con RLS basata su funzioni `SECURITY DEFINER`
  per evitare ricorsioni).

---

## Meteo

API gratuita **Open-Meteo** (nessuna chiave richiesta): geocoding per
risolvere la destinazione, previsioni fino a 16 giorni; oltre quell'orizzonte
usa i **dati storici dell'anno precedente** come stima, segnalandoli
esplicitamente in UI come tali.

---

## Scansione documenti (OCR)

Tutto **client-side**, nessun upload a servizi esterni:
- `js/scan.js` — estrazione testo da immagini/PDF con Tesseract.js
  (italiano + inglese) e pdf.js (prova prima il livello testo digitale dei
  PDF, poi rasterizza e fa OCR se il PDF è una scansione). Preprocessing
  immagini: orientamento da EXIF, scala di grigi, ridimensionamento
  ottimale, binarizzazione adattiva Sauvola per foto scattate con
  illuminazione irregolare.
- `js/ocr.js` — interpreta il testo estratto: MRZ di passaporti/carte
  d'identità (formati TD1/TD3), più PNR, numero biglietto, volo, tratta,
  gate, posto, orari check-in/out, email, telefono, partita IVA, indirizzo.
  Genera anche gli avvisi di scadenza documenti (regola dei 6 mesi di
  validità residua richiesta da molti paesi extra-UE).

---

## Stile visivo

- **Tema chiaro/scuro** commutabile dal pulsante `#btn-theme`.
- **Liquid Glass** (`assets/liquid-glass.css`, additivo, non modifica
  `styles.css`): superfici in vetro traslucido con blur, livello di sfondo
  fisso (pattern "mappa" astratto + velo colore; il layer fotografico
  punta a `assets/bg-day.jpg`/`bg-night.jpg`, **file non presenti nel
  repo** — resta sempre il fallback a gradiente), dock di navigazione
  fluttuante su mobile. Fallback automatico su browser senza
  `backdrop-filter`.
  - **`body` non deve mai avere un proprio `background` opaco**: i livelli
    fissi (`body::before`/`::after`, `position:fixed`, coprono sempre
    tutto il viewport) sono l'unico sfondo. Un colore/gradiente su `body`
    lo coprirebbe solo per l'altezza del suo contenuto reale (spesso più
    corta del viewport, es. schermate vuote), lasciando sotto una cucitura
    visibile dove i livelli fissi tornano scoperti. `body { background:
    transparent !important; }` in liquid-glass.css.
  - **Safari/WebKit disegna un bordo visibile su elementi con
    `backdrop-filter`** anche a sfondo/bordo trasparenti (Chromium no —
    un bug così non si vede nei test automatici locali, serve verifica su
    device reale o quantomeno un cambio di prospettiva quando qualcosa
    "sembra sparito" su Chromium ma l'utente lo segnala ancora presente).
    Dentro elementi pensati come un unico pezzo (es. la pillola input+
    bottone della chat) va azzerato esplicitamente, non solo bordo/ombra.
  - Le ombre `--lg-depth-*` sono tarate per pannelli grandi: su elementi
    piccoli e flottanti (dock mobile) `--lg-depth-3` lascia un alone
    sproporzionato — verificare quale profondità sta bene sull'elemento,
    non riusare la più "alta" per default.
- **Cache-busting sui CSS**: `index.html` carica
  `styles.css?v=N`/`liquid-glass.css?v=N` — **incrementare N ad ogni
  modifica rilevante ai due file**. Senza, una PWA installata su iOS può
  continuare a servire da cache il CSS vecchio per giorni dopo un deploy,
  anche se `index.html` stesso viene ricaricato (nessun service worker
  gestisce l'invalidazione).
- **PWA installabile**: manifest valido, icone 192/512 (any + maskable),
  `display: standalone`. (Non verificato in questa sessione: presenza di un
  service worker per il funzionamento offline.)

---

## ✦ Assistente virtuale — lettura e scrittura, backend su Supabase

Il tab Assistente (raggiungibile solo dal pulsante flottante
`#btn-ai-fab`, niente bottone in nav) e `js/assistant.js` raccolgono il
contesto del viaggio (destinazione, date, meteo, checklist, bagagli,
itinerario, POI, contatti — **mai** file o note del Vault, solo
tipo/scadenza documenti) e chiamano direttamente una **Supabase Edge
Function**, `supabase/functions/assistant/index.ts` (Deno). Architettura
scelta deliberatamente per non dover gestire un server Node separato: il
frontend statico vive su GitHub (Pages), il backend è una function
serverless nello stesso progetto Supabase già usato per auth e dati.

**Lettura e scrittura, sempre con conferma esplicita**: oltre a rispondere
a parole (`data.text`, mostrato come bolla), l'assistente può proporre
modifiche in QUATTRO e sole categorie — **POI** (`Store.s.pois`),
**attività dell'itinerario** (`Store.s.itinerary`), **contatti**
(`Store.s.contacts`), **voci della checklist** (`Store.s.checklist`).
Esplicitamente fuori scope, mai toccati: documenti del Vault, config del
viaggio (`Store.s.trip`), bagagli (`Store.s.bags`), account/condivisione.

- **Lato Edge Function**: la chiamata a `/v1/messages` passa un set di 12
  `tools` (schema JSON — `add_poi`/`edit_poi`/`delete_poi`, stesso terzetto
  per `_contact`, `_itinerary_activity`, `_checklist_item`). Claude decide
  da solo se rispondere solo a parole o proporre azioni (`tool_choice`
  default "auto"); i blocchi `tool_use` della risposta vengono estratti e
  restituiti al client come `actions: [{tool, input}]` insieme al testo —
  la function non li esegue mai, non ha accesso allo stato locale del
  dispositivo (vive solo Supabase-side).
- **Lato client** (`js/assistant.js`): ogni azione ricevuta viene **sempre
  rivalidata** prima di poter anche solo comparire in chat (mai fidarsi
  ciecamente dell'output del modello) — tool tra i 12 consentiti, id
  esistente per modifica/cancellazione, campi obbligatori per
  un'aggiunta, enum validi (categoria POI, tipo contatto, fascia oraria,
  categoria checklist). Le azioni valide compaiono come riepilogo in chat
  (bolla bot riusata come contenitore, stile "Liquid Glass" automatico)
  con due bottoni "Annulla"/"✅ Applica": **nessuna scrittura su `Store.s`
  avviene prima del click su Applica**. Alla conferma ogni azione viene
  *rivalidata una seconda volta* (lo stato può essere cambiato nel
  frattempo) e poi eseguita con lo stesso pattern usato altrove — id via
  `Store.uid()`/`Store.uuid()`, `Store.tombstone()` per le cancellazioni
  di POI/contatti/itinerario (la checklist non ha tombstone, resta privata
  per utente come il resto del suo storico), `Store.save()`, seguito da
  `UI.renderContacts()`/`renderItinerary()`/`renderChecklist()`/
  `renderDashboard()`.
- Il contesto inviato a Claude ora include l'**id** di ogni POI/contatto/
  voce checklist (necessario per riferirsi a una voce esistente in modo
  univoco, mai per nome) e i contatti (prima assenti dal contesto).

**Storico persistito**: `Store.s.assistantHistory` (nuovo campo in
`blank()`, gestito da `load()`/`save()` come il resto dello stato locale),
limitato alle ultime 60 battute, mai sincronizzato su Supabase (resta
locale come i documenti del Vault). Bottone "🗑️ Nuova conversazione"
nell'header della chat svuota lo storico. Nota: la Edge Function limita
comunque separatamente l'invio a Claude alle ultime 12 battute
(`callClaude` in `index.ts`), indipendentemente da quante ne sono
salvate in locale.

La function inoltra i messaggi a `api.anthropic.com/v1/messages`
(modello `claude-opus-5`) con un system prompt che: usa solo il contesto
del viaggio ricevuto, limita lo storico alle ultime 12 battute, e
**rifiuta in una riga le domande non legate al viaggio** (per non
consumare crediti su richieste fuori scopo). Applica anche un rate limit
di 20 richieste/10 minuti per IP (in memoria — si azzera ai cold start
dell'istanza, accettabile per un uso personale).

Verificato: sintassi/tipi controllati con `tsc`, comportamento
end-to-end confermato con Playwright (URL chiamata, corpo della
richiesta, rendering della risposta in chat).

**Per attivarla**:
```
supabase functions deploy assistant --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
La chiave non va mai incollata nel codice, in chat o nel repo — solo nei
secret del progetto Supabase (Dashboard → Edge Functions → Secrets, o CLI
come sopra). `--no-verify-jwt` perché l'assistente funziona anche senza
login, come il resto dell'app (dati letti da `localStorage`).

`server.js` è tornato a essere solo un server statico per lo sviluppo
locale (nessuna logica dell'assistente lì) — coerente con l'architettura
"tutto tra GitHub e Supabase", nessun host Node da mantenere in
produzione.

---

## File di riferimento

- `GUIDA_SUPABASE.md` — configurazione Supabase, template email, URL di
  redirect, limiti di invio, pulizia doppioni storici.
- `supabase_schema.sql` — schema completo del database, idempotente.
- `avvia.bat` — avvio rapido del server locale su Windows.
