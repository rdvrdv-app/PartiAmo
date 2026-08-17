# PartiAmo — configurazione di Supabase

Questa guida copre i due problemi segnalati: **l'email che arriva con il link
invece del codice a 6 cifre** e **il viaggio che non si vede sugli altri
dispositivi**. Il primo si risolve nel pannello Supabase (5 minuti), il secondo
eseguendo lo script SQL aggiornato.

---

## 1. Aggiorna il database (risolve il viaggio che non si vede)

**Questa è la correzione più importante.** Le vecchie regole di sicurezza (RLS)
contenevano una ricorsione: la policy di `trip_participants` interrogava
`trip_participants` stessa. PostgreSQL la rileva e **fa fallire ogni lettura**:

```
ERROR:  infinite recursion detected in policy for relation "trip_participants"
```

Risultato: l'app chiedeva l'elenco dei viaggi, riceveva un errore, lo
interpretava come "nessun viaggio" e mostrava una schermata vuota. Il viaggio
era regolarmente salvato nel database, ma **nessun dispositivo riusciva a
rileggerlo** — né il telefono, né il PC dopo la cancellazione dei cookie.

### Cosa fare

1. Apri il progetto su [supabase.com](https://supabase.com) → **SQL Editor**
2. Incolla ed esegui l'intero contenuto di [`supabase_schema.sql`](supabase_schema.sql)

Lo script è **idempotente**: si può eseguire su un progetto già avviato senza
perdere dati. Aggiorna policy, aggiunge le colonne mancanti e crea i profili per
gli account registrati prima del trigger.

---

## 2. Fai arrivare il codice a 6 cifre nell'email

Supabase decide **dal template dell'email** se spedire un link, un codice o
entrambi: il campo `{{ .Token }}` è il codice a 6 cifre, `{{ .ConfirmationURL }}`
è il link. Il template predefinito contiene solo il link — ecco perché arrivava
solo quello.

1. Pannello Supabase → **Authentication** → **Emails** → template **Magic Link**
2. Sostituisci il contenuto con questo (tiene entrambe le modalità):

```html
<h2>Accedi a PartiAmo</h2>

<p>Il tuo codice di accesso è:</p>
<p style="font-size:32px; font-weight:bold; letter-spacing:6px">{{ .Token }}</p>
<p>Inseriscilo nell'app. Vale 1 ora e una sola volta.</p>

<hr>

<p>Oppure, se stai leggendo questa mail sullo stesso dispositivo da cui hai
richiesto l'accesso, clicca qui:</p>
<p><a href="{{ .ConfirmationURL }}">Entra in PartiAmo</a></p>
```

3. Salva.

Il codice è più affidabile del link quando si legge la posta sul telefono e si
vuole entrare dal PC: **il link, una volta aperto, si consuma**, quindi cliccarlo
sul telefono lo rende inutilizzabile sul PC.

> L'app ora accetta **entrambe le cose** nella stessa casella: le 6 cifre oppure
> il link copiato e incollato per intero. Se il template non viene aggiornato,
> basta incollare il link e l'accesso funziona ugualmente.

---

## 3. Autorizza gli indirizzi di ritorno

Se il link riporta a una pagina sbagliata (o a `localhost`), manca
l'autorizzazione dell'URL.

Pannello → **Authentication** → **URL Configuration**:

| Campo | Valore |
|---|---|
| **Site URL** | l'indirizzo da cui usi l'app (es. `https://miosito.it/partiamo/`) |
| **Redirect URLs** | lo stesso indirizzo, più eventuali varianti (`http://localhost:8000/` per le prove locali) |

L'app chiede sempre di tornare all'indirizzo corrente **senza query string**,
quindi è sufficiente elencare la pagina base.

---

## 4. Limiti di invio delle email

Il servizio email incluso in Supabase è pensato per lo sviluppo: **poche email
all'ora**. Se compare "rate limit exceeded", attendi qualche minuto. Per un uso
reale conviene collegare un servizio SMTP proprio (Settings → Authentication →
SMTP Settings): Resend, Brevo e Mailgun hanno piani gratuiti sufficienti.

---

## 5. (Facoltativo) Ripulire i doppioni già in archivio

La versione precedente dell'app assegnava ai POI e ai contatti un id non-UUID:
il database ne creava uno nuovo a ogni salvataggio, **duplicando le schede**.
Il problema non si ripresenta, ma i doppioni già creati restano.

Per contarli:

```sql
select trip_id, name, count(*)
from public.pois group by trip_id, name having count(*) > 1;
```

Per rimuoverli tenendo la copia più recente:

```sql
delete from public.pois p
using public.pois q
where p.trip_id = q.trip_id and p.name = q.name and p.created_at < q.created_at;

delete from public.contacts p
using public.contacts q
where p.trip_id = q.trip_id and p.name = q.name and p.created_at < q.created_at;
```

---

## Come funziona ora la sincronizzazione

| Dato | Dove vive | Condiviso con i compagni di viaggio |
|---|---|---|
| Viaggio, date, tratta, bagagli | Cloud | Sì |
| POI, contatti, itinerario | Cloud | Sì |
| Checklist e voci escluse | Cloud, per singolo utente | No |
| Documenti del Vault e allegati | Solo sul dispositivo (IndexedDB) | No |

- **All'accesso** l'app scarica il viaggio e fonde i dati con quelli presenti sul
  dispositivo: niente viene sovrascritto alla cieca.
- **Rientrando nell'app** (cambio scheda, riapertura) si riallinea con il cloud,
  al massimo una volta ogni 30 secondi.
- **Le cancellazioni** viaggiano per identificativo, quindi non travolgono le
  schede aggiunte nel frattempo dagli altri.
- **I file allegati restano sul dispositivo**: non vengono caricati online, e un
  ripristino dal cloud non cancella quelli già presenti in locale.

### Accedere da un secondo dispositivo

1. Usa **la stessa email** del primo accesso: è l'unica cosa che lega i viaggi.
2. Inserisci il codice a 6 cifre (o incolla il link ricevuto).
3. Il viaggio compare da solo, con POI, contatti, itinerario e checklist.

I documenti del Vault, per scelta, **non si spostano**: restano sul dispositivo
su cui sono stati archiviati.
