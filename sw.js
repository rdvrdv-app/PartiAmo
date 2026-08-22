// sw.js — service worker minimale: gestisce solo le notifiche push (check-in
// volo), nessuna cache applicativa. L'aggiornamento dei file statici passa
// già dal cache-busting ?v=N nei tag <link>/<script> di index.html: un
// service worker con cache propria complicherebbe quel meccanismo invece
// di aiutarlo, quindi qui non se ne apre uno.
// Registrato relativo (non "/sw.js") così lo scope resta la cartella
// dell'app su GitHub Pages, non l'intero dominio.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PartiAmo";
  const options = {
    body: data.body || "Controlla il check-in del tuo volo.",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    tag: data.tag || "checkin",
    data: { url: data.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
