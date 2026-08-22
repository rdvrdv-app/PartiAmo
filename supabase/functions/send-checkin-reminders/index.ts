// supabase/functions/send-checkin-reminders/index.ts
// Edge Function schedulata (cron): manda una notifica push "check-in
// aperto" ~24 ore prima della partenza del volo, anche ad app chiusa.
//
// Perché esiste come funzione a sé, non nel client: una notifica ad app
// chiusa può partire solo se qualcosa che gira SEMPRE (un server) sa
// quando svegliare il dispositivo — il browser da solo non può farlo.
//
// Non tocca MAI il Vault: legge solo trips.prefs->>'departureAt' e
// prefs->>'returnDepartureAt' (andata e ritorno), campi inseriti a mano
// apposta per questo (vedi tab Viaggio), separati dai documenti del Vault
// che restano locali sul dispositivo.
//
// Deploy: supabase functions deploy send-checkin-reminders --no-verify-jwt
// (--no-verify-jwt perché la chiama il cron con un segreto proprio, non un
// utente loggato — vedi CRON_SECRET più sotto)
//
// Secret da configurare (supabase secrets set NOME=valore):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (es. mailto:tu@esempio.it)
//   CRON_SECRET (stringa a piacere: la stessa va messa nell'header
//     x-cron-secret della chiamata pg_cron, così solo il cron può invocarla)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già disponibili di default
// in ogni Edge Function, non vanno impostati a mano.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@partiamo.app";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const HOURS_BEFORE = 24;

interface TripRow {
  id: string;
  prefs: { departureAt?: string; returnDepartureAt?: string } | null;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notified_for: string | null;
  notified_for_return: string | null;
}

Deno.serve(async (req: Request) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorizzato", { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: "Function non configurata: mancano secret (VAPID_*/CRON_SECRET)." }), { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const now = new Date();
  let sent = 0, skipped = 0, cleaned = 0, tripsChecked = 0;

  const { data: trips, error: tripsErr } = await supabase
    .from("trips")
    .select("id, prefs");
  if (tripsErr) {
    return new Response(JSON.stringify({ error: tripsErr.message }), { status: 500 });
  }

  // Una gamba di volo (andata o ritorno) da notificare: stesso trattamento
  // per entrambe, solo cambiano il campo prefs letto e quello notified_for
  // in cui si tiene traccia dell'invio, così le due notifiche restano
  // indipendenti (compilare solo il ritorno notifica solo il ritorno).
  const legs: { label: string; field: keyof SubRow; departureLabel: string }[] = [
    { label: "andata", field: "notified_for", departureLabel: "departureAt" },
    { label: "ritorno", field: "notified_for_return", departureLabel: "returnDepartureAt" },
  ];

  for (const trip of (trips || []) as TripRow[]) {
    for (const leg of legs) {
      const departureAt = trip.prefs && (trip.prefs as Record<string, string | undefined>)[leg.departureLabel];
      if (!departureAt) continue;
      const dep = new Date(departureAt);
      if (isNaN(dep.getTime())) continue;

      const notifyAt = new Date(dep.getTime() - HOURS_BEFORE * 3600 * 1000);
      // Fuori dalla finestra "da notifyAt fino alla partenza": troppo presto,
      // o il volo è già partito (non si notifica un check-in passato).
      if (now < notifyAt || now >= dep) continue;
      tripsChecked++;

      const { data: subs, error: subsErr } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, notified_for, notified_for_return")
        .eq("trip_id", trip.id);
      if (subsErr || !subs) continue;

      for (const sub of subs as SubRow[]) {
        if (sub[leg.field] === departureAt) { skipped++; continue; }

        const payload = JSON.stringify({
          title: "✈️ Check-in volo",
          body: `Il check-in per il tuo volo di ${leg.label} potrebbe essere aperto: partenza tra circa ${HOURS_BEFORE} ore.`,
          tag: "checkin-" + leg.label + "-" + trip.id,
          url: "./",
        });

        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent++;
          await supabase.from("push_subscriptions").update({ [leg.field]: departureAt }).eq("id", sub.id);
        } catch (e) {
          const statusCode = e && typeof e === "object" && "statusCode" in e ? (e as { statusCode?: number }).statusCode : undefined;
          if (statusCode === 404 || statusCode === 410) {
            // Iscrizione scaduta/revocata lato browser: ritentarla non avrebbe senso.
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            cleaned++;
          } else {
            console.error("push failed", trip.id, sub.id, e instanceof Error ? e.message : e);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ tripsChecked, sent, skipped, cleaned }), {
    headers: { "content-type": "application/json" },
  });
});
