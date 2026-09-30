export const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export type Node = {
  id: number
  node_code: string
  display_name: string
  contact_name?: string | null
  contact_phone?: string | null
  site_location?: string | null
  pond_type?: string | null
  installed_at?: string | null
  role: string
  status: string
  created_at?: string | null
  updated_at?: string | null
}

export type Reading = {
  id?: number
  master_node_id?: number
  master_node_code?: string
  master_node_name?: string
  node_id: string
  timestamp: string
  temperature?: number | null
  turbidity?: number | null
  tds?: number | null
  ph?: number | null
  pond_type?: string | null
  battery_pct?: number | null
  rssi?: number | null
}

export type Alert = {
  id: number
  master_node_id?: number
  node_id: string
  timestamp: string
  parameter: string
  severity: string
  message: string
  created_at?: string
  synced_at?: string
}

export type DashboardStats = {
  total_facilities: number
  total_sensor_nodes: number
  total_readings: number
  critical_alerts: number
  warning_alerts: number
  avg_temperature?: number | null
  avg_ph?: number | null
  avg_tds?: number | null
  avg_turbidity?: number | null
  avg_battery?: number | null
}

export type SensorNodeConfig = {
  id: number
  master_node_id: number
  master_node_code?: string | null
  master_node_name?: string | null
  node_id: string
  name?: string | null
  location?: string | null
  pond_type?: string | null
  custom_profile?: any
  updated_at?: string | null
}

export interface UserSession {
  access_token: string
  display_name: string
  node_code: string
  role: string
  master_node_id?: number
}

let token = localStorage.getItem('aqualora_token')
let savedUser: UserSession | null = null
try {
  const rawUser = localStorage.getItem('aqualora_user')
  if (rawUser) savedUser = JSON.parse(rawUser)
} catch {
  savedUser = null
}

export const session = {
  get token() {
    return token
  },
  set token(value: string | null) {
    token = value
    if (value) {
      localStorage.setItem('aqualora_token', value)
    } else {
      localStorage.removeItem('aqualora_token')
      localStorage.removeItem('aqualora_user')
      savedUser = null
    }
  },
  get user(): UserSession | null {
    return savedUser
  },
  set user(val: UserSession | null) {
    savedUser = val
    if (val) {
      localStorage.setItem('aqualora_user', JSON.stringify(val))
    } else {
      localStorage.removeItem('aqualora_user')
    }
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`)
  return body as T
}

export const login = async (node_code: string, password: string) => {
  const res = await api<UserSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ node_code, password, client: 'web' })
  })
  session.token = res.access_token
  session.user = res
  return res
}

export const deleteMasterNode = async (id: number): Promise<{ message: string }> => {
  return await api<{ message: string }>(`/admin/master-nodes/${id}`, { method: 'DELETE' })
}

export function exportReadingsToCsv(readings: Reading[], filename = 'aqualora-readings.csv'): void {
  const headers = ['Timestamp', 'Node ID', 'Facility', 'Pond Type', 'Temperature (°C)', 'pH', 'Turbidity (NTU)', 'TDS (ppm)', 'Battery (%)', 'RSSI (dBm)']
  const rows = readings.map((r) => [
    r.timestamp,
    r.node_id,
    r.master_node_code || r.master_node_id || '',
    r.pond_type || 'tilapia',
    r.temperature ?? '',
    r.ph ?? '',
    r.turbidity ?? '',
    r.tds ?? '',
    r.battery_pct ?? '',
    r.rssi ?? ''
  ])

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
  const encodedUri = encodeURI(csvContent)
  const link = document.createElement('a')
  link.setAttribute('href', encodedUri)
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
