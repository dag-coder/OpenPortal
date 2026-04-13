import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { Button, Spinner, Tag, Table, Tr, Td, SectionHeader, Toggle, Icon } from '../../components/ui'
import FirewallTab  from './FirewallTab'
import AuditLogTab  from './AuditLogTab'

// ── Sub-tab types ─────────────────────────────────────────────────────────────
type SubTab = 'autoban' | 'firewall' | 'audit'

const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'autoban',  label: 'Auto-Ban',  icon: 'ban'      },
  { id: 'firewall', label: 'Firewall',  icon: 'lock'     },
  { id: 'audit',    label: 'Audit Log', icon: 'clock'    },
]

// ── Shared types ──────────────────────────────────────────────────────────────
interface BanEntry {
  id: string
  ip: string
  description: string
  created_at: string
  source: 'auto' | 'manual' | 'fail2ban'
}

interface FailureEntry {
  ip: string
  count: number
  last_seen: string
  is_banned: boolean
}

interface BanSettings {
  enabled: boolean
  max_retries: number
  find_time_seconds: number
  ban_duration_seconds: number
}

interface Fail2banStatus {
  available: boolean
  running: boolean
  jail_active: boolean
  banned_count: number
  version: string
}

interface SecurityStatus {
  settings: BanSettings
  active_bans: BanEntry[]
  recent_failures: FailureEntry[]
  fail2ban: Fail2banStatus
}

const DEFAULT_SETTINGS: BanSettings = {
  enabled: true,
  max_retries: 5,
  find_time_seconds: 600,
  ban_duration_seconds: 1800,
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(secs: number): string {
  if (secs <= 0) return 'Permanent'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  return `${Math.round(secs / 3600)}h`
}

function fmtTime(s: string) {
  return new Date(s).toLocaleString()
}

function SourceTag({ source }: { source: string }) {
  const colors: Record<string, string> = {
    auto: '#F59E0B', manual: '#6366F1', fail2ban: '#EF4444',
  }
  return <Tag color={colors[source] ?? '#6B7280'}>{source}</Tag>
}

// ── Root component ────────────────────────────────────────────────────────────
export default function SecurityTab() {
  const [sub, setSub] = useState<SubTab>('autoban')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Sub-tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 24,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4, width: 'fit-content',
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: sub === t.id ? 'var(--accent)' : 'transparent',
              color: sub === t.id ? '#fff' : 'var(--text-muted)',
              fontSize: 13, fontWeight: sub === t.id ? 600 : 400,
              transition: 'all 0.12s',
            }}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {sub === 'autoban'  && <AutoBanPanel />}
      {sub === 'firewall' && <FirewallTab />}
      {sub === 'audit'    && <AuditLogTab />}
    </div>
  )
}

// ── Auto-Ban Panel ────────────────────────────────────────────────────────────
function AutoBanPanel() {
  const [status, setStatus]           = useState<SecurityStatus | null>(null)
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState('')
  const [saving, setSaving]           = useState(false)
  const [settings, setSettings]       = useState<BanSettings>(DEFAULT_SETTINGS)
  const [banIP, setBanIP]             = useState('')
  const [banReason, setBanReason]     = useState('')
  const [banning, setBanning]         = useState(false)
  const [unbanning, setUnbanning]     = useState<string | null>(null)
  const [successMsg, setSuccessMsg]   = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<SecurityStatus>('/api/admin/security/status')
      setStatus(data)
      setSettings(data.settings)
      setSettingsDirty(false)
    } catch (e: any) {
      setErr(e.message ?? 'Failed to load security status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await api.put('/api/admin/security/settings', settings)
      flash('Settings saved')
      setSettingsDirty(false)
    } catch (e: any) {
      setErr(e.message ?? 'Failed to save settings')
    } finally { setSaving(false) }
  }

  const handleBanIP = async (ip: string, reason?: string) => {
    setBanning(true)
    try {
      await api.post('/api/admin/security/bans', { ip, reason: reason ?? '' })
      flash(`${ip} banned`)
      setBanIP(''); setBanReason('')
      load()
    } catch (e: any) {
      setErr(e.message ?? 'Failed to ban IP')
    } finally { setBanning(false) }
  }

  const handleUnban = async (id: string) => {
    setUnbanning(id)
    try {
      await api.del(`/api/admin/security/bans/${id}`)
      flash('Ban removed')
      load()
    } catch (e: any) {
      setErr(e.message ?? 'Failed to remove ban')
    } finally { setUnbanning(null) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: 32 }}>
      <Spinner /> Loading...
    </div>
  )

  const f2b = status?.fail2ban

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* Alerts */}
      {err && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', color: '#EF4444', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          {err}
          <button onClick={() => setErr('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '10px 14px', color: 'var(--green)', fontSize: 13 }}>
          ✓ {successMsg}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label="Active Bans"       value={status?.active_bans?.length ?? 0}    color="#EF4444" icon="ban"      />
        <StatCard label="Failed Logins (1h)" value={status?.recent_failures?.reduce((a, f) => a + f.count, 0) ?? 0} color="#F59E0B" icon="alert"    />
        <StatCard label="Suspicious IPs"    value={status?.recent_failures?.length ?? 0} color="#6366F1" icon="shield"   />
        <StatCard
          label="fail2ban"
          value={f2b?.available ? (f2b.running ? 'Active' : 'Stopped') : 'Not installed'}
          color={f2b?.running ? 'var(--green)' : '#6B7280'}
          icon="activity"
        />
      </div>

      {/* Auto-Ban settings */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <SectionHeader>Auto-Ban Engine</SectionHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Automatic IP banning</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Block IPs that exceed the failed-login threshold</div>
            </div>
            <Toggle
              checked={settings.enabled}
              onChange={v => { setSettings(s => ({ ...s, enabled: v })); setSettingsDirty(true) }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
            <SettingField
              label="Max failed attempts"
              hint="Before ban triggers"
              value={settings.max_retries}
              min={1} max={100}
              onChange={v => { setSettings(s => ({ ...s, max_retries: v })); setSettingsDirty(true) }}
            />
            <SettingField
              label="Detection window"
              hint={fmtDuration(settings.find_time_seconds)}
              value={settings.find_time_seconds}
              min={30} max={86400}
              unit="seconds"
              onChange={v => { setSettings(s => ({ ...s, find_time_seconds: v })); setSettingsDirty(true) }}
            />
            <SettingField
              label="Ban duration"
              hint={settings.ban_duration_seconds <= 0 ? 'Permanent' : fmtDuration(settings.ban_duration_seconds)}
              value={settings.ban_duration_seconds}
              min={0} max={2592000}
              unit="seconds (0 = permanent)"
              onChange={v => { setSettings(s => ({ ...s, ban_duration_seconds: v })); setSettingsDirty(true) }}
            />
          </div>

          {settingsDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" loading={saving} onClick={saveSettings}>Save Settings</Button>
            </div>
          )}
        </div>
      </div>

      {/* fail2ban system status */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <SectionHeader>System fail2ban</SectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <F2bField label="Installed"             value={f2b?.available   ? 'Yes'    : 'No'}      ok={!!f2b?.available}   />
          <F2bField label="Daemon running"         value={f2b?.running     ? 'Yes'    : 'No'}      ok={!!f2b?.running}     />
          <F2bField label="openportal-auth jail"    value={f2b?.jail_active ? 'Active' : 'Inactive'} ok={!!f2b?.jail_active} />
          <F2bField label="OS-level bans"          value={String(f2b?.banned_count ?? 0)}           ok={true}               />
          {f2b?.version && <F2bField label="Version" value={f2b.version} ok={true} />}
        </div>
        {!f2b?.available && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            fail2ban is not installed. The auto-ban engine still blocks IPs at the application level.
            To add OS/iptables blocking, run the setup script and choose "Enable system hardening."
          </div>
        )}
      </div>

      {/* Threat intel */}
      {(status?.recent_failures?.length ?? 0) > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Threat Intelligence</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>IPs with failed login attempts in the last hour</div>
          </div>
          <Table headers={['IP Address', 'Failures', 'Last Seen', 'Status', '']}>
            {(status?.recent_failures ?? []).map(f => (
              <Tr key={f.ip}>
                <Td><code style={{ fontSize: 12, background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>{f.ip}</code></Td>
                <Td>
                  <span style={{ fontWeight: 600, color: f.count >= settings.max_retries ? '#EF4444' : f.count >= Math.floor(settings.max_retries / 2) ? '#F59E0B' : 'var(--text)' }}>
                    {f.count}
                  </span>
                </Td>
                <Td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtTime(f.last_seen)}</span></Td>
                <Td>
                  {f.is_banned
                    ? <Tag color="#EF4444">Banned</Tag>
                    : f.count >= settings.max_retries
                      ? <Tag color="#F59E0B">At threshold</Tag>
                      : <Tag color="var(--green)">Watching</Tag>}
                </Td>
                <Td>
                  {!f.is_banned && (
                    <Button variant="danger" onClick={() => handleBanIP(f.ip, 'banned from threat intel')}>Ban</Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}

      {/* Active bans */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Active Bans</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>Currently blocked IPs</div>
        </div>
        {(status?.active_bans?.length ?? 0) === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No active bans</div>
        ) : (
          <Table headers={['IP / CIDR', 'Reason', 'Source', 'Banned At', '']}>
            {(status?.active_bans ?? []).map(ban => (
              <Tr key={ban.id}>
                <Td><code style={{ fontSize: 12, background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>{ban.ip}</code></Td>
                <Td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ban.description}</span></Td>
                <Td><SourceTag source={ban.source} /></Td>
                <Td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtTime(ban.created_at)}</span></Td>
                <Td>
                  <Button
                    variant="ghost"
                    loading={unbanning === ban.id}
                    onClick={() => handleUnban(ban.id)}
                    style={{ color: 'var(--green)', borderColor: 'rgba(34,197,94,0.25)' }}
                  >
                    Unban
                  </Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </div>

      {/* Manual ban */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <SectionHeader>Manual Ban</SectionHeader>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', minWidth: 140 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>IP or CIDR</label>
            <input
              value={banIP}
              onChange={e => setBanIP(e.target.value)}
              placeholder="192.168.1.100 or 10.0.0.0/8"
              onKeyDown={e => e.key === 'Enter' && handleBanIP(banIP, banReason)}
              style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 220px', minWidth: 180 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason (optional)</label>
            <input
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              placeholder="e.g. Brute force attack"
              onKeyDown={e => e.key === 'Enter' && handleBanIP(banIP, banReason)}
              style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <Button
            variant="danger"
            loading={banning}
            onClick={() => handleBanIP(banIP, banReason)}
            style={{ height: 34, paddingTop: 0, paddingBottom: 0 }}
          >
            <Icon name="ban" size={13} /> Ban IP
          </Button>
          <Button variant="ghost" onClick={load} style={{ height: 34, paddingTop: 0, paddingBottom: 0 }}>
            <Icon name="activity" size={13} /> Refresh
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Small sub-components ──────────────────────────────────────────────────────
function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Icon name={icon} size={14} />
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function F2bField({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 13, color: ok ? 'var(--text)' : 'var(--text-dim)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function SettingField({ label, hint, value, min, max, unit, onChange }: {
  label: string; hint?: string; value: number; min?: number; max?: number; unit?: string
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      <input
        type="number" value={value} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{ height: 34, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{hint}{unit ? ` · ${unit}` : ''}</div>}
    </div>
  )
}
