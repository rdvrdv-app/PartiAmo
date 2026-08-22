/* push.js — notifica push di check-in volo, anche ad app chiusa.
   Serve un account (l'iscrizione push e l'orario del volo vivono sul
   cloud: è l'unico modo perché un server possa "svegliare" il dispositivo
   quando l'app non è aperta) e, su iPhone, che l'app sia stata aggiunta
   alla schermata Home (iOS 16.4+: Safari normale non supporta le push
   web). Non tocca mai i documenti del Vault, che restano solo locali. */

const Push = (function () {
  // Chiave pubblica VAPID: per definizione pubblica, va nel client. La
  // chiave privata sta solo nei secret della Edge Function lato Supabase.
  const VAPID_PUBLIC_KEY = "BMK8ePwfisrh1hZBGxyKv11a1qrJWzzTbHTxPPPU9EIcMnvzhxkeLa4PZmvvqGT5BYLM4e1c41f8tw0QkR4-klQ";

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  let registration = null;
  async function register() {
    if (!supported()) return null;
    if (!registration) registration = await navigator.serviceWorker.register("sw.js");
    return registration;
  }

  async function getExistingSubscription() {
    if (!supported()) return null;
    const reg = await register();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function enable() {
    if (!supported()) throw new Error("Le notifiche push non sono supportate su questo browser/dispositivo.");
    const trip = Store.s.trip;
    if (!trip.departureAt) throw new Error("Inserisci prima data e ora di partenza del volo.");
    const user = (typeof Supa !== "undefined" && Supa.getUser) ? Supa.getUser() : null;
    if (!user) throw new Error("Serve un account per attivare le notifiche: sincronizzano l'orario del volo.");

    // La riga push_subscriptions punta a un trip_id: senza un viaggio già
    // salvato sul cloud (id UUID reale, non quello locale provvisorio)
    // l'iscrizione non avrebbe a cosa agganciarsi.
    if (!Supa.isUuid(trip.id)) await Store.syncNow();
    if (!Supa.isUuid(Store.s.trip.id)) throw new Error("Salva prima il viaggio (servono almeno destinazione e date).");

    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permesso notifiche negato.");

    const reg = await register();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const json = sub.toJSON();
    const client = Supa.getClient();
    const { error } = await client.from("push_subscriptions").upsert({
      trip_id: Store.s.trip.id,
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      notified_for: null
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return true;
  }

  async function disable() {
    const reg = await register();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const client = (typeof Supa !== "undefined" && Supa.getClient) ? Supa.getClient() : null;
    if (client) await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }

  async function isActive() {
    const sub = await getExistingSubscription().catch(() => null);
    return !!sub;
  }

  function init() {
    const enableBtn = document.getElementById("btn-push-enable");
    const disableBtn = document.getElementById("btn-push-disable");
    const statusEl = document.getElementById("push-status");
    if (!enableBtn || !disableBtn) return;

    async function refresh() {
      const active = await isActive();
      enableBtn.classList.toggle("hidden", active);
      disableBtn.classList.toggle("hidden", !active);
      if (statusEl) {
        statusEl.textContent = active
          ? "🔔 Notifiche attive: un avviso arriverà 24 ore prima della partenza, anche ad app chiusa."
          : "Compila data/ora di partenza qui sopra, poi attiva le notifiche: un avviso arriverà 24 ore prima, anche ad app chiusa.";
      }
    }

    enableBtn.addEventListener("click", async () => {
      enableBtn.disabled = true;
      try {
        await enable();
        if (typeof UI !== "undefined" && UI.toast) UI.toast("🔔 Notifiche attivate");
      } catch (e) {
        if (typeof UI !== "undefined" && UI.toast) UI.toast("⚠️ " + e.message);
      } finally {
        enableBtn.disabled = false;
        refresh();
      }
    });

    disableBtn.addEventListener("click", async () => {
      disableBtn.disabled = true;
      try {
        await disable();
        if (typeof UI !== "undefined" && UI.toast) UI.toast("Notifiche disattivate");
      } finally {
        disableBtn.disabled = false;
        refresh();
      }
    });

    refresh();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { enable, disable, isActive, supported };
})();
