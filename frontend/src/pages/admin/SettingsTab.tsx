import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { Button, Icon, Toggle, SectionHeader, Spinner, ConfirmDialog } from '../../components/ui'

export default function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [mfa, setMfa] = useState(true)
  const [sessionTTL, setSessionTTL] = useState('8')
  const [proxyMode, setProxyMode] = useState('reverse')
  const [keySource, setKeySource] = useState('env')
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    api.settings()
      .then(s => {
        setSettings(s)
        if (s.jwt_expiry_hours) setSessionTTL(String(s.jwt_expiry_hours))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    await api.updateSettings({ mfa_required: mfa, jwt_expiry_hours: parseInt(sessionTTL), proxy_mode: proxyMode })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>

  return (
    <div style={{ maxWidth: 560 }}>
      <Section title="Authentication">
        <SettingRow label="Enforce MFA" hint="Require all users to set up two-factor authentication before accessing tools.">
          <Toggle checked={mfa} onChange={setMfa} />
        </SettingRow>
        <SettingRow label="Session duration" hint="How long before users are asked to re-authenticate.">
          <select value={sessionTTL} onChange={e => setSessionTTL(e.target.value)} style={{ width: 150 }}>
            <option value="1">1 hour</option>
            <option value="4">4 hours</option>
            <option value="8">8 hours</option>
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
          </select>
        </SettingRow>
        <SettingRow label="Base domain" hint="The domain tools are served under via the reverse proxy.">
          <input
            defaultValue={String(settings.proxy_base_domain ?? '')}
            placeholder="proxy.yourcompany.com"
            style={{ maxWidth: 240 }}
          />
        </SettingRow>
      </Section>

      <Section title="Proxy">
        <SettingRow label="Proxy mode" hint="How the dashboard accesses tools on behalf of users.">
          <select value={proxyMode} onChange={e => setProxyMode(e.target.value)} style={{ width: 180 }}>
            <option value="reverse">Reverse proxy (recommended)</option>
            <option value="redirect">Redirect (no auth injection)</option>
            <option value="iframe">Embedded iframe</option>
          </select>
        </SettingRow>
      </Section>

      <Section title="WireGuard">
        <SettingRow label="Interface" hint="">
          <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {String(settings.wg_interface ?? 'wg0')}
          </span>
        </SettingRow>
        <SettingRow label="Server IP / subnet" hint="">
          <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {String(settings.wg_server_ip ?? '10.10.0.1')} / {String(settings.wg_subnet ?? '10.10.0.0/24')}
          </span>
        </SettingRow>
        <SettingRow label="Listen port" hint="">
          <span className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {String(settings.wg_listen_port ?? '51820')}
          </span>
        </SettingRow>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          WireGuard settings are configured via environment variables. Restart required to apply changes.
        </p>
      </Section>

      <Section title="Credential vault">
        <SettingRow label="Encryption key source" hint="Where the AES-256-GCM master key is loaded from.">
          <select value={keySource} onChange={e => setKeySource(e.target.value)} style={{ width: 200 }}>
            <option value="env">Environment variable (MASTER_KEY)</option>
            <option value="kms">AWS KMS</option>
            <option value="vault">HashiCorp Vault</option>
          </select>
        </SettingRow>
        <SettingRow label="Encryption algorithm" hint="">
          <span className="mono" style={{ fontSize: 12, color: 'var(--green)' }}>AES-256-GCM</span>
        </SettingRow>
      </Section>

      <Section title="Danger zone">
        <SettingRow label="Export configuration" hint="Download a full JSON export of all tools, roles, and settings (no credentials).">
          <Button variant="ghost" style={{ fontSize: 12 }}>
            <Icon name="download" size={13} /> Export
          </Button>
        </SettingRow>
        <SettingRow label="Reset instance" hint="Wipe all configuration. This cannot be undone.">
          <Button variant="danger" style={{ fontSize: 12 }} onClick={() => setConfirmReset(true)}>
            Reset everything
          </Button>
        </SettingRow>
      </Section>

      <Button variant="primary" onClick={save} style={{ minWidth: 130, justifyContent: 'center' }}>
        {saved ? <><Icon name="check" size={13} /> Saved</> : 'Save settings'}
      </Button>

      {confirmReset && (
        <ConfirmDialog
          variant="danger"
          title="Reset instance"
          message="This will permanently delete ALL tools, users, roles, and credentials. This action cannot be undone."
          confirmLabel="Reset everything"
          onConfirm={() => { setConfirmReset(false) }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <SectionHeader>{title}</SectionHeader>
      {children}
    </div>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ marginLeft: 24, flexShrink: 0 }}>{children}</div>
    </div>
  )
}
