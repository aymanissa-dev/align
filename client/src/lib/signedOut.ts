const KEY = 'align-signed-out'

export function markSignedOut(): void {
  sessionStorage.setItem(KEY, '1')
}

export function clearSignedOut(): void {
  sessionStorage.removeItem(KEY)
}

export function wasSignedOut(): boolean {
  return sessionStorage.getItem(KEY) === '1'
}
