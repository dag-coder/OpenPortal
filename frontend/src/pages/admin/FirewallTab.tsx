import React, { useState, useEffect } from 'react'
import { api, type FirewallRule } from '../../lib/api'
import { Spinner, EmptyState, ConfirmDialog } from '../../components/ui'

const ACTION_COLORS = {
  allow: { bg: 'rgba(0,204,120,0.12)', color: 'var(--green)', label: 'Allow' },
  deny:  { bg: 'rgba(220,53,69,0.12)',  color: 'var(--red)',   label: 'Deny'  },
}

const PRESET_CIDRS = [
  { label: 'Private LAN 10.x.x.x',    cidr: '10.0.0.0/8' },
  { label: 'Private LAN 172.16–31.x',  cidr: '172.16.0.0/12' },
  { label: 'Private LAN 192.168.x.x',  cidr: '192.168.0.0/16' },
  { label: 'WireGuard default subnet', cidr: '10.10.0.0/24' },
  { label: 'Localhost',                cidr: '127.0.0.1/32' },
]

export default function FirewallTab() {
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FirewallRule | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('deny')
  const [newCIDR, setNewCIDR] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPriority, setNewPriority] = useState(100)
  const [cidrError, setCidrError] = useState('')

  async function load() {
    setLoading(true)
    try {
      setRules(await api.firewallRules())
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function validateCIDR(val: string) {
    const cidrRe = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F:]+)\/\d{1,3}$/
    if (!val) return 'IP or CIDR is required'
    if (!cidrRe.test(val.trim())) return 'Enter a valid IP (e.g. 1.2.3.4) or CIDR (e.g. 10.0.0.0/8)'
    return ''
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    const err = validateCIDR(newCIDR)
    if (err) { setCidrError(err); return }
    setSaving(true)
    try {
      await api.addFirewallRule({ action: newAction, cidr: newCIDR.trim(), description: newDesc, priority: newPriority })
      setShowAdd(false)
      setNewCIDR(''); setNewDesc(''); setNewPriority(100); setCidrError('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add rule')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(rule: FirewallRule) {
    try {
      await api.deleteFirewallRule(rule.id)
      setDeleteTarget(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule')
    }
  }

  async function toggleRule(rule: FirewallRule) {
    try {
      await api.toggleFirewallRule(rule.id, !rule.is_active)
      await load()
    } catch { /* silent */ }
  }

  const denyCount  = rules.filter(r => r.action === 'deny').length
  const allowCount = rules.filter(r => r.action === 'allow').length
  const activeCount = rules.filter(r => r.is_active).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 700, fontSize: 20 }}>IP Firewall</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
            Application-level rules evaluated before every request. First match wins — default is allow.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(s => !s)}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600,
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Rule'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Total rules', value: rules.length, color: 'var(--text)' },
          { label: 'Active', value: activeCount, color: 'var(--green)' },
          { label: 'Deny rules', value: denyCount, color: 'var(--red)' },
          { label: 'Allow rules', value: allowCount, color: 'var(--green)' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 100px', padding: '12px 16px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div style={{
        background: 'rgba(48,63,159,0.08)', border: '1px solid rgba(48,63,159,0.3)',
        borderRadius: 10, padding: 16, fontSize: 13, lineHeight: 1.6,
      }}>
        <strong>How rules work:</strong> Rules are evaluated in <em>priority order</em> (lowest number = checked first).
        The <strong>first matching rule wins</strong>. If no rule matches, the request is <strong>allowed</strong> by default.
        Use <strong>Deny</strong> rules to block specific IPs or ranges, and <strong>Allow</strong> rules to explicitly
        whitelist subnets (e.g., allow your VPN, deny everything else at a higher priority).
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={addRule} style={{
          border: '1px solid var(--border)', borderRadius: 10, padding: 20,
          background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>New Firewall Rule</div>

          {/* Action toggle */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Action</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {(['deny', 'allow'] as const).map(act => {
                const cfg = ACTION_COLORS[act]
                return (
                  <button
                    key={act}
                    type="button"
                    onClick={() => setNewAction(act)}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                      border: `2px solid ${newAction === act ? cfg.color : 'var(--border)'}`,
                      background: newAction === act ? cfg.bg : 'transparent',
                      color: newAction === act ? cfg.color : 'var(--text-dim)',
                      fontWeight: newAction === act ? 700 : 400, transition: 'all 0.15s',
                    }}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* CIDR */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              IP or CIDR range
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                value={newCIDR}
                onChange={e => { setNewCIDR(e.target.value); setCidrError('') }}
                placeholder="192.168.1.0/24 or 203.0.113.5"
                style={{
                  flex: '1 1 200px', padding: '8px 12px', borderRadius: 8, fontSize: 14,
                  border: `1px solid ${cidrError ? 'var(--red)' : 'var(--border)'}`,
                  background: 'var(--bg)', color: 'var(--text)', outline: 'none',
                }}
              />
              <select
                onChange={e => { if (e.target.value) setNewCIDR(e.target.value) }}
                defaultValue=""
                style={{
                  padding: '8px 12px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                }}
              >
                <option value="" disabled>Presets…</option>
                {PRESET_CIDRS.map(p => <option key={p.cidr} value={p.cidr}>{p.label}</option>)}
              </select>
            </div>
            {cidrError && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--red)' }}>{cidrError}</p>}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* Description */}
            <div style={{ flex: '2 1 200px' }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Description <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="e.g. Block Tor exit nodes"
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 14,
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            {/* Priority */}
            <div style={{ flex: '1 1 100px' }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Priority
              </label>
              <input
                type="number"
                value={newPriority}
                onChange={e => setNewPriority(parseInt(e.target.value) || 100)}
                min={1} max={1000}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 14,
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-dim)' }}>Lower = checked first</p>
            </div>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13, margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowAdd(false)}
              style={{ padding: '8px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 700,
                background: newAction === 'deny' ? 'var(--red)' : 'var(--green)',
                color: '#fff', border: 'none', opacity: saving ? 0.7 : 1,
              }}>
              {saving ? 'Saving…' : `Add ${ACTION_COLORS[newAction].label} Rule`}
            </button>
          </div>
        </form>
      )}

      {/* Rules list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
      ) : error && !showAdd ? (
        <div style={{ background: 'rgba(220,53,69,0.1)', border: '1px solid var(--red)',
          borderRadius: 8, padding: 16, color: 'var(--red)', fontSize: 14 }}>
          {error}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState message="No firewall rules — by default all IPs are allowed. Add deny rules to block specific IP ranges." />
      ) : (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
                <th style={TH}>Priority</th>
                <th style={TH}>Action</th>
                <th style={TH}>CIDR / IP</th>
                <th style={TH}>Description</th>
                <th style={TH}>Status</th>
                <th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {[...rules].sort((a, b) => a.priority - b.priority).map(rule => {
                const cfg = ACTION_COLORS[rule.action]
                return (
                  <tr key={rule.id} style={{
                    borderBottom: '1px solid var(--border)',
                    opacity: rule.is_active ? 1 : 0.5,
                    transition: 'opacity 0.2s',
                  }}>
                    <td style={{ ...TD, fontWeight: 700, color: 'var(--text-dim)', textAlign: 'center', width: 70 }}>
                      {rule.priority}
                    </td>
                    <td style={TD}>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                        fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                        background: cfg.bg, color: cfg.color,
                      }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 600 }}>{rule.cidr}</td>
                    <td style={{ ...TD, color: 'var(--text-dim)' }}>
                      {rule.description || <em style={{ opacity: 0.4 }}>no description</em>}
                    </td>
                    <td style={TD}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', width: 'fit-content' }}>
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          onChange={() => toggleRule(rule)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 12, color: rule.is_active ? 'var(--green)' : 'var(--text-dim)' }}>
                          {rule.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </label>
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button
                        onClick={() => setDeleteTarget(rule)}
                        title="Delete rule"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--red)', padding: '4px 8px', borderRadius: 6,
                          fontSize: 14, opacity: 0.7,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete firewall rule"
          message={`Delete the ${deleteTarget.action.toUpperCase()} rule for ${deleteTarget.cidr}?${deleteTarget.description ? ` (${deleteTarget.description})` : ''} This will take effect immediately.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => deleteRule(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
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
