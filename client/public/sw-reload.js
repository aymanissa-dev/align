// Runs inside the generated service worker. skipWaiting and clientsClaim activate
// this worker, but the open page keeps executing the previous precached bundle
// until it loads again. A hard reload still goes through the controlling worker,
// so navigate windows here. The new worker does not activate again after that load.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      await self.clients.claim()
      await Promise.all(
        windows.map(async (client) => {
          if (!client.url.startsWith(self.location.origin)) return
          try {
            await client.navigate(client.url)
          } catch {
            // The page reloads itself on controllerchange when navigate is refused.
          }
        }),
      )
    })(),
  )
})
