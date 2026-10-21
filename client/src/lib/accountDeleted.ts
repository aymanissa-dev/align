const KEY = 'align-account-deleted'

export function markAccountDeleted(): void {
  sessionStorage.setItem(KEY, '1')
}

export function accountWasDeleted(search: string): boolean {
  if (new URLSearchParams(search).get('deleted') === '1') return true
  if (sessionStorage.getItem(KEY) === '1') {
    sessionStorage.removeItem(KEY)
    return true
  }
  return false
}
