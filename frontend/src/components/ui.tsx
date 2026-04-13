import React from 'react'

// ── Logo ──────────────────────────────────────────────────────────────────────
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt="OpenPortal"
      style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
    />
  )
}

// ── Button ────────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'ghost' | 'danger' | 'outline'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  loading?: boolean
}

const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
  borderRadius: 'var(--radius-sm)', padding: '7px 14px',
  cursor: 'pointer', transition: 'all 0.15s', border: 'none',
}

const btnVariants: Record<BtnVariant, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow-sm)' },
  ghost:   { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' },
  danger:  { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.18)' },
  outline: { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' },
}

export function Button({ variant = 'ghost', loading, children, style, ...props }: ButtonProps) {
  return (
    <button style={{ ...btnBase, ...btnVariants[variant], ...style }} {...props}>
      {loading ? <Spinner size={12} /> : children}
    </button>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: `2px solid var(--border)`,
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

// ── StatusDot ─────────────────────────────────────────────────────────────────
const dotColors: Record<string, string> = {
  online: 'var(--green)',  degraded: 'var(--amber)', offline: 'var(--red)',
  connected: 'var(--green)', idle: 'var(--amber)', disconnected: 'var(--red)',
  active: 'var(--green)', suspended: 'var(--red)',
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: dotColors[status] ?? 'var(--text-dim)', flexShrink: 0,
    }} />
  )
}

// ── Badge / Tag ───────────────────────────────────────────────────────────────
export function Tag({ children, color = 'var(--accent)' }: {
  children: React.ReactNode; color?: string
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      letterSpacing: '0.02em',
      background: color + '18',
      color,
      border: `1px solid ${color}28`,
    }}>
      {children}
    </span>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'var(--border)',
        display: 'flex', alignItems: 'center', padding: 2,
        transition: 'background 0.2s',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        transform: checked ? 'translateX(16px)' : 'none',
        transition: 'transform 0.2s',
      }} />
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 480 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number
}) {
  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, backdropFilter: 'blur(3px)',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-lg)',
        width, maxWidth: '95vw', maxHeight: '88vh',
        overflowY: 'auto',
        animation: 'slideUp 0.2s ease',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-hover)', border: 'none',
              borderRadius: 'var(--radius-sm)', width: 28, height: 28,
              padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0,
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <div style={{ padding: '20px 24px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

// ── FormRow ───────────────────────────────────────────────────────────────────
export function FormRow({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600,
        color: 'var(--text-muted)', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 5 }}>{hint}</p>}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: '16px 20px',
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
export function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 24px',
      color: 'var(--text-dim)', fontSize: 13,
    }}>
      {message}
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────────
export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            {headers.map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '10px 16px',
                fontSize: 11, fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
                whiteSpace: 'nowrap',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Tr({ children, faded }: { children: React.ReactNode; faded?: boolean }) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        transition: 'background 0.1s',
        opacity: faded ? 0.55 : 1,
        borderBottom: '1px solid var(--border)',
      }}
    >
      {children}
    </tr>
  )
}

export function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '11px 16px', ...style }}>{children}</td>
}

// ── SectionHeader ─────────────────────────────────────────────────────────────
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      marginBottom: 14, paddingBottom: 10,
      borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  )
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'default', onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; cancelLabel?: string
  variant?: 'default' | 'danger'; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 500, backdropFilter: 'blur(4px)', animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        width: 400, maxWidth: '92vw', overflow: 'hidden', animation: 'slideUp 0.2s ease',
      }}>
        {variant === 'danger' && <div style={{ height: 3, background: 'linear-gradient(90deg,#EF4444,#F97316)' }} />}
        <div style={{ padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            {variant === 'danger' ? (
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 5v4M8 11v1" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M6.8 1.9L1.2 11.5c-.5.9.1 2 1.2 2h11.2c1.1 0 1.7-1.1 1.2-2L9.2 1.9a1.4 1.4 0 00-2.4 0z" stroke="#EF4444" strokeWidth="1.3"/>
                </svg>
              </div>
            ) : (
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: 'var(--accent-dim)', border: '1px solid rgba(99,102,241,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="var(--accent)" strokeWidth="1.3"/>
                  <path d="M8 7v5M8 5v1" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            )}
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: 24, paddingLeft: 50 }}>{message}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
            <Button
              onClick={onConfirm}
              style={variant === 'danger' ? { background: '#EF4444', color: '#fff', border: 'none' } : { background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── AlertDialog ───────────────────────────────────────────────────────────────
export function AlertDialog({ title, message, variant = 'error', onClose }: {
  title?: string; message: string; variant?: 'success' | 'error' | 'info'; onClose: () => void
}) {
  const cfg = {
    success: { color: 'var(--green)',  bg: 'var(--green-dim)', border: 'rgba(34,197,94,0.2)',  icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l4.5 4.5L14 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    error:   { color: '#EF4444',       bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)',   icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    info:    { color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'rgba(99,102,241,0.2)', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7v5M8 5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  }[variant]
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 500, backdropFilter: 'blur(4px)', animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        width: 380, maxWidth: '92vw', overflow: 'hidden', animation: 'slideUp 0.2s ease',
      }}>
        <div style={{ padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
              background: cfg.bg, border: `1px solid ${cfg.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cfg.color,
            }}>
              {cfg.icon}
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
              {title ?? (variant === 'success' ? 'Success' : variant === 'error' ? 'Error' : 'Notice')}
            </h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: 24, paddingLeft: 50 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={onClose}>OK</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS: Record<string, (s: number) => React.ReactNode> = {
  grid:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  users:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M14.5 13c0-1.93-1.12-3.6-2.75-4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  shield:   s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 1.5L2 4v4c0 3.31 2.69 6 6 6s6-2.69 6-6V4L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  wifi:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M1 5.5C3.8 2.83 11.2 2.83 14 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M3.5 8C5.17 6.5 10.83 6.5 12.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M6 10.5C7 9.67 9 9.67 10 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="13" r="1" fill="currentColor"/></svg>,
  settings: s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M2.93 2.93l1.06 1.06M12.01 12.01l1.06 1.06M13.07 2.93l-1.06 1.06M3.99 12.01l-1.06 1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  plus:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  x:        s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  check:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M2 8l4.5 4.5L14 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  lock:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg>,
  globe:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 2c-1.5 2-2.5 3.8-2.5 6S6.5 12 8 14M8 2c1.5 2 2.5 3.8 2.5 6S9.5 12 8 14M2 8h12" stroke="currentColor" strokeWidth="1.3"/></svg>,
  download: s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  trash:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V3h6v1M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  edit:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3L11 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  logout:   s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M6 3H3a1 1 0 00-1 1v8a1 1 0 001 1h3M10 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  external: s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9M14 2l-6 6M9 2h5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  activity: s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M1 8h3l2-5 3 10 2-5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  key:      s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="6" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8.5 9.5l5 5M11 12l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  chevron:  s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  copy:     s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 11V3a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  clock:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  filter:   s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 8h6M7 12h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  alert:    s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 1.5L1.5 13.5h13L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>,
  ban:      s => <svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M3.76 3.76l8.48 8.48" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
}

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return <>{ICONS[name]?.(size) ?? null}</>
}
