const BASE = import.meta.env.VITE_API_URL || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (res.status === 401) {
    window.dispatchEvent(new Event('op:unauthorized'))
    throw new Error('unauthorized')
  }

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<
      | { token: string; email: string; name: string; is_admin: boolean; totp_required?: false }
      | { totp_required: true; pending_token: string }
    >('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  verifyTOTP: (pending_token: string, code: string) =>
    request<{ token: string; email: string; name: string; is_admin: boolean }>('/api/auth/totp', {
      method: 'POST', body: JSON.stringify({ pending_token, code }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ email: string; name: string; is_admin: boolean }>('/api/me'),

  // TOTP management (self-service)
  totpStatus: () =>
    request<{ enabled: boolean }>('/api/me/totp'),
  totpSetup: () =>
    request<{ provisioning_uri: string; secret: string }>('/api/me/totp/setup', { method: 'POST' }),
  totpEnable: (code: string) =>
    request('/api/me/totp/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  totpDisable: () =>
    request('/api/me/totp', { method: 'DELETE' }),

  // Tools (user-facing)
  tools: () => request<import('../types').Tool[]>('/api/tools'),

  // Admin: Tools
  adminTools: () => request<import('../types').Tool[]>('/api/admin/tools'),
  createTool: (body: Partial<import('../types').Tool>) =>
    request('/api/admin/tools', { method: 'POST', body: JSON.stringify(body) }),
  updateTool: (id: string, body: Partial<import('../types').Tool>) =>
    request(`/api/admin/tools/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTool: (id: string) =>
    request(`/api/admin/tools/${id}`, { method: 'DELETE' }),
  setCredentials: (id: string, creds: Record<string, string>) =>
    request(`/api/admin/tools/${id}/credentials`, { method: 'PUT', body: JSON.stringify(creds) }),

  // Admin: Users
  users: () => request<import('../types').User[]>('/api/admin/users'),
  createUser: (body: { email: string; name: string; password: string; role_id?: string }) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, body: { name: string; email: string; password?: string; role_id?: string; status: string }) =>
    request(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateUserStatus: (id: string, status: string) =>
    request(`/api/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateUserRole: (id: string, role_id: string) =>
    request(`/api/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role_id }) }),
  deleteUser: (id: string) =>
    request(`/api/admin/users/${id}`, { method: 'DELETE' }),

  // Admin: Per-user credentials
  setUserCredentials: (userID: string, toolID: string, creds: Record<string, string>) =>
    request(`/api/admin/users/${userID}/tools/${toolID}/credentials`, {
      method: 'PUT', body: JSON.stringify(creds),
    }),
  getUserCredentials: (userID: string, toolID: string) =>
    request<{ key: string; updated_at: string }[]>(
      `/api/admin/users/${userID}/tools/${toolID}/credentials`
    ),
  deleteUserCredentials: (userID: string, toolID: string) =>
    request(`/api/admin/users/${userID}/tools/${toolID}/credentials`, { method: 'DELETE' }),

  // Admin: Roles
  roles: () => request<import('../types').Role[]>('/api/admin/roles'),
  createRole: (body: { name: string; color: string }) =>
    request('/api/admin/roles', { method: 'POST', body: JSON.stringify(body) }),
  deleteRole: (id: string) =>
    request(`/api/admin/roles/${id}`, { method: 'DELETE' }),
  setRoleTools: (id: string, tool_ids: string[]) =>
    request(`/api/admin/roles/${id}/tools`, { method: 'PUT', body: JSON.stringify({ tool_ids }) }),

  // Admin: WireGuard
  wgPeers: () => request<import('../types').WGPeer[]>('/api/admin/wg/peers'),
  addPeer: (body: { name: string; ip: string; public_key: string }) =>
    request('/api/admin/wg/peers', { method: 'POST', body: JSON.stringify(body) }),
  deletePeer: (id: string) =>
    request(`/api/admin/wg/peers/${id}`, { method: 'DELETE' }),
  wgConfig: () => request<{ config: string }>('/api/admin/wg/config'),
  wgServerInfo: () => request<{
    server_public_key: string
    server_endpoint: string
    listen_port: number
    subnet: string
  }>('/api/admin/wg/server-info'),

  // Admin: Auth detection
  detectAuth: (url: string) =>
    request<{ auth_type: string }>('/api/admin/detect-auth', {
      method: 'POST', body: JSON.stringify({ url }),
    }),

  // Admin: Settings
  settings: () => request<Record<string, unknown>>('/api/admin/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),

  // Admin: Audit logs
  auditLogs: (params?: { severity?: string; action?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (params?.severity) q.set('severity', params.severity)
    if (params?.action) q.set('action', params.action)
    if (params?.search) q.set('search', params.search)
    const qs = q.toString()
    return request<AuditLogEntry[]>(`/api/admin/audit-logs${qs ? '?' + qs : ''}`)
  },

  // Admin: Firewall
  firewallRules: () => request<FirewallRule[]>('/api/admin/firewall'),
  addFirewallRule: (body: { action: string; cidr: string; description: string; priority: number }) =>
    request<FirewallRule>('/api/admin/firewall', { method: 'POST', body: JSON.stringify(body) }),
  deleteFirewallRule: (id: string) =>
    request(`/api/admin/firewall/${id}`, { method: 'DELETE' }),
  toggleFirewallRule: (id: string, active: boolean) =>
    request(`/api/admin/firewall/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ active }) }),

  // Generic methods for ad-hoc API calls
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export interface AuditLogEntry {
  id: string
  ts: string
  actor_id?: string
  actor_email?: string
  action: string
  resource_type?: string
  resource_id?: string
  details?: string
  ip_address?: string
  user_agent?: string
  severity: 'info' | 'warn' | 'critical'
}

export interface FirewallRule {
  id: string
  priority: number
  action: 'allow' | 'deny'
  cidr: string
  description: string
  is_active: boolean
  created_by?: string
  created_at: string
}
