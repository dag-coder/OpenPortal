import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuthStore, authActions } from '../stores/auth'
import { type Tool } from '../types'
import { StatusDot, Tag, Button, Icon, Spinner } from '../components/ui'
import { SecurityModal } from '../components/SecurityModal'

// ── Favicon / icon ────────────────────────────────────────────────────────────
function faviconUrl(toolUrl: string): string {
  try {
    const u = new URL(toolUrl)
    return `${u.protocol}//${u.host}/favicon.ico`
  } catch { return '' }
}

function ToolIcon({ tool }: { tool: Tool }) {
  const [ok, setOk] = useState<boolean | null>(null)
  const src = tool.custom_icon || faviconUrl(tool.url)

  useEffect(() => {
    if (!src) { setOk(false); return }
    const img = new Image()
    img.onload  = () => setOk(true)
    img.onerror = () => setOk(false)
    img.src = src
  }, [src])

  if (ok) {
    return <img src={src} alt={tool.name} style={{ width: 22, height: 22, objectFit: 'contain' }} />
  }
  return <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent)' }}>{tool.name[0]}</span>
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  online: 'var(--green)', degraded: 'var(--amber)', offline: 'var(--red)',
}

export default function Dashboard() {
  const [tools,         setTools]         = useState<Tool[]>([])
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [category,      setCategory]      = useState('All')
  const [securityOpen,  setSecurityOpen]  = useState(false)
  const [mfaEnabled,    setMfaEnabled]    = useState(false)
  const { user }  = useAuthStore()
  const clearAuth = authActions.clearAuth
  const navigate                = useNavigate()

  useEffect(() => {
    api.totpStatus().then(r => setMfaEnabled(r.enabled)).catch(() => {})
  }, [])

  useEffect(() => {
    api.tools().then(setTools).catch(() => {}).finally(() => setLoading(false))
    const id = setInterval(() => {
      api.tools().then(setTools).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const logout = async () => {
    await api.logout(); clearAuth(); navigate('/login')
  }

  const categories = ['All', ...Array.from(new Set(tools.map(t => t.category ?? '').filter(Boolean)))]
  const filtered = tools.filter(t => {
    const q = search.toLowerCase()
    const name = (t.name ?? '').toLowerCase()
    const cat  = (t.category ?? '').toLowerCase()
    return (name.includes(q) || cat.includes(q)) &&
           (category === 'All' || (t.category ?? '') === category)
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ──────────────────────────────────────── */}
      <header style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 28px', height: 58,
        display: 'flex', alignItems: 'center', gap: 16,
        boxShadow: 'var(--shadow-sm)',
        position: 'sticky', top: 0, zIndex: 10,
        flexShrink: 0,
      }}>
        {/* Logo — image contains text, no need to repeat it */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src="/logo.png"
            alt="OpenPortal"
            style={{ height: 36, width: 'auto', objectFit: 'contain', display: 'block' }}
          />
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 16 }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <input
            placeholder="Search tools..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 30, width: 220 }}
          />
        </div>

        {/* Right */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {user?.is_admin && (
            <Button variant="ghost" onClick={() => navigate('/admin')} style={{ fontSize: 12 }}>
              <Icon name="settings" size={13} /> Admin
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setSecurityOpen(true)}
            style={{ fontSize: 12, position: 'relative' }}
            title="Security settings"
          >
            <Icon name="lock" size={13} />
            {mfaEnabled && (
              <span style={{
                position: 'absolute', top: 4, right: 4,
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--green)', border: '1.5px solid var(--bg)',
              }} />
            )}
          </Button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px 4px 6px',
            background: 'var(--surface-hover)', borderRadius: 20,
            border: '1px solid var(--border)',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, color: '#fff',
            }}>
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{user?.name}</span>
          </div>
          <Button variant="ghost" onClick={logout} style={{ padding: '6px 10px' }} title="Sign out">
            <Icon name="logout" size={14} />
          </Button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────── */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px', width: '100%' }}>

        {/* Category pills */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background:  category === cat ? 'var(--accent)'        : 'var(--surface)',
                color:       category === cat ? '#fff'                  : 'var(--text-muted)',
                border:      category === cat ? '1px solid var(--accent)' : '1px solid var(--border)',
                boxShadow:   category === cat ? 'var(--shadow-sm)'      : 'none',
                transition:  'all 0.15s',
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Count */}
        {!loading && filtered.length > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>
            {filtered.length} tool{filtered.length !== 1 ? 's' : ''}
            {category !== 'All' ? ` in ${category}` : ''}
          </p>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <Spinner size={24} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-dim)', fontSize: 13 }}>
            {search ? `No tools matching "${search}".` : 'No tools available.'}
          </div>
        ) : (
          <div style={{
            display: 'flex', flexWrap: 'wrap',
            gap: 16, justifyContent: 'center',
          }}>
            {filtered.map(tool => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        )}
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

// ── Tool card ─────────────────────────────────────────────────────────────────
function ToolCard({ tool }: { tool: Tool }) {
  const [hovered, setHovered] = useState(false)

  const open = () => window.open(`/proxy/${tool.id}`, '_blank', 'noopener')

  const isOnline = tool.status === 'online'

  return (
    <div
      onClick={open}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 210,
        flexShrink: 0,
        background:   'var(--surface)',
        border:       `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-xl)',
        padding:      '20px 18px 16px',
        cursor:       'pointer',
        transition:   'all 0.15s',
        boxShadow:    hovered ? '0 4px 16px rgba(37,99,235,0.12)' : 'var(--shadow-sm)',
        transform:    hovered ? 'translateY(-2px)' : 'none',
        display:      'flex',
        flexDirection:'column',
        gap:          14,
      }}
    >
      {/* Icon + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 42, height: 42, borderRadius: 'var(--radius-md)',
          background: 'var(--accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}>
          <ToolIcon tool={tool} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: isOnline ? 'var(--green-dim)' : 'var(--slate-dim)',
          border: `1px solid ${isOnline ? 'rgba(16,185,129,0.2)' : 'var(--border)'}`,
          borderRadius: 20, padding: '2px 8px',
        }}>
          <StatusDot status={tool.status} />
          <span style={{ fontSize: 10, fontWeight: 500, color: STATUS_COLOR[tool.status] ?? 'var(--text-muted)', textTransform: 'capitalize' }}>
            {tool.status}
          </span>
        </div>
      </div>

      {/* Name + category */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 3 }}>{tool.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tool.category}</div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {tool.is_private
          ? <Tag color="var(--accent)"><Icon name="wifi" size={10} /> Private</Tag>
          : <Tag color="var(--slate)"><Icon name="globe" size={10} /> Public</Tag>
        }
        <span style={{ color: 'var(--accent)', opacity: hovered ? 1 : 0.4, transition: 'opacity 0.15s' }}>
          <Icon name="external" size={12} />
        </span>
      </div>
    </div>
  )
}
