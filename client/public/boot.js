if ('serviceWorker' in navigator) {
  var hadController = !!navigator.serviceWorker.controller
  var reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) {
      hadController = true
      return
    }
    if (reloading) return
    reloading = true
    location.reload()
  })
  window.addEventListener('load', function () {
    navigator.serviceWorker.getRegistration().then(function (registration) {
      if (registration) registration.update()
    })
  })
}

function recoverStaleClient() {
  var key = 'align-sw-reset'
  try {
    if (sessionStorage.getItem(key) === '1') return
    sessionStorage.setItem(key, '1')
  } catch (e) {
    return
  }
  var jobs = []
  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        return Promise.all(
          registrations.map(function (registration) {
            return registration.unregister()
          }),
        )
      }),
    )
  }
  if (window.caches) {
    jobs.push(
      caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (name) {
            return caches.delete(name)
          }),
        )
      }),
    )
  }
  Promise.all(jobs).then(
    function () {
      location.reload()
    },
    function () {
      location.reload()
    },
  )
}

// A hashed module answered with HTML (or a missing chunk) means the installed worker is stale.
window.addEventListener(
  'error',
  function (event) {
    var target = event.target
    if (!target || target === window) return
    var url = target.src || target.href || ''
    if (url.indexOf('/assets/') === -1) return
    recoverStaleClient()
  },
  true,
)

window.setTimeout(function () {
  if (document.documentElement.dataset.booted === '1') return
  recoverStaleClient()
}, 8000)

try {
  var theme = localStorage.getItem('align-theme') || 'system'
  var dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
  document.documentElement.dataset.theme = theme
} catch (e) {}
