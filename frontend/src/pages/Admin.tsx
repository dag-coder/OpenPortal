import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, authActions } from '../stores/auth'
import { api } from '../lib/api'
import { Icon } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { SecurityModal } from '../components/SecurityModal'
import ToolsTab     from './admin/ToolsTab'
import UsersTab     from './admin/UsersTab'
import RolesTab     from './admin/RolesTab'
import WireGuardTab from './admin/WireGuardTab'
import SettingsTab  from './admin/SettingsTab'
import SecurityTab  from './admin/SecurityTab'

type Tab = 'tools' | 'users' | 'roles' | 'wireguard' | 'security' | 'settings'

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'tools',     label: 'Tools',          icon: 'grid'     },
  { id: 'users',     label: 'Users',          icon: 'users'    },
  { id: 'roles',     label: 'Roles & Access', icon: 'shield'   },
  { id: 'wireguard', label: 'WireGuard',      icon: 'wifi'     },
  { id: 'security',  label: 'Security',       icon: 'alert'    },
  { id: 'settings',  label: 'Settings',       icon: 'settings' },
]

const TAB_LABELS: Record<Tab, string> = {
  tools: 'Tools', users: 'Users', roles: 'Roles & Access',
  wireguard: 'WireGuard', security: 'Security', settings: 'Settings',
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'tools':     return <ToolsTab />
    case 'users':     return <UsersTab />
    case 'roles':     return <RolesTab />
    case 'wireguard': return <WireGuardTab />
    case 'security':  return <SecurityTab />
    case 'settings':  return <SettingsTab />
    default:          return null
  }
}

export default function AdminLayout() {
  const [tab, setTab]                   = useState<Tab>('tools')
  const [securityOpen, setSecurityOpen] = useState(false)
  const [mfaEnabled, setMfaEnabled]     = useState(false)
  const { user }  = useAuthStore()
  const clearAuth = authActions.clearAuth
  const navigate  = useNavigate()

  useEffect(() => {
    api.totpStatus().then(r => setMfaEnabled(r.enabled)).catch(() => {})
  }, [])

  const logout = async () => {
    await api.logout()
    clearAuth()
    navigate('/login')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        background: '#1A2370',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        {/* Logo */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <img
            src="/logo.png" alt="OpenPortal"
            style={{ width: '100%', maxWidth: 150, height: 'auto', objectFit: 'contain', display: 'block' }}
          />
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginTop: 6, textTransform: 'uppercase' }}>
            Admin Console
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(item => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={tab === item.id}
              onClick={() => setTab(item.id)}
            />
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0' }} />
          <NavItem icon="grid" label="Dashboard" active={false} onClick={() => navigate('/dashboard')} />
        </nav>

        {/* User */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: '#303F9F', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff',
          }}>
            {user?.name?.[0]?.toUpperCase() ?? 'A'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name ?? 'Admin'}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
          </div>
          <button
            onClick={() => setSecurityOpen(true)}
            title="Security settings"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: mfaEnabled ? '#4ade80' : 'rgba(255,255,255,0.4)', padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <Icon name="lock" size={14} />
          </button>
          <button
            onClick={logout}
            title="Sign out"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <Icon name="logout" size={14} />
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#F8F9FA', minHeight: '100vh' }}>
        <header style={{
          background: '#fff', borderBottom: '1px solid #DEE2E6',
          padding: '0 28px', height: 54,
          display: 'flex', alignItems: 'center', flexShrink: 0,
        }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, color: '#343A40' }}>
            {TAB_LABELS[tab]}
          </h1>
        </header>

        <main style={{ padding: '24px 28px', flex: 1 }}>
          <ErrorBoundary key={tab} fallback={`Failed to load ${TAB_LABELS[tab]}`}>
            <TabContent tab={tab} />
          </ErrorBoundary>
        </main>
      </div>

      {securityOpen && (
        <SecurityModal
          mfaEnabled={mfaEnabled}
          onClose={() => setSecurityOpen(false)}
          onChanged={() => api.totpStatus().then(r => setMfaEnabled(r.enabled)).catch(() => {})}
        />
      )}
    </div>
  )
}

function NavItem({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 8,
        cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
        background: active ? 'rgba(255,255,255,0.12)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: active ? '#fff' : 'rgba(255,255,255,0.65)',
        fontSize: 13, fontWeight: active ? 600 : 400,
        transition: 'all 0.1s',
      }}
    >
      {active && <div style={{ width: 3, height: 16, borderRadius: 2, background: '#00ACC1', marginLeft: -4, marginRight: 2, flexShrink: 0 }} />}
      <Icon name={icon} size={15} />
      {label}
    </button>
  )
}
