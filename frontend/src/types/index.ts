export interface User {
  id: string
  email: string
  name: string
  role?: string
  role_id?: string
  is_admin: boolean
  mfa_enabled: boolean
  status: 'active' | 'suspended'
  last_seen?: string
  created_at: string
}

export interface Tool {
  id: string
  name: string
  url: string
  category: string
  auth_type: 'none' | 'basic' | 'token' | 'oauth' | 'saml'
  is_private: boolean
  use_wg: boolean
  status: 'online' | 'degraded' | 'offline'
  roles?: string[]
  custom_icon?: string | null
}

export interface Role {
  id: string
  name: string
  color: string
  user_count: number
  tools: string[]
}

export interface WGPeer {
  id: string
  name: string
  internal_ip: string
  public_key: string
  last_handshake?: string
  status: 'connected' | 'idle' | 'disconnected'
}

export interface AuthState {
  token: string | null
  user: { email: string; name: string; is_admin: boolean } | null
  isAuthenticated: boolean
}

export interface ApiError {
  error: string
}
