import { create } from 'zustand'
import type {
  WorkspaceTabId,
  WorkspaceTabLocation,
} from '@/components/layout/workspace-tabs'

interface WorkspaceTabsState {
  mounted: WorkspaceTabId[]
  lastLocations: Partial<Record<WorkspaceTabId, WorkspaceTabLocation>>
  visit: (id: WorkspaceTabId, location?: WorkspaceTabLocation) => void
  close: (id: WorkspaceTabId) => void
  reset: () => void
}

function locationsEqual(
  left?: WorkspaceTabLocation,
  right?: WorkspaceTabLocation
) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.pathname !== right.pathname) return false
  const leftSearch = left.search ?? {}
  const rightSearch = right.search ?? {}
  const keys = new Set([...Object.keys(leftSearch), ...Object.keys(rightSearch)])
  for (const key of keys) {
    if (leftSearch[key] !== rightSearch[key]) return false
  }
  return true
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>()((set) => ({
  mounted: [],
  lastLocations: {},
  visit: (id, location) =>
    set((state) => {
      const alreadyCurrent = state.mounted[state.mounted.length - 1] === id
      const nextLastLocations =
        location && !locationsEqual(state.lastLocations[id], location)
          ? { ...state.lastLocations, [id]: location }
          : state.lastLocations
      if (alreadyCurrent && nextLastLocations === state.lastLocations) {
        return state
      }
      return {
        mounted: alreadyCurrent
          ? state.mounted
          : [...state.mounted.filter((item) => item !== id), id],
        lastLocations: nextLastLocations,
      }
    }),
  close: (id) =>
    set((state) => {
      if (!state.mounted.includes(id) && !(id in state.lastLocations)) {
        return state
      }
      const { [id]: _removed, ...lastLocations } = state.lastLocations
      return {
        mounted: state.mounted.filter((item) => item !== id),
        lastLocations,
      }
    }),
  reset: () => set({ mounted: [], lastLocations: {} }),
}))
