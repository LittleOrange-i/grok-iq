import { create } from 'zustand'
import type { WorkspaceTabId } from '@/components/layout/workspace-tabs'

interface WorkspaceTabsState {
  mounted: WorkspaceTabId[]
  visit: (id: WorkspaceTabId) => void
  close: (id: WorkspaceTabId) => void
  reset: () => void
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>()((set) => ({
  mounted: [],
  visit: (id) =>
    set((state) => {
      if (state.mounted[state.mounted.length - 1] === id) return state
      return {
        mounted: [...state.mounted.filter((item) => item !== id), id],
      }
    }),
  close: (id) =>
    set((state) => {
      if (!state.mounted.includes(id)) return state
      return {
        mounted: state.mounted.filter((item) => item !== id),
      }
    }),
  reset: () => set({ mounted: [] }),
}))
