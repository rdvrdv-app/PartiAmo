# PartiAmo — stato del progetto

Web app di viaggio, vanilla JavaScript senza build step: `index.html` +
`assets/styles.css` (+ `assets/liquid-glass.css`, layer visivo additivo) +
moduli in `js/`, serviti da un piccolo server statico Node (`server.js`,
nessuna dipendenza npm). Backend dati su **Supabase** (Postgres + Auth).

Questo documento descrive cosa fa l'app **oggi**, verificato leggendo il
codice sorgente reale, non un elenco di intenzioni.

---

## Schermate

L'app ha 7 tab (`UI.go(tab)`, cambio di vista senza routing/URL):

### 🏠 Dashboard
Riepilogo del viaggio attivo: destinazione, date, conto alla rovescia alla
partenza, riepilogo bagagli, striscia meteo 7/16 giorni (cliccabile, salta
all'Itinerario), percentuale checklist completata, **avvisi automatici**
(documenti in scadenza, checklist indietro vicino alla partenza, allerte
neve/temporali, forti escursioni termiche), lista dei **prossimi impegni**
(voli/check-in dal Vault, check-in strutture, POI con giorno assegnato,
attività d'itinerario — ordinati cronologicamente), e un blocco
**emergenza** (numero locale, tipo di presa/voltaggio, nota UE/Schengen,
link rapidi a ambasciata/ospedale/farmacia/polizia più vicini).

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
salvato. Ogni giorno mostra meteo e un consiglio testuale generato in base
alle condizioni previste.

### 📇 Contatti
Due liste: **Contatti** (struttura/emergenza/trasporto/ristorante/altro,
con campi su misura come orari di check-in/out) e **POI** (punti
d'interesse con categoria, giorno assegnato, note, allegati). Entrambe
supportano l'incollaggio di un link Google Maps per auto-compilare
nome/indirizzo/categoria (con geocoding inverso e risoluzione dei link
abbreviati `maps.app.goo.gl`), e la scansione OCR di foto (biglietti da
visita, voucher).

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

### ✦ Assistente — interfaccia pronta, backend da fare
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
  `styles.css`): superfici in vetro traslucido con blur, sfondo fotografico
  sfocato + livello mappa astratta, dock di navigazione fluttuante su
  mobile. Fallback automatico su browser senza `backdrop-filter`.
- **PWA installabile**: manifest valido, icone 192/512 (any + maskable),
  `display: standalone`. (Non verificato in questa sessione: presenza di un
  service worker per il funzionamento offline.)

---

## ✦ Assistente virtuale — completo, backend su Supabase

Il tab Assistente, la card suggerimenti in Dashboard e il pulsante
flottante (`js/assistant.js`) raccolgono il contesto del viaggio
(destinazione, date, meteo, checklist, bagagli, itinerario — **mai** file
o note del Vault, solo tipo/scadenza documenti) e chiamano direttamente
una **Supabase Edge Function**, `supabase/functions/assistant/index.ts`
(Deno). Architettura scelta deliberatamente per non dover gestire un
server Node separato: il frontend statico vive su GitHub (Pages), il
backend è una function serverless nello stesso progetto Supabase già
usato per auth e dati.

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
