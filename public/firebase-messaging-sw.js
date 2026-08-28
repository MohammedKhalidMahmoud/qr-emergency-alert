importScripts('./firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp(self.FIREBASE_CONFIG || {});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Emergency alert';
  const options = {
    body: payload.notification?.body || 'A new help request was sent.',
    icon: './icon.svg',
    badge: './icon.svg',
    data: payload.data || {}
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = event.notification.data?.href || '/';
  const target = new URL(href, self.location.origin).href;
  event.waitUntil(clients.openWindow(target));
});
