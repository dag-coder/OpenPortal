import React, { useState, useEffect, useCallback } from 'react'
import { api, type AuditLogEntry } from '../../lib/api'
import { Spinner, EmptyState } from '../../components/ui'

const SEV_CONFIG = {
  info:     { color: 'var(--green)',  label: 'Info',     bg: 'rgba(0,204,120,0.12)' },
  warn:     { color: 'var(--amber)',  label: 'Warning',  bg: 'rgba(255,193,7,0.12)' },
  critical: { color: 'var(--red)',    label: 'Critical', bg: 'rgba(220,53,69,0.12)' },
}

const ACTION_GROUPS: Record<string, string[]> = {
  Authentication: [
    'LOGIN_SUCCESS','LOGIN_FAILED','LOGIN_SUSPENDED','LOGIN_TOTP_REQUIRED',
    'LOGIN_TOTP_SUCCESS','LOGIN_TOTP_FAILED','LOGOUT','TOKEN_REJECTED',
    'TOTP_ENABLED','TOTP_DISABLED',
  ],
  'User Management': [
    'USER_CREATED','USER_UPDATED','USER_DELETED','USER_SUSPENDED','USER_ACTIVATED',
    'USER_ROLE_CHANGED','PASSWORD_CHANGED',
  ],
  Tools: ['TOOL_CREATED','TOOL_UPDATED','TOOL_DELETED','CREDENTIAL_SET','CREDENTIAL_DELETED'],
  Roles: ['ROLE_CREATED','ROLE_DELETED','ROLE_GRANTS_UPDATED'],
  WireGuard: ['WG_PEER_ADDED','WG_PEER_DELETED'],
  Firewall: ['FIREWALL_RULE_ADDED','FIREWALL_RULE_DELETED','FIREWALL_BLOCKED'],
  Proxy: ['PROXY_ACCESS','PROXY_DENIED'],
  Settings: ['SETTINGS_UPDATED'],
}

function formatTime(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function RelativeTime({ ts }: { ts: string }) {
  const abs = formatTime(ts)
  const d = new Date(ts)
  const now = Date.now()
  const diff = Math.floor((now - d.getTime()) / 1000)
  let rel: string
  if (diff < 60)       rel = `${diff}s ago`
  else if (diff < 3600) rel = `${Math.floor(diff / 60)}m ago`
  else if (diff < 86400) rel = `${Math.floor(diff / 3600)}h ago`
  else                  rel = `${Math.floor(diff / 86400)}d ago`
  return <span title={abs} style={{ cursor: 'default' }}>{rel}</span>
}

export default function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.auditLogs({
        severity: severityFilter || undefined,
        search: search.trim() || undefined,
      })
      setLogs(data)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }, [severityFilter, search])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  const sevCounts = { info: 0, warn: 0, critical: 0 }
  for (const l of logs) {
    if (l.severity in sevCounts) sevCounts[l.severity as keyof typeof sevCounts]++
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 700, fontSize: 20 }}>Forensic Audit Log</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
            Immutable record of all authentication events and admin actions
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => { setLoading(true); load() }}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}
          >
            Refresh
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Live (10s)
          </label>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(['info','warn','critical'] as const).map(sev => {
          const cfg = SEV_CONFIG[sev]
          const active = severityFilter === sev
          return (
            <button
              key={sev}
              onClick={() => setSeverityFilter(active ? '' : sev)}
              style={{
                flex: '1 1 100px', padding: '12px 16px', borderRadius: 10,
                border: `2px solid ${active ? cfg.color : 'var(--border)'}`,
                background: active ? cfg.bg : 'var(--card)', cursor: 'pointer',
                transition: 'all 0.15s', textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: cfg.color }}>
                {sevCounts[sev]}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{cfg.label}</div>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Search email, IP, action, details…"
          style={{
            flex: '1 1 240px', padding: '8px 12px', borderRadius: 8, fontSize: 14,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
            outline: 'none',
          }}
        />
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, fontSize: 14,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
          }}
        >
          <option value="">All severities</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="critical">Critical</option>
        </select>
        <button
          onClick={load}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600,
          }}
        >
          Search
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
      ) : error ? (
        <div style={{ background: 'rgba(220,53,69,0.1)', border: '1px solid var(--red)',
          borderRadius: 8, padding: 16, color: 'var(--red)', fontSize: 14 }}>
          {error}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState message="No events found — try adjusting your filters" />
      ) : (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>Severity</th>
                <th style={TH}>Time</th>
                <th style={TH}>Action</th>
                <th style={TH}>Actor</th>
                <th style={TH}>Resource</th>
                <th style={TH}>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const cfg = SEV_CONFIG[log.severity] ?? SEV_CONFIG.info
                const isExpanded = expanded === log.id
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : log.id)}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', transition: 'background 0.1s',
                        background: isExpanded ? 'rgba(48,63,159,0.08)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                      onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <td style={TD}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                          background: cfg.bg, color: cfg.color, textTransform: 'uppercase',
                        }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td style={{ ...TD, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        <RelativeTime ts={log.ts} />
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                        {log.action}
                      </td>
                      <td style={{ ...TD, color: 'var(--text-dim)' }}>
                        {log.actor_email ?? <em style={{ opacity: 0.5 }}>anonymous</em>}
                      </td>
                      <td style={{ ...TD, color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: 12 }}>
                        {log.resource_type && log.resource_id
                          ? `${log.resource_type}/${log.resource_id.slice(0, 8)}…`
                          : log.resource_type ?? '—'}
                      </td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12 }}>
                        {log.ip_address ?? '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: 'rgba(48,63,159,0.04)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={6} style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                            {[
                              ['Event ID', log.id],
                              ['Timestamp', formatTime(log.ts)],
                              ['Action', log.action],
                              ['Severity', log.severity],
                              ['Actor email', log.actor_email],
                              ['Actor ID', log.actor_id],
                              ['Resource type', log.resource_type],
                              ['Resource ID', log.resource_id],
                              ['Details', log.details],
                              ['IP address', log.ip_address],
                              ['User agent', log.user_agent],
                            ].map(([label, value]) => value ? (
                              <div key={label as string}>
                                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                  {label}
                                </div>
                                <div style={{ fontSize: 13, marginTop: 2, wordBreak: 'break-all', fontFamily: label === 'User agent' || label === 'Event ID' ? 'monospace' : undefined }}>
                                  {value}
                                </div>
                              </div>
                            ) : null)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && logs.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', margin: 0 }}>
          Showing latest {logs.length} events. Click any row to expand details.
        </p>
      )}
    </div>
  )
}

const TH: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-dim)',
}

const TD: React.CSSProperties = {
  padding: '10px 14px',
}
