// Runs inside the generated service worker. skipWaiting and clientsClaim activate
// this worker, but an open tab keeps executing the previous bundle until it loads
// again. Navigate after activate has finished: waiting on the navigation inside
// activate deadlocks, because this worker is what serves that request.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
  setTimeout(() => {
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (!client.url.startsWith(self.location.origin)) continue
          client.navigate(client.url).catch(() => {})
        }
      })
      .catch(() => {})
  }, 50)
})
