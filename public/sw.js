self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Hatume Security", body: event.data ? event.data.text() : "" };
  }
  const isUrgent = !!data.urgent;
  event.waitUntil(
    self.registration.showNotification(data.title || "Hatume Security", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: isUrgent ? [300, 150, 300, 150, 300] : [200, 100, 200],
      requireInteraction: isUrgent,
      tag: isUrgent ? undefined : "hatume-notice", // urgent alerts never collapse/replace each other
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/dashboard"));
});
