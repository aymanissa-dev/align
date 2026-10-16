// Runs inside the generated service worker. skipWaiting and clientsClaim activate
// this worker, but the open page keeps executing the previous precached bundle
// until it loads again. A hard reload still goes through the controlling worker,
// so navigate windows here. Do not await navigate: the navigation is served by
// this worker, and waiting for it inside activate deadlocks the fetch.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await self.clients.claim()
      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue
        void client.navigate(client.url)
      }
    })(),
  )
})
