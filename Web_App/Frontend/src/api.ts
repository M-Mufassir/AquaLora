export const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export type Node = {
  id: number; node_code: string; display_name: string; contact_name?: string | null
  contact_phone?: string | null; site_location?: string | null; pond_type?: string | null
  installed_at?: string | null; role: string; status: string; created_at?: string | null; updated_at?: string | null
}
export type Reading = { id?: number; master_node_id?: number; node_id: string; timestamp: string; temperature?: number | null; turbidity?: number | null; tds?: number | null; ph?: number | null; pond_type?: string | null; battery_pct?: number | null; rssi?: number | null }
export type Alert = { id: number; master_node_id?: number; node_id: string; timestamp: string; parameter: string; severity: string; message: string; created_at?: string }

let token = localStorage.getItem('aqualora_token')
export const session = { get token() { return token }, set token(value: string | null) { token = value; value ? localStorage.setItem('aqualora_token', value) : localStorage.removeItem('aqualora_token') } }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`)
  return body as T
}

export const login = (node_code: string, password: string) => api<{ access_token: string; display_name: string; node_code: string; role: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ node_code, password }) })
