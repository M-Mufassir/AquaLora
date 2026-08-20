import { create } from 'zustand'
import type { Reading, Score, Alert, NodeRow, Settings } from '../../../shared/types'

export interface NodeStatus {
  online: boolean
  batteryPct: number | null
  rssi: number | null
  lastSeen: string | null
}

export interface NodeState {
  latest: Reading | null
  latestScore: Score | null
  status: NodeStatus
}

export type LinkStatus = 'connected' | 'reconnecting'

export interface CurrentUser {
  username: string
  role: string
}

const EMPTY_STATUS: NodeStatus = { online: false, batteryPct: null, rssi: null, lastSeen: null }
export const EMPTY_NODE_STATE: NodeState = { latest: null, latestScore: null, status: EMPTY_STATUS }

interface AppState {
  nodesById: Record<string, NodeState>
  knownNodes: NodeRow[]
  alerts: Alert[]
  linkStatus: LinkStatus
  settings: Settings
  currentUser: CurrentUser | null

  setCurrentUser: (user: CurrentUser | null) => void
  setReading: (reading: Reading) => void
  setScore: (score: Score) => void
  addAlert: (alert: Alert) => void
  setAlerts: (alerts: Alert[]) => void
  acknowledge: (id: number) => void
  setLinkStatus: (status: LinkStatus) => void
  setNodeOffline: (nodeId: string) => void
  setKnownNodes: (nodes: NodeRow[]) => void
  upsertKnownNode: (node: NodeRow) => void
  setSettings: (settings: Settings) => void
  setTheme: (theme: 'light' | 'dark') => void
  setSoundEnabled: (enabled: boolean) => void
}

export const useReadingsStore = create<AppState>((set, get) => ({
  nodesById: {},
  knownNodes: [],
  alerts: [],
  linkStatus: 'connected',
  settings: { theme: 'dark', soundEnabled: true },
  currentUser: null,

  setCurrentUser: (user) => set({ currentUser: user }),
  setReading: (reading) =>
    set((s) => ({
      nodesById: {
        ...s.nodesById,
        [reading.node_id]: {
          ...(s.nodesById[reading.node_id] ?? EMPTY_NODE_STATE),
          latest: reading,
          status: {
            online: true,
            batteryPct: reading.battery_pct,
            rssi: reading.rssi,
            lastSeen: reading.timestamp
          }
        }
      }
    })),

  setScore: (score) =>
    set((s) => ({
      nodesById: {
        ...s.nodesById,
        [score.node_id]: {
          ...(s.nodesById[score.node_id] ?? EMPTY_NODE_STATE),
          latestScore: score
        }
      }
    })),

  addAlert: (alert) => set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 200) })),
  setAlerts: (alerts) => set({ alerts }),
  acknowledge: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, acknowledged: 1 } : a))
    })),

  setLinkStatus: (status) => set({ linkStatus: status }),

  setNodeOffline: (nodeId) => {
    const node = get().nodesById[nodeId]
    if (!node) return
    set((s) => ({
      nodesById: {
        ...s.nodesById,
        [nodeId]: { ...node, status: { ...node.status, online: false } }
      }
    }))
  },

  setKnownNodes: (nodes) => set({ knownNodes: nodes }),
  upsertKnownNode: (node) =>
    set((s) => ({
      knownNodes: [...s.knownNodes.filter((n) => n.id !== node.id), node].sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    })),

  setSettings: (settings) => set({ settings }),
  setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
  setSoundEnabled: (soundEnabled) => set((s) => ({ settings: { ...s.settings, soundEnabled } }))
}))
