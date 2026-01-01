/**
 * Service Worker for push notifications.
 */

// eslint-disable-next-line no-undef
self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// eslint-disable-next-line no-undef
self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  // Claim all clients immediately
  event.waitUntil(self.clients.claim());
});

// eslint-disable-next-line no-undef
self.addEventListener('push', (event) => {
  console.log('Push event received:', event);

  if (!event.data) {
    console.warn('Push event has no data');
    return;
  }

  let data;
  try {
    // Try to parse as JSON
    const text = event.data.text();
    // Handle Python dict format (single quotes) by replacing with double quotes
    const jsonText = text.replace(/'/g, '"');
    data = JSON.parse(jsonText);
  } catch (error) {
    console.error('Failed to parse push data:', error);
    data = {
      title: 'Task Reminder',
      body: event.data.text(),
      tag: 'reminder',
      url: '/',
    };
  }

  const options = {
    body: data.body || 'You have a task reminder',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: data.tag || 'notification',
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/',
      item_id: data.item_id,
    },
    actions: [
      {
        action: 'done',
        title: 'Done',
      },
      {
        action: 'respond',
        title: 'Respond',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Task Reminder', options)
  );
});

// eslint-disable-next-line no-undef
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);

  event.notification.close();

  const url = event.notification.data?.url || '/';
  const itemId = event.notification.data?.item_id;

  // Handle action buttons
  if (event.action === 'done') {
    // Mark as done - open app to response modal with pre-filled "done"
    const respondUrl = itemId ? `/list?respond=${itemId}&action=done` : url;
    event.waitUntil(openWindow(respondUrl));
  } else if (event.action === 'respond') {
    // Open response modal
    const respondUrl = itemId ? `/list?respond=${itemId}` : url;
    event.waitUntil(openWindow(respondUrl));
  } else {
    // Default click - open the URL
    const targetUrl = itemId ? `/list?respond=${itemId}` : url;
    event.waitUntil(openWindow(targetUrl));
  }
});

async function openWindow(url) {
  // Try to find an existing window/tab
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  // Check if there's already a window we can use
  for (const client of clients) {
    if (client.url.includes(self.location.origin)) {
      // Navigate existing window
      await client.navigate(url);
      return client.focus();
    }
  }

  // Open new window
  return self.clients.openWindow(url);
}

// Handle notification close (user dismissed)
// eslint-disable-next-line no-undef
self.addEventListener('notificationclose', (event) => {
  console.log('Notification dismissed:', event.notification.tag);
  // Could track dismissals here if needed
});
