import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/errors.ts'
import { broadcastWorkspaceChange } from './lib/dataChannel.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Visited lists stay in memory for a day, which is how long the per-user
      // cache keeps them. A shorter lifetime drops /trash from the next save.
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 1
      },
    },
    mutations: {
      networkMode: 'always',
      retry: false,
    },
  },
})

function invalidateQueries(): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['project'] }),
    queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    queryClient.invalidateQueries({ queryKey: ['notes'] }),
    queryClient.invalidateQueries({ queryKey: ['note'] }),
    queryClient.invalidateQueries({ queryKey: ['labels'] }),
    queryClient.invalidateQueries({ queryKey: ['activity'] }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['today'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['search'] }),
    queryClient.invalidateQueries({ queryKey: ['trash'] }),
  ]).then(() => undefined)
}

export function invalidateWorkspace(): Promise<void> {
  broadcastWorkspaceChange()
  return invalidateQueries()
}

export function invalidateFromPeer(): Promise<void> {
  return invalidateQueries()
}
