// Auth store using useSyncExternalStore (React 18 built-in)
// No zustand, no external deps, no ESM/CJS issues
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'op-auth-v2'

export interface AuthUser {
  email: string
  name: string
  is_admin: boolean
}

interface AuthState {
  user: AuthUser | null
  token: string | null
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadState(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { user: null, token: null }
    const parsed = JSON.parse(raw)
    if (!parsed?.user?.email) return { user: null, token: null }
    return { user: parsed.user, token: parsed.token ?? null }
  } catch {
    return { user: null, token: null }
  }
}

function saveState(s: AuthState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

// Clear stale keys from old versions
try { localStorage.removeItem('op-auth') } catch { /* ignore */ }

// ── Store ─────────────────────────────────────────────────────────────────────

let _state: AuthState = loadState()
const _listeners = new Set<() => void>()

function notify() {
  _listeners.forEach(l => l())
}

function getSnapshot(): AuthState {
  return _state
}

function subscribe(listener: () => void): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export const authActions = {
  setAuth(user: AuthUser, token: string) {
    _state = { user, token }
    saveState(_state)
    notify()
  },
  clearAuth() {
    _state = { user: null, token: null }
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    notify()
  },
}

// ── React hook ────────────────────────────────────────────────────────────────
// Returns the full state — stable reference, only changes when setAuth/clearAuth called

export function useAuthStore(): AuthState & typeof authActions {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { ...state, ...authActions }
}
