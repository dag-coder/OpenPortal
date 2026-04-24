import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { type WGPeer } from '../../types'
import {
  Button, Icon, StatusDot, Modal, FormRow,
  Table, Tr, Td, EmptyState, Spinner, Card,
  ConfirmDialog,
} from '../../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServerInfo {
  server_public_key: string
  server_endpoint:   string
  listen_port:       number
  subnet:            string
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function WireGuardTab() {
  const [peers, setPeers]         = useState<WGPeer[]>([])
  const [loading, setLoading]     = useState(true)
  const [showAdd, setShowAdd]     = useState(false)
  const [viewPeer, setViewPeer]   = useState<WGPeer | null>(null)
  const [confirmDel, setConfirmDel] = useState<WGPeer | null>(null)

  const load = () => {
    api.wgPeers().then(d => setPeers(d ?? [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const connected = peers.filter(p => p.status === 'connected').length

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Server status"  value="Running"                          color="var(--green)" />
        <StatCard label="Interface"      value="wg0 · 10.10.0.1/24" color="var(--text)" mono />
        <StatCard label="Active peers"   value={`${connected} / ${peers.length}`} color="var(--accent)" />
      </div>

      {/* Private tools explainer */}
      <div style={{
        background: 'rgba(48,63,159,0.06)', border: '1px solid rgba(48,63,159,0.2)',
        borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2, display: 'flex' }}><Icon name="wifi" size={16} /></span>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          <strong>How private tools work:</strong> When you mark a tool as <em>Private</em> in the Tools tab,
          users can only reach it through the WireGuard VPN tunnel. Each server that hosts a private tool
          must be registered here as a host. Traffic flows:
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', marginLeft: 4 }}>
            Browser → OpenPortal → WireGuard tunnel → Private server
          </span>
        </div>
      </div>

      {/* Peer list header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Connected hosts</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
            Each host is a server that runs a private tool and connects back here over WireGuard.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={13} /> Add private host
        </Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      ) : (
        <Table headers={['Host name', 'Tunnel IP', 'Status', 'Last seen', '']}>
          {peers.length === 0 && (
            <tr><td colSpan={5}>
              <EmptyState message="No hosts yet. Click 'Add private host' to connect your first server." />
            </td></tr>
          )}
          {peers.map(peer => (
            <Tr key={peer.id}>
              <Td><span style={{ fontWeight: 500, fontSize: 13 }}>{peer.name}</span></Td>
              <Td><span className="mono" style={{ fontSize: 12, color: 'var(--teal)' }}>{peer.internal_ip}</span></Td>
              <Td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={peer.status} />
                  <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{peer.status}</span>
                </div>
              </Td>
              <Td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{peer.last_handshake ?? 'never'}</span></Td>
              <Td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    variant="ghost"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => setViewPeer(peer)}
                  >
                    <Icon name="settings" size={11} /> View config
                  </Button>
                  <Button variant="danger" style={{ padding: '4px 8px' }} onClick={() => setConfirmDel(peer)}>
                    <Icon name="trash" size={12} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {/* Modals */}
      {showAdd && (
        <AddHostWizard
          existingPeers={peers}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {viewPeer && (
        <ViewConfigModal peer={viewPeer} onClose={() => setViewPeer(null)} />
      )}

      {confirmDel && (
        <ConfirmDialog
          variant="danger"
          title="Remove host"
          message={`Remove "${confirmDel.name}" from the VPN? This host will immediately lose access to all private tools.`}
          confirmLabel="Remove host"
          onConfirm={async () => { await api.deletePeer(confirmDel.id); setConfirmDel(null); load() }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, mono }: {
  label: string; value: string; color: string; mono?: boolean
}) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 13, color, fontWeight: 500 }}>{value}</div>
    </Card>
  )
}

function nextSuggestedIP(peers: WGPeer[]): string {
  const taken = new Set(peers.map(p => p.internal_ip.replace('/32', '')))
  for (let i = 2; i <= 254; i++) {
    const candidate = `10.10.0.${i}`
    if (!taken.has(candidate)) return candidate
  }
  return '10.10.0.2'
}

function buildConfig(peer: WGPeer, info: ServerInfo): string {
  const endpointStr = info.server_endpoint
    ? `${info.server_endpoint}:${info.listen_port}`
    : `<SERVER_PUBLIC_IP>:${info.listen_port}`
  return [
    '[Interface]',
    'PrivateKey = <PASTE_OUTPUT_OF: cat /etc/wireguard/priv.key>',
    `Address = ${peer.internal_ip.includes('/') ? peer.internal_ip : peer.internal_ip + '/32'}`,
    'DNS = 1.1.1.1',
    '',
    '[Peer]',
    `PublicKey = ${info.server_public_key || '<SERVER_PUBLIC_KEY_MISSING>'}`,
    `Endpoint = ${endpointStr}`,
    `AllowedIPs = ${info.subnet}`,
    'PersistentKeepalive = 25',
  ].join('\n')
}

// ── Code block ────────────────────────────────────────────────────────────────

function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div style={{ marginTop: 12 }}>
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>}
      <div style={{ position: 'relative' }}>
        <pre style={{
          background: '#0f1117', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 10, padding: '16px 20px', margin: 0,
          fontFamily: 'var(--font-mono)', fontSize: 13, color: '#7dd3fc',
          lineHeight: 1.9, overflowX: 'auto', whiteSpace: 'pre-wrap',
        }}>
          {children}
        </pre>
        <button onClick={copy} style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          fontSize: 11, color: copied ? '#4ade80' : 'rgba(255,255,255,0.6)',
          fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Icon name="copy" size={11} /> {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function Callout({ color = 'blue', children }: { color?: 'amber' | 'blue' | 'green' | 'red'; children: React.ReactNode }) {
  const themes = {
    amber: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',  icon: '⚠' },
    blue:  { bg: 'rgba(48,63,159,0.08)',   border: 'rgba(48,63,159,0.25)', icon: 'ℹ' },
    green: { bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.25)', icon: '✓' },
    red:   { bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.25)', icon: '✗' },
  }
  const t = themes[color]
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: '13px 16px', fontSize: 13.5, lineHeight: 1.75,
      color: 'var(--text)', marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ flexShrink: 0, marginTop: 1, opacity: 0.7 }}>{t.icon}</span>
      <div>{children}</div>
    </div>
  )
}

// ── Wizard shell ──────────────────────────────────────────────────────────────

interface WizardStep { title: string; subtitle: string }

function WizardShell({
  title, steps, current, children, onClose, onNext, onBack, nextLabel, nextDisabled, nextLoading,
}: {
  title: string; steps: WizardStep[]; current: number; children: React.ReactNode
  onClose: () => void; onNext?: () => void; onBack?: () => void
  nextLabel?: string; nextDisabled?: boolean; nextLoading?: boolean
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 16, width: '100%', maxWidth: 700,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '22px 28px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 4 }}>
                {title}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                {steps[current].title}
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {steps[current].subtitle}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, marginLeft: 16, flexShrink: 0,
            }}>
              <Icon name="close" size={18} />
            </button>
          </div>

          {/* Step pills */}
          <div style={{ display: 'flex', gap: 4, paddingBottom: 18, flexWrap: 'wrap' }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px 4px 6px', borderRadius: 20,
                  background: i === current ? 'var(--accent)' : i < current ? 'rgba(48,63,159,0.12)' : 'var(--surface)',
                  border: `1px solid ${i === current ? 'var(--accent)' : i < current ? 'rgba(48,63,159,0.2)' : 'var(--border)'}`,
                  transition: 'all 0.2s',
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    background: i === current ? 'rgba(255,255,255,0.25)' : i < current ? 'var(--accent)' : 'var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800,
                    color: i < current ? '#fff' : i === current ? '#fff' : 'var(--text-muted)',
                  }}>
                    {i < current ? '✓' : i + 1}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: i === current ? '#fff' : i < current ? 'var(--accent)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {s.title}
                  </span>
                </div>
                {i < steps.length - 1 && <div style={{ width: 12, height: 1, background: 'var(--border)' }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 0' }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{
          padding: '18px 28px',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--surface)',
        }}>
          <div>
            {onBack
              ? <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}>← Back</button>
              : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Step {current + 1} of {steps.length}</span>
            }
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!onNext && <Button variant="ghost" onClick={onClose}>Close</Button>}
            {onNext && (
              <Button
                variant="primary"
                onClick={onNext}
                disabled={nextDisabled}
                loading={nextLoading}
                style={{ minWidth: 130, justifyContent: 'center', fontSize: 14, padding: '10px 20px' }}
              >
                {nextLabel ?? 'Next →'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add host wizard (unified 5-step) ──────────────────────────────────────────

const ADD_STEPS: WizardStep[] = [
  { title: 'Server preflight',    subtitle: 'Make sure the OpenPortal server is reachable from the host.' },
  { title: 'Install WireGuard',   subtitle: 'Install the WireGuard package on the machine you want to connect.' },
  { title: 'Generate host keys',  subtitle: 'Create a key pair on the host — only the public key leaves the machine.' },
  { title: 'Register this host',  subtitle: 'Enter a name, pick a tunnel IP, and paste the public key.' },
  { title: 'Configure & connect', subtitle: 'Put the config file on the host and bring the tunnel up.' },
]

function AddHostWizard({
  existingPeers, onClose, onSaved,
}: {
  existingPeers: WGPeer[]
  onClose: () => void
  onSaved: () => void
}) {
  const [step, setStep]         = useState(0)
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [loadingSI, setLoadingSI]   = useState(true)

  const [pubkey,  setPubkey]  = useState('')
  const [name,    setName]    = useState('')
  const [ip,      setIp]      = useState(nextSuggestedIP(existingPeers))
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [savedPeer, setSavedPeer] = useState<WGPeer | null>(null)

  useEffect(() => {
    api.wgServerInfo()
      .then(info => { setServerInfo(info); setLoadingSI(false) })
      .catch(() => setLoadingSI(false))
  }, [])

  const endpointOk = !!(
    serverInfo?.server_endpoint &&
    serverInfo.server_endpoint !== 'localhost' &&
    serverInfo.server_endpoint !== '127.0.0.1'
  )
  const pubkeyValid = pubkey.trim().length === 44
  const canRegister = name.trim() !== '' && ip.trim() !== '' && pubkeyValid

  const register = async () => {
    setSaving(true); setSaveErr(null)
    try {
      await api.addPeer({ name: name.trim(), ip: ip.trim(), public_key: pubkey.trim() })
      const updated = await api.wgPeers()
      const created = (updated ?? []).find(p => p.name === name.trim()) ?? null
      setSavedPeer(created)
      setStep(4)
    } catch (e: any) {
      setSaveErr(e.message ?? 'Failed to register host')
    } finally {
      setSaving(false) }
  }

  const info = serverInfo
  const wgPort = info?.listen_port ?? 51820
  const configText = savedPeer && info ? buildConfig(savedPeer, info) : ''

  const download = () => {
    if (!savedPeer) return
    const blob = new Blob([configText], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${savedPeer.name}.conf`
    a.click()
  }

  if (loadingSI) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 48 }}><Spinner /></div>
      </div>
    )
  }

  return (
    <WizardShell
      title="Add a private host"
      steps={ADD_STEPS}
      current={step}
      onClose={() => { if (savedPeer) onSaved(); else onClose() }}
      onBack={step > 0 && step < 4 ? () => setStep(s => s - 1) : undefined}
      onNext={
        step === 0 ? () => setStep(1)
        : step === 1 ? () => setStep(2)
        : step === 2 ? () => setStep(3)
        : step === 3 ? register
        : undefined
      }
      nextLabel={
        step === 0 ? 'My firewall is ready →'
        : step === 1 ? 'WireGuard installed →'
        : step === 2 ? 'I have my public key →'
        : step === 3 ? 'Register this host'
        : undefined
      }
      nextDisabled={
        (step === 2 && !pubkeyValid) ||
        (step === 3 && !canRegister)
      }
      nextLoading={step === 3 && saving}
    >

      {/* ── Step 0 — Server preflight ── */}
      {step === 0 && (
        <div style={{ paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: 4 }}>
            Before connecting a host, confirm the OpenPortal server is accessible on the WireGuard UDP port.
          </p>

          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 16, marginTop: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              Server info
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>Public endpoint</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: endpointOk ? 'var(--text)' : '#f59e0b', fontWeight: 500 }}>
                  {info?.server_endpoint || <em style={{ color: '#f59e0b' }}>not set</em>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>WireGuard UDP port</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{wgPort}</div>
              </div>
            </div>
          </div>

          {!endpointOk && (
            <Callout color="amber">
              <strong>WG_PUBLIC_ENDPOINT is not set.</strong> The config file generated later will contain a placeholder.
              Set it in your <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>.env</code> file:{' '}
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>WG_PUBLIC_ENDPOINT=your.server.ip</code>, then restart the service.
            </Callout>
          )}

          <Callout color="blue">
            <strong>Open the WireGuard port on the OpenPortal server</strong> so hosts can reach it.
            Run this <em>on the OpenPortal server</em>:
            <CodeBlock>{`sudo ufw allow ${wgPort}/udp
sudo ufw reload
sudo ufw status`}</CodeBlock>
            If you're not using UFW, open UDP port <strong>{wgPort}</strong> in your cloud security group or iptables rules.
          </Callout>

          <Callout color="green">
            <strong>Hardening tip:</strong> The setup script (setup.sh --bare-metal) can configure UFW, kernel network hardening,
            automatic security updates, and fail2ban brute-force protection automatically.
            Run it on the OpenPortal server if you haven't already.
          </Callout>
        </div>
      )}

      {/* ── Step 1 — Install WireGuard ── */}
      {step === 1 && (
        <div style={{ paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: 4 }}>
            Run the command for the OS on <strong>the host server you are connecting</strong>
            — not the OpenPortal server.
          </p>

          <CodeBlock label="Ubuntu / Debian">{
`sudo apt update && sudo apt install -y wireguard wireguard-tools`
          }</CodeBlock>

          <CodeBlock label="Fedora / RHEL / Rocky">{
`sudo dnf install -y wireguard-tools`
          }</CodeBlock>

          <CodeBlock label="Arch / Manjaro">{
`sudo pacman -S --noconfirm wireguard-tools`
          }</CodeBlock>

          <Callout color="blue">
            WireGuard is built into the Linux kernel since version 5.6. If your kernel is older,
            install the <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>linux-headers</code> package for your distro first.
          </Callout>
        </div>
      )}

      {/* ── Step 2 — Generate keys ── */}
      {step === 2 && (
        <div style={{ paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: 4 }}>
            Run these two commands <strong>on the host</strong> to generate a key pair.
            The private key <em>never leaves the host</em> — you'll only paste the public key here.
          </p>

          <CodeBlock label="1 — Generate key pair">{
`wg genkey | sudo tee /etc/wireguard/priv.key | wg pubkey | sudo tee /etc/wireguard/pub.key
sudo chmod 600 /etc/wireguard/priv.key`
          }</CodeBlock>

          <CodeBlock label="2 — Print the public key">{
`sudo cat /etc/wireguard/pub.key`
          }</CodeBlock>

          <div style={{ marginTop: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Paste the public key output here
            </label>
            <input
              value={pubkey}
              onChange={e => setPubkey(e.target.value.trim())}
              placeholder="44-character base64 public key…"
              style={{
                marginTop: 8, width: '100%', padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${pubkey && !pubkeyValid ? '#ef4444' : 'var(--border)'}`,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'var(--font-mono)', fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            {pubkey && !pubkeyValid && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                WireGuard public keys are exactly 44 characters (base64). Got {pubkey.length}.
              </div>
            )}
            {pubkeyValid && (
              <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>✓ Valid public key</div>
            )}
          </div>

          <Callout color="amber">
            <strong>Never paste your private key here.</strong> The private key stays in{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>/etc/wireguard/priv.key</code> on the host.
          </Callout>
        </div>
      )}

      {/* ── Step 3 — Register ── */}
      {step === 3 && (
        <div style={{ paddingBottom: 8 }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, marginBottom: 16 }}>
            Give this host a name and a tunnel IP. After saving, you'll get a pre-filled config file to drop on the host.
          </p>

          <FormRow label="Host name" hint="A friendly label — e.g. grafana-server, prometheus-01">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. grafana-server" autoFocus />
          </FormRow>

          <FormRow label="Tunnel IP" hint={
            <>
              Must be unused in <code className="mono" style={{ fontSize: 12 }}>10.10.0.0/24</code>.
              The server is 10.10.0.1. We suggest the next free address.
            </>
          }>
            <input className="mono" value={ip} onChange={e => setIp(e.target.value)} placeholder="10.10.0.2" />
          </FormRow>

          <FormRow label="Public key" hint="Carried over from the previous step — verify it matches.">
            <input
              className="mono"
              value={pubkey}
              onChange={e => setPubkey(e.target.value.trim())}
              style={{ fontSize: 13 }}
              placeholder="44-character base64 key"
            />
          </FormRow>

          {saveErr && (
            <div style={{ marginTop: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13 }}>
              {saveErr}
            </div>
          )}
        </div>
      )}

      {/* ── Step 4 — Configure & connect ── */}
      {step === 4 && savedPeer && (
        <div style={{ paddingBottom: 8 }}>
          <Callout color="green">
            <strong>Host "{savedPeer.name}" registered.</strong> Now put this config on the host and bring the tunnel up.
          </Callout>

          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75, marginTop: 16, marginBottom: 8 }}>
            Save this file as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>/etc/wireguard/wg0.conf</code> on <strong>{savedPeer.name}</strong>.
            Then replace the placeholder with the actual private key.
          </p>

          {/* Config display with yellow placeholder */}
          <div style={{
            background: '#0f1117', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 10, padding: '16px 20px', marginTop: 8,
            fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 2,
          }}>
            {configText.split('\n').map((line, i) => (
              <div key={i} style={{
                color: line.includes('<PASTE_') ? '#fbbf24' : '#7dd3fc',
              }}>
                {line || '\u00A0'}
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 10, padding: '10px 14px',
            background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 8, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8,
          }}>
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>Yellow line: </span>
            Replace <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{'<PASTE_OUTPUT_OF: cat /etc/wireguard/priv.key>'}</code> with the output of:
            <br />
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>sudo cat /etc/wireguard/priv.key</code>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Button variant="primary" onClick={download} style={{ fontSize: 13, padding: '10px 20px' }}>
              <Icon name="download" size={14} /> Download {savedPeer.name}.conf
            </Button>
            <Button variant="ghost" onClick={() => {
              navigator.clipboard.writeText(configText)
            }} style={{ fontSize: 13 }}>
              <Icon name="copy" size={13} /> Copy to clipboard
            </Button>
          </div>

          <CodeBlock label="Start the tunnel on the host (run these on the host)">{
`# Save the config first, then:
sudo systemctl enable --now wg-quick@wg0

# Verify the tunnel is up
sudo wg show`
          }</CodeBlock>

          <Callout color="blue">
            Once connected, you'll see a <strong>latest handshake</strong> timestamp in <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>wg show</code>.
            The host status on this page will update to <strong>Connected</strong> within a minute.
          </Callout>

          <Callout color="amber">
            <strong>If the tunnel doesn't connect:</strong> check that UDP port <strong>{wgPort}</strong> is open on the
            OpenPortal server (step 1). Then run <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>sudo wg show</code> on
            the host to see if a handshake attempt is visible. If the server's WireGuard interface wasn't updated automatically, run
            this <em>on the OpenPortal server</em>:
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#0f1117', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#7dd3fc' }}>
              sudo wg syncconf wg0 {'<'}(wg-quick strip /etc/wireguard/wg0.conf)
            </div>
          </Callout>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingBottom: 8 }}>
            <Button variant="primary" onClick={onSaved} style={{ fontSize: 14, padding: '10px 28px' }}>
              Done
            </Button>
          </div>
        </div>
      )}
    </WizardShell>
  )
}

// ── View config modal (for existing peers) ────────────────────────────────────

function ViewConfigModal({ peer, onClose }: { peer: WGPeer; onClose: () => void }) {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    api.wgServerInfo().then(i => { setServerInfo(i); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const configText = serverInfo ? buildConfig(peer, serverInfo) : ''

  const download = () => {
    const blob = new Blob([configText], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${peer.name}.conf`; a.click()
  }

  return (
    <Modal title={`Config — ${peer.name}`} onClose={onClose} width={600}>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
            Save this as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>/etc/wireguard/wg0.conf</code> on <strong>{peer.name}</strong>.
            Fill in the private key and start the tunnel with{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>sudo systemctl enable --now wg-quick@wg0</code>.
          </p>

          {/* Config with yellow placeholder */}
          <div style={{
            background: '#0f1117', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 10, padding: '16px 20px',
            fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 2,
          }}>
            {configText.split('\n').map((line, i) => (
              <div key={i} style={{ color: line.includes('<PASTE_') ? '#fbbf24' : '#7dd3fc' }}>
                {line || '\u00A0'}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(configText)}>
              <Icon name="copy" size={13} /> Copy
            </Button>
            <Button variant="primary" onClick={download}>
              <Icon name="download" size={13} /> Download .conf
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
