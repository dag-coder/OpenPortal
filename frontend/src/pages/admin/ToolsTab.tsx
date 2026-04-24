import React, { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { type Tool, type WGPeer } from '../../types'
import {
  Button, Icon, StatusDot, Tag, Modal, FormRow,
  Table, Tr, Td, EmptyState, Spinner, ConfirmDialog, AlertDialog,
} from '../../components/ui'

const AUTH_LABELS: Record<string, { label: string; hint: string; color: string }> = {
  none:  { label: 'No login needed',     hint: 'Anyone with access can open it',    color: 'var(--text-dim)' },
  basic: { label: 'Username & password', hint: 'Standard login credentials',         color: 'var(--accent)'  },
  token: { label: 'API key / token',     hint: 'A secret key provided by the tool', color: 'var(--amber)'   },
  oauth: { label: 'Single sign-on',      hint: 'Google, Okta, Azure AD, etc.',      color: 'var(--green)'   },
  saml:  { label: 'SAML SSO',            hint: 'Enterprise identity provider',       color: 'var(--green)'   },
}

const CRED_FIELDS: Record<string, { key: string; label: string; placeholder?: string; secret?: boolean }[]> = {
  basic: [
    { key: 'username', label: 'Username', placeholder: 'admin' },
    { key: 'password', label: 'Password', secret: true },
  ],
  token: [{ key: 'token', label: 'API key or token', placeholder: 'sk-…', secret: true }],
  oauth: [],
  saml:  [],
  none:  [],
}

// ── Tools tab ─────────────────────────────────────────────────────────────────

export default function ToolsTab() {
  const [tools,    setTools]    = useState<Tool[]>([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [showAdd,    setShowAdd]    = useState(false)
  const [editTool,   setEditTool]   = useState<Tool | null>(null)
  const [confirmDel, setConfirmDel] = useState<Tool | null>(null)

  const load = () => {
    api.adminTools().then(setTools).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const deleteTool = async (tool: Tool) => setConfirmDel(tool)

  const filtered = tools.filter(t =>
    (t.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input
          placeholder="Search tools..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={13} /> Add tool
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      ) : (
        <Table headers={['Tool', 'Address', 'Login type', 'Access', 'Status', '']}>
          {filtered.length === 0 && (
            <tr><td colSpan={6}><EmptyState message="No tools yet. Click 'Add tool' to get started." /></td></tr>
          )}
          {filtered.map(tool => {
            const auth = AUTH_LABELS[tool.auth_type] ?? AUTH_LABELS.none
            return (
              <Tr key={tool.id}>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ToolIcon tool={tool} size={34} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{tool.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tool.category}</div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {tool.url.replace(/https?:\/\//, '').split('/')[0]}
                  </span>
                </Td>
                <Td><Tag color={auth.color}>{auth.label}</Tag></Td>
                <Td>
                  {tool.is_private
                    ? <Tag color="var(--accent)"><Icon name="lock" size={10} /> Private</Tag>
                    : <Tag color="var(--slate)"><Icon name="globe" size={10} /> Public</Tag>
                  }
                </Td>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={tool.status} />
                    <span style={{
                      fontSize: 12, textTransform: 'capitalize',
                      color: tool.status === 'online' ? 'var(--green)'
                           : tool.status === 'degraded' ? 'var(--amber)' : 'var(--red)',
                    }}>
                      {tool.status}
                    </span>
                  </div>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button variant="ghost" style={{ padding: '4px 8px' }} onClick={() => setEditTool(tool)}>
                      <Icon name="edit" size={12} />
                    </Button>
                    <Button variant="danger" style={{ padding: '4px 8px' }} onClick={() => deleteTool(tool)}>
                      <Icon name="trash" size={12} />
                    </Button>
                  </div>
                </Td>
              </Tr>
            )
          })}
        </Table>
      )}

      {showAdd && (
        <AddToolWizard
          categories={[...new Set(tools.map(t => t.category).filter(Boolean))]}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {editTool && (
        <EditToolModal
          tool={editTool}
          onClose={() => setEditTool(null)}
          onSaved={() => { setEditTool(null); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          variant="danger"
          title="Remove tool"
          message={`Remove "${confirmDel.name}" from the dashboard? This cannot be undone.`}
          confirmLabel="Remove"
          onConfirm={async () => { await api.deleteTool(confirmDel.id); setConfirmDel(null); load() }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ── Tool icon ─────────────────────────────────────────────────────────────────

function ToolIcon({ tool, size = 34 }: { tool: Tool; size?: number }) {
  const [imgOk, setImgOk] = useState(true)
  if (tool.custom_icon && imgOk) {
    return (
      <img
        src={tool.custom_icon}
        alt={tool.name}
        onError={() => setImgOk(false)}
        style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: 'var(--accent-dim)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
    }}>
      {tool.name[0]?.toUpperCase()}
    </div>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 7, height: 7, borderRadius: 4,
          background: i <= current ? 'var(--accent)' : 'var(--border)',
          transition: 'all 0.2s',
        }} />
      ))}
    </div>
  )
}

// ── Add tool wizard ───────────────────────────────────────────────────────────

type AddStep = 'type' | 'wg-setup' | 'details'

function AddToolWizard({ categories, onClose, onSaved }: {
  categories: string[]; onClose: () => void; onSaved: () => void
}) {
  const [step, setStep] = useState<AddStep>('type')
  const [isPrivate, setIsPrivate] = useState(false)
  const [selectedPeer, setSelectedPeer] = useState<WGPeer | null>(null)
  const [showFinishWG, setShowFinishWG] = useState(false)

  const totalSteps = isPrivate ? 3 : 2
  const currentStep = step === 'type' ? 0 : step === 'wg-setup' ? 1 : isPrivate ? 2 : 1

  const choosePublic = () => { setIsPrivate(false); setStep('details') }
  const choosePrivate = () => { setIsPrivate(true); setStep('wg-setup') }

  // After tool is saved, offer to finish WireGuard setup if peer isn't connected yet
  const handleToolCreated = () => {
    if (isPrivate && selectedPeer?.status !== 'connected') {
      setShowFinishWG(true)
    } else {
      onSaved()
    }
  }

  if (showFinishWG) {
    return <FinishWireGuardModal peer={selectedPeer} onDone={onSaved} />
  }

  if (step === 'type') {
    return (
      <Modal title="Add a tool" onClose={onClose} width={520}>
        <StepDots total={2} current={0} />
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
          Where is this tool hosted?
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 8 }}>
          <TypeCard
            emoji="🌐"
            title="Public tool"
            description="Accessible over the internet. No VPN needed."
            accent="var(--accent)"
            onClick={choosePublic}
          />
          <TypeCard
            emoji="🔒"
            title="Private tool"
            description="On an internal network. Routed securely through WireGuard."
            accent="var(--slate)"
            onClick={choosePrivate}
          />
        </div>
      </Modal>
    )
  }

  if (step === 'wg-setup') {
    return (
      <Modal title="Set up private access" onClose={onClose} width={600}>
        <StepDots total={totalSteps} current={currentStep} />
        <WireGuardSetupStep
          onBack={() => setStep('type')}
          onContinue={(peer) => { setSelectedPeer(peer ?? null); setStep('details') }}
        />
      </Modal>
    )
  }

  const defaultUrl = selectedPeer ? `http://${selectedPeer.internal_ip}` : ''

  return (
    <Modal title={isPrivate ? 'Private tool details' : 'Tool details'} onClose={onClose} width={520}>
      <StepDots total={totalSteps} current={currentStep} />
      <ToolDetailsForm
        isPrivate={isPrivate}
        categories={categories}
        defaultUrl={defaultUrl}
        onBack={() => setStep(isPrivate ? 'wg-setup' : 'type')}
        onClose={onClose}
        onSaved={handleToolCreated}
      />
    </Modal>
  )
}

// ── Type choice card ──────────────────────────────────────────────────────────

function TypeCard({ emoji, title, description, accent, onClick }: {
  emoji: string; title: string; description: string; accent: string; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '28px 20px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
        border: `2px solid ${hovered ? accent : 'var(--border)'}`,
        background: hovered ? `${accent}0d` : 'var(--surface)',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{description}</div>
      <div style={{
        marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, fontWeight: 600, color: accent,
      }}>
        Select <Icon name="chevron" size={12} />
      </div>
    </div>
  )
}

// ── WireGuard setup step ──────────────────────────────────────────────────────

function WireGuardSetupStep({ onBack, onContinue }: {
  onBack: () => void
  onContinue: (peer?: WGPeer) => void
}) {
  const [peers, setPeers]         = useState<WGPeer[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<WGPeer | null>(null)
  const [showForm, setShowForm]   = useState(false)

  const loadPeers = () => {
    api.wgPeers()
      .then(data => { setPeers(data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(loadPeers, [])

  const handlePeerAdded = () => {
    api.wgPeers().then(data => {
      const list = data ?? []
      setPeers(list)
      if (list.length > 0) setSelected(list[list.length - 1])
      setShowForm(false)
    }).catch(() => setShowForm(false))
  }

  return (
    <div>
      {/* Info banner */}
      <div style={{
        background: 'var(--accent-dim)', border: '1px solid rgba(37,99,235,0.15)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 18 }}>🔒</span>
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
          Private tools are accessed through an encrypted WireGuard tunnel.
          Select an existing peer or add a new one, then continue to fill in the tool details.
        </div>
      </div>

      {/* Existing peers */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
      ) : (
        <>
          {peers.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Existing peers — select one
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {peers.map(peer => {
                  const isSel = selected?.id === peer.id
                  return (
                    <div
                      key={peer.id}
                      onClick={() => setSelected(isSel ? null : peer)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                        border: `1.5px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSel ? 'var(--accent-dim)' : 'var(--surface)',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: peer.status === 'connected' ? 'var(--green)'
                          : peer.status === 'idle' ? 'var(--amber)' : 'var(--border)',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{peer.name}</div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{peer.internal_ip}</div>
                      </div>
                      {isSel && (
                        <Icon name="check" size={14} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Add new peer inline */}
          {showForm ? (
            <AddPeerInline
              onCancel={() => setShowForm(false)}
              onSaved={handlePeerAdded}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1.5px dashed var(--border)', background: 'transparent',
                fontSize: 13, color: 'var(--accent)', fontWeight: 600,
              }}
            >
              <Icon name="plus" size={13} />
              {peers.length === 0 ? 'Add your first WireGuard peer' : 'Add another peer'}
            </button>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 20 }}>
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button variant="primary" onClick={() => onContinue(selected ?? undefined)}>
          {selected ? `Use ${selected.name} →` : 'Continue without peer →'}
        </Button>
      </div>
    </div>
  )
}

// ── Inline add-peer form — 2-step guided flow ────────────────────────────────

function AddPeerInline({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [step,   setStep]   = useState<1 | 2>(1)
  const [name,   setName]   = useState('')
  const [ip,     setIp]     = useState('10.10.0.')
  const [pubkey, setPubkey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const save = async () => {
    if (!name || !ip || !pubkey) { setError('All fields are required.'); return }
    setSaving(true)
    try {
      await api.addPeer({ name, ip, public_key: pubkey })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add peer')
    } finally { setSaving(false) }
  }

  const boxStyle: React.CSSProperties = {
    border: '1.5px solid var(--accent)', borderRadius: 10,
    padding: '14px 16px', marginBottom: 4, background: 'var(--accent-dim)',
  }

  const codeBlock: React.CSSProperties = {
    display: 'block', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '9px 12px', fontFamily: 'var(--font-mono)',
    fontSize: 11, color: 'var(--teal)', marginTop: 8, lineHeight: 1.8,
    whiteSpace: 'pre-wrap',
  }

  if (step === 1) {
    return (
      <div style={boxStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
          Step 1 of 2 — Set up WireGuard on the host
        </div>
        <p style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8, lineHeight: 1.6 }}>
          Open a terminal on the machine you want to connect and run these commands:
        </p>

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
          Install WireGuard
        </div>
        <code style={codeBlock}>{
`# Ubuntu / Debian
sudo apt update && sudo apt install wireguard

# Fedora / RHEL
sudo dnf install wireguard-tools

# Arch Linux
sudo pacman -S wireguard-tools`
        }</code>

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginTop: 12, marginBottom: 4 }}>
          Generate a key pair
        </div>
        <code style={codeBlock}>{
`wg genkey | tee /etc/wireguard/priv.key | wg pubkey > /etc/wireguard/pub.key
chmod 600 /etc/wireguard/priv.key`
        }</code>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
          This creates two files: <code className="mono" style={{ fontSize: 11 }}>priv.key</code> (private — stays on the host) and{' '}
          <code className="mono" style={{ fontSize: 11 }}>pub.key</code> (public — you'll paste it in the next step).
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <Button variant="ghost" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</Button>
          <Button variant="primary" onClick={() => setStep(2)} style={{ fontSize: 12 }}>
            I've generated the keys →
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div style={boxStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
        Step 2 of 2 — Register this host
      </div>

      <FormRow label="Host name" hint="A friendly name, e.g. grafana-server. Used to identify this machine.">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. grafana-server" autoFocus />
      </FormRow>

      <FormRow label="Tunnel IP" hint={
        <>Pick an unused address in the <code className="mono" style={{ fontSize: 11 }}>10.10.0.x</code> range,
        e.g. <code className="mono" style={{ fontSize: 11 }}>10.10.0.2</code>. Each host needs a unique IP.</>
      }>
        <input className="mono" value={ip} onChange={e => setIp(e.target.value)} placeholder="10.10.0.2" />
      </FormRow>

      <FormRow label="Host's public key" hint={
        <>Run <code className="mono" style={{ fontSize: 11 }}>cat /etc/wireguard/pub.key</code> on the host and paste the output here.
        This is the PUBLIC key — never share or paste the private key.</>
      }>
        <input className="mono" value={pubkey} onChange={e => setPubkey(e.target.value)} placeholder="base64-encoded public key" />
      </FormRow>

      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
        <Button variant="ghost" onClick={() => setStep(1)} style={{ fontSize: 12 }}>← Back</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} style={{ fontSize: 12 }}>
            <Icon name="plus" size={12} /> Add host
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Finish WireGuard setup modal ────────────────────────────────────────────

function FinishWireGuardModal({ peer, onDone }: { peer: WGPeer | null; onDone: () => void }) {
  const [serverInfo, setServerInfo] = useState<{
    server_public_key: string; server_endpoint: string; listen_port: number; subnet: string
  } | null>(null)
  const [loadingSI, setLoadingSI] = useState(true)
  const [copied, setCopied]       = useState(false)

  useEffect(() => {
    api.wgServerInfo()
      .then(info => { setServerInfo(info); setLoadingSI(false) })
      .catch(() => setLoadingSI(false))
  }, [])

  const pubKey      = serverInfo?.server_public_key || ''
  const port        = serverInfo?.listen_port ?? 51820
  const subnet      = serverInfo?.subnet || '10.10.0.0/24'
  const endpoint    = serverInfo?.server_endpoint || ''
  const endpointStr = endpoint ? `${endpoint}:${port}` : ''
  const peerIP      = peer?.internal_ip || '10.10.0.x'

  const missingKey      = !pubKey
  const missingEndpoint = !endpointStr

  const configLines = [
    { text: '[Interface]',                                      placeholder: false },
    { text: 'PrivateKey = <PASTE_YOUR_PRIVATE_KEY_HERE>',       placeholder: true  },
    { text: `Address = ${peerIP}/32`,                           placeholder: false },
    { text: 'DNS = 1.1.1.1',                                    placeholder: false },
    { text: '',                                                  placeholder: false },
    { text: '[Peer]',                                           placeholder: false },
    { text: `PublicKey = ${pubKey || '<SET WG_PRIVATE_KEY ON SERVER>'}`, placeholder: missingKey },
    { text: `Endpoint = ${endpointStr || '<SET WG_PUBLIC_ENDPOINT ON SERVER>'}`, placeholder: missingEndpoint },
    { text: `AllowedIPs = ${subnet}`,                           placeholder: false },
    { text: 'PersistentKeepalive = 25',                         placeholder: false },
  ]

  const rawConfig = configLines.map(l => l.text).join('\n')

  const download = () => {
    const blob = new Blob([rawConfig], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${peer?.name ?? 'peer'}.conf`
    a.click()
  }

  const copy = () => {
    navigator.clipboard.writeText(rawConfig).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const codeBlock: React.CSSProperties = {
    display: 'block', background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '9px 12px', fontFamily: 'var(--font-mono)',
    fontSize: 11, color: 'var(--teal)', marginTop: 6, lineHeight: 1.8, whiteSpace: 'pre-wrap',
  }

  const numBadge: React.CSSProperties = {
    width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2,
  }

  return (
    <Modal title='Finish WireGuard setup' width={620} onClose={onDone}>

      {/* Success banner */}
      <div style={{
        background: 'var(--green-dim)', border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 20 }}>✅</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>Tool added!</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Now connect <strong>{peer?.name ?? 'the host'}</strong> to the VPN so it can reach private tools.
            Follow the steps below on that machine.
          </div>
        </div>
      </div>

      {/* Server env-var warnings */}
      {(missingKey || missingEndpoint) && (
        <div style={{
          background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--amber)',
        }}>
          <strong>Action needed on the OpenPortal server before continuing:</strong>
          <ul style={{ margin: '6px 0 0 0', paddingLeft: 18, lineHeight: 2 }}>
            {missingKey && <li>Set <code className="mono" style={{ fontSize: 11 }}>WG_PRIVATE_KEY</code> — the server's WireGuard private key (so its public key can be filled in automatically).</li>}
            {missingEndpoint && <li>Set <code className="mono" style={{ fontSize: 11 }}>WG_PUBLIC_ENDPOINT</code> — the server's public IP or hostname (e.g. <code className="mono" style={{ fontSize: 11 }}>203.0.113.1</code>).</li>}
          </ul>
        </div>
      )}

      <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
        {loadingSI ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

            {/* Step 1 — Config file */}
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={numBadge}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Download this config file and save it on {peer?.name ?? 'the host'}
                </div>

                {/* Colour-coded config */}
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 2,
                }}>
                  {configLines.map((line, i) => (
                    <div key={i} style={{ color: line.placeholder ? 'var(--amber)' : 'var(--teal)' }}>
                      {line.text || '\u00A0'}
                    </div>
                  ))}
                </div>

                {/* Amber legend */}
                <div style={{
                  background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                  borderRadius: 6, padding: '9px 12px', marginTop: 8, fontSize: 12,
                }}>
                  <strong style={{ color: 'var(--amber)' }}>Lines in orange need your input:</strong>
                  <ul style={{ margin: '5px 0 0 0', paddingLeft: 18, lineHeight: 2, color: 'var(--text-muted)' }}>
                    <li>
                      <code className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>PrivateKey</code>
                      {' — '}replace with the output of{' '}
                      <code className="mono" style={{ fontSize: 11 }}>cat /etc/wireguard/priv.key</code>
                      {' '}on {peer?.name ?? 'the host'}.
                    </li>
                    {missingEndpoint && (
                      <li>
                        <code className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>Endpoint</code>
                        {' — '}set <code className="mono" style={{ fontSize: 11 }}>WG_PUBLIC_ENDPOINT</code> on the OpenPortal server, then re-open this guide.
                      </li>
                    )}
                    {missingKey && (
                      <li>
                        <code className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>PublicKey</code>
                        {' — '}set <code className="mono" style={{ fontSize: 11 }}>WG_PRIVATE_KEY</code> on the OpenPortal server, then re-open this guide.
                      </li>
                    )}
                  </ul>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Button variant='ghost' style={{ fontSize: 11, padding: '5px 10px' }} onClick={copy}>
                    <Icon name='copy' size={11} /> {copied ? 'Copied!' : 'Copy'}
                  </Button>
                  <Button variant='primary' style={{ fontSize: 11, padding: '5px 10px' }} onClick={download}>
                    <Icon name='download' size={11} /> Download {peer?.name ?? 'peer'}.conf
                  </Button>
                </div>
              </div>
            </div>

            {/* Step 2 — Save the file */}
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={numBadge}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Edit and save the config on the host
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px 0', lineHeight: 1.7 }}>
                  Open the downloaded file, replace <code className="mono" style={{ fontSize: 11 }}>{'<PASTE_YOUR_PRIVATE_KEY_HERE>'}</code> with the output of:
                </p>
                <code style={codeBlock}>{'cat /etc/wireguard/priv.key'}</code>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 6px 0', lineHeight: 1.7 }}>
                  Then save the file as <code className="mono" style={{ fontSize: 11 }}>/etc/wireguard/wg0.conf</code> on the host.
                </p>
              </div>
            </div>

            {/* Step 3 — Start tunnel */}
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={numBadge}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Start the VPN tunnel
                </div>
                <code style={codeBlock}>{
`# Start now and enable on every reboot (one command)
sudo systemctl enable --now wg-quick@wg0

# Verify the tunnel is up
sudo wg show`
                }</code>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.7 }}>
                  You should see a recent <em>latest handshake</em> in the output — that confirms the tunnel is live.
                  The tool will show as <strong>Online</strong> in your dashboard once connected.
                </p>
              </div>
            </div>

          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <Button variant='ghost' onClick={onDone}>Close</Button>
        <Button variant='primary' onClick={onDone}>Done — tunnel is active</Button>
      </div>
    </Modal>
  )
}

// ── Tool details form (used by wizard and as fallback) ────────────────────────

function ToolDetailsForm({ isPrivate, categories, defaultUrl = '', onBack, onClose, onSaved }: {
  isPrivate: boolean; categories: string[]; defaultUrl?: string; onBack: () => void; onClose: () => void; onSaved: () => void
}) {
  const [name,       setName]       = useState('')
  const [url,        setUrl]        = useState(defaultUrl)
  const [category,   setCategory]   = useState('')
  const [authType,   setAuthType]   = useState('none')
  const [creds,      setCreds]      = useState<Record<string, string>>({})
  const [faviconSrc, setFaviconSrc] = useState('')
  const [customIcon, setCustomIcon] = useState('')
  const [iconMode,   setIconMode]   = useState<'auto' | 'custom'>('auto')
  const [detecting,  setDetecting]  = useState(false)
  const [detectedAuth, setDetectedAuth] = useState<string | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [credsConfirm, setCredsConfirm] = useState(false)
  const [showCreds,    setShowCreds]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUrlBlur = async () => {
    if (!url) return
    let origin: string
    try { origin = new URL(url).origin } catch { return }

    setFaviconSrc(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=64`)

    setDetecting(true)
    try {
      const res = await api.detectAuth(url)
      setAuthType(res.auth_type)
      setDetectedAuth(res.auth_type)
    } catch { /* silent */ }
    finally { setDetecting(false) }
  }

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCustomIcon(reader.result as string)
      setIconMode('custom')
    }
    reader.readAsDataURL(file)
  }

  const iconSrc = iconMode === 'custom' ? customIcon : faviconSrc

  const save = async () => {
    if (!name || !url) { setError('Tool name and URL are required.'); return }
    setSaving(true)
    try {
      const res = await api.createTool({
        name, url, category,
        auth_type: authType as Tool['auth_type'],
        is_private: isPrivate,
        use_wg: isPrivate,
        custom_icon: iconSrc || null,
        status: 'online',
      } as Partial<Tool>) as { id: string }
      if (Object.keys(creds).length > 0 && res.id) {
        await api.setCredentials(res.id, creds)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save tool')
    } finally { setSaving(false) }
  }

  const authInfo = AUTH_LABELS[authType] ?? AUTH_LABELS.none

  return (
    <div>
      {/* Icon + name row */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div
            onClick={() => fileRef.current?.click()}
            title="Click to upload a custom icon"
            style={{
              width: 58, height: 58, borderRadius: 12,
              border: '2px dashed var(--border)',
              background: 'var(--surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
              transition: 'border-color 0.15s',
            }}
          >
            {iconSrc ? (
              <img src={iconSrc} alt="" style={{ width: iconMode === 'custom' ? '100%' : 36, height: iconMode === 'custom' ? '100%' : 36, objectFit: 'cover' }}
                onError={() => { setFaviconSrc(''); setIconMode('auto') }} />
            ) : (
              <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--border)' }}>
                {name[0]?.toUpperCase() || <Icon name="plus" size={20} />}
              </span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleIconUpload} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {iconMode === 'custom' ? (
              <button onClick={() => { setIconMode('auto'); setCustomIcon('') }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: 0 }}>
                reset
              </button>
            ) : 'click to upload'}
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormRow label="Tool name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Grafana, Jira, Metabase…" autoFocus />
          </FormRow>
          <FormRow label="URL">
            <div style={{ position: 'relative' }}>
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); setDetectedAuth(null) }}
                onBlur={handleUrlBlur}
                placeholder={isPrivate ? 'http://10.10.0.2:3000' : 'https://tool.yourcompany.com'}
                style={{ paddingRight: detecting ? 36 : undefined }}
              />
              {detecting && (
                <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                  <Spinner size={13} />
                </div>
              )}
            </div>
          </FormRow>
        </div>
      </div>

      <FormRow label="Category">
        <CategoryCombobox value={category} onChange={setCategory} categories={categories} />
      </FormRow>

      {detectedAuth && !detecting && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
          padding: '9px 14px', borderRadius: 8,
          background: 'var(--green-dim)', border: '1px solid rgba(16,185,129,0.2)',
          fontSize: 12, color: 'var(--green)',
        }}>
          <Icon name="check" size={13} />
          <span>Login type detected: <strong>{authInfo.label}</strong></span>
          {(authType === 'basic' || authType === 'token') && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>— enter credentials below</span>
          )}
          {(authType === 'oauth' || authType === 'saml') && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>— handled automatically</span>
          )}
        </div>
      )}

      {/* Shared credentials — opt-in, gated behind confirmation */}
      {showCreds ? (
        <div style={{
          background: 'rgba(255,193,7,0.08)', border: '1px solid rgba(255,193,7,0.3)',
          borderRadius: 8, padding: '12px 16px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 5v4M8 11v1" stroke="#FFC107" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6.8 1.9L1.2 11.5c-.5.9.1 2 1.2 2h11.2c1.1 0 1.7-1.1 1.2-2L9.2 1.9a1.4 1.4 0 00-2.4 0z" stroke="#FFC107" strokeWidth="1.3"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>Shared credentials — visible to ALL users</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
            These are injected for every user who opens this tool. Only use a shared service account here.
            For individual logins, set per-user credentials in the <strong>Users</strong> tab instead.
          </p>
          <CredentialSection authType={authType} onChange={setCreds} />
          <button
            onClick={() => { setShowCreds(false); setCreds({}) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', padding: 0, marginTop: 4 }}
          >
            ✕ Remove shared credentials
          </button>
        </div>
      ) : (
        <div style={{
          border: '1px dashed var(--border)', borderRadius: 8,
          padding: '14px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Shared credentials</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Optional. These apply to <strong>every user</strong> — only for tools with a single shared account.
            </div>
          </div>
          <Button variant="ghost" style={{ flexShrink: 0, fontSize: 12 }} onClick={() => setCredsConfirm(true)}>
            <Icon name="key" size={12} /> Add credentials
          </Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>Add tool</Button>
        </div>
      </div>

      {credsConfirm && (
        <ConfirmDialog
          title="Set shared credentials"
          message="These credentials will be injected for every user who accesses this tool — they are universal, not private. Only continue if this tool uses a single shared service account. For individual user logins, use per-user credentials in the Users tab."
          confirmLabel="I understand, add credentials"
          variant="default"
          onConfirm={() => { setCredsConfirm(false); setShowCreds(true) }}
          onCancel={() => setCredsConfirm(false)}
        />
      )}
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </div>
  )
}

// ── Category combobox ─────────────────────────────────────────────────────────
// Uses a native <datalist> so the browser renders the suggestion dropdown
// outside any CSS stacking/overflow context — no clipping possible.

function CategoryCombobox({ value, onChange, categories }: {
  value: string; onChange: (v: string) => void; categories: string[]
}) {
  return (
    <div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        list="category-suggestions"
        placeholder="Monitoring, DevOps, Analytics…"
        autoComplete="off"
      />
      <datalist id="category-suggestions">
        {categories.map(cat => <option key={cat} value={cat} />)}
      </datalist>
      {value.trim() !== '' && !categories.some(c => c.toLowerCase() === value.trim().toLowerCase()) && (
        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4 }}>
          "{value.trim()}" will be created as a new category
        </div>
      )}
    </div>
  )
}

// ── Credential section ────────────────────────────────────────────────────────
// Shows the right fields based on detected auth type.
// When auth_type is "none" (detection failed or N/A), shows generic username/
// password + token fields — the proxy will infer injection from the keys.

function CredentialSection({ authType, onChange }: {
  authType: string; onChange: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const set = (key: string, val: string) =>
    onChange(prev => val ? { ...prev, [key]: val } : (() => { const n = { ...prev }; delete n[key]; return n })())

  const isNone = authType === 'none'
  const isBasic = authType === 'basic' || isNone
  const isToken = authType === 'token' || isNone
  const isOauth = authType === 'oauth'
  const isSaml  = authType === 'saml'

  if (!isBasic && !isToken && !isOauth && !isSaml) return null

  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {isNone ? 'Credentials (fill whichever applies)' : 'Shared credentials'}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Stored encrypted — injected automatically when users open this tool.
      </p>
      {(isBasic) && (
        <>
          <FormRow label="Username">
            <input placeholder="admin" onChange={e => set('username', e.target.value)} />
          </FormRow>
          <FormRow label="Password">
            <input type="password" placeholder="••••••••" onChange={e => set('password', e.target.value)} />
          </FormRow>
        </>
      )}
      {isToken && !isBasic && (
        <FormRow label="API key / token">
          <input type="password" placeholder="sk-…" onChange={e => set('token', e.target.value)} />
        </FormRow>
      )}
      {isNone && (
        <FormRow label="API key / token (alternative)">
          <input type="password" placeholder="sk-… (leave blank if using username above)" onChange={e => set('token', e.target.value)} />
        </FormRow>
      )}
      {isOauth && (
        <FormRow label="Access token">
          <input type="password" placeholder="••••••••" onChange={e => set('access_token', e.target.value)} />
        </FormRow>
      )}
      {isSaml && (
        <FormRow label="Session cookie">
          <input placeholder="cookie_name=value" onChange={e => set('session_cookie', e.target.value)} />
        </FormRow>
      )}
    </div>
  )
}

// ── Edit tool modal (separate, simpler) ───────────────────────────────────────

function EditToolModal({ tool, onClose, onSaved }: {
  tool: Tool; onClose: () => void; onSaved: () => void
}) {
  const [name,      setName]      = useState(tool.name)
  const [url,       setUrl]       = useState(tool.url)
  const [category,  setCategory]  = useState(tool.category)
  const [authType,  setAuthType]  = useState(tool.auth_type)
  const [isPrivate, setIsPrivate] = useState(tool.is_private)
  const [status,    setStatus]    = useState(tool.status)
  const [creds,     setCreds]     = useState<Record<string, string>>({})
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateTool(tool.id, {
        name, url, category,
        auth_type: authType as Tool['auth_type'],
        is_private: isPrivate,
        use_wg: isPrivate,
        status: status as Tool['status'],
      })
      if (Object.keys(creds).length > 0) {
        await api.setCredentials(tool.id, creds)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save tool')
    } finally { setSaving(false) }
  }

  const credFields = CRED_FIELDS[authType] ?? []

  return (
    <Modal title={`Edit — ${tool.name}`} onClose={onClose} width={480}>
      <FormRow label="Tool name">
        <input value={name} onChange={e => setName(e.target.value)} autoFocus />
      </FormRow>
      <FormRow label="URL">
        <input value={url} onChange={e => setUrl(e.target.value)} />
      </FormRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormRow label="Category">
          <input value={category} onChange={e => setCategory(e.target.value)} />
        </FormRow>
        <FormRow label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as Tool['status'])}>
            <option value="online">Online</option>
            <option value="degraded">Degraded</option>
            <option value="offline">Offline</option>
          </select>
        </FormRow>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormRow label="Login type">
          <select value={authType} onChange={e => setAuthType(e.target.value)}>
            {Object.entries(AUTH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Access">
          <select value={isPrivate ? 'private' : 'public'} onChange={e => setIsPrivate(e.target.value === 'private')}>
            <option value="public">Public</option>
            <option value="private">Private (WireGuard)</option>
          </select>
        </FormRow>
      </div>

      {credFields.length > 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
            Update credentials (leave blank to keep existing)
          </div>
          {credFields.map(f => (
            <FormRow key={f.key} label={f.label}>
              <input
                type={f.secret ? 'password' : 'text'}
                placeholder={f.secret ? '••••••••' : (f.placeholder ?? '')}
                onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
              />
            </FormRow>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Save changes</Button>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </Modal>
  )
}
