import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../lib/api'
import { Button, Icon, Spinner } from './ui'

interface Props {
  mfaEnabled: boolean
  onClose: () => void
  onChanged: () => void
}

type SetupPhase = 'idle' | 'qr' | 'verify' | 'done'

export function SecurityModal({ mfaEnabled, onClose, onChanged }: Props) {
  const [phase,   setPhase]   = useState<SetupPhase>('idle')
  const [uri,     setUri]     = useState('')
  const [secret,  setSecret]  = useState('')
  const [code,    setCode]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [copied,  setCopied]  = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'verify') setTimeout(() => codeRef.current?.focus(), 50)
  }, [phase])

  const startSetup = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await api.totpSetup()
      setUri(res.provisioning_uri)
      setSecret(res.secret)
      setPhase('qr')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  const enable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.totpEnable(code)
      setPhase('done')
      onChanged()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code')
      setCode('')
      setTimeout(() => codeRef.current?.focus(), 50)
    } finally {
      setLoading(false)
    }
  }

  const disable = async () => {
    if (!confirm('Disable two-factor authentication? Your account will be less secure.')) return
    setError('')
    setLoading(true)
    try {
      await api.totpDisable()
      onChanged()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 12, width: '100%', maxWidth: 440,
        boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(48,63,159,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="lock" size={15} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
              Security
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 4,
          }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 24px 28px' }}>

          {/* ── Already enabled — show status + disable ── */}
          {mfaEnabled && phase === 'idle' && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)',
                borderRadius: 8, padding: '12px 14px', marginBottom: 20,
              }}>
                <span style={{ fontSize: 16 }}>✓</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>
                    Two-factor authentication is on
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Your account is protected with an authenticator app.
                  </div>
                </div>
              </div>
              {error && <ErrorBox>{error}</ErrorBox>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button
                  variant="ghost"
                  onClick={disable}
                  disabled={loading}
                  style={{ fontSize: 13, color: 'var(--red)' }}
                >
                  {loading ? <Spinner size={12} /> : <Icon name="trash" size={13} />}
                  Disable 2FA
                </Button>
              </div>
            </>
          )}

          {/* ── Not enabled — offer to enable ── */}
          {!mfaEnabled && phase === 'idle' && (
            <>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
                Two-factor authentication adds an extra layer of security. Each time you sign in you'll
                need your password <em>and</em> a one-time code from your authenticator app.
              </p>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button variant="primary" onClick={startSetup} disabled={loading} style={{ fontSize: 13 }}>
                {loading ? <Spinner size={12} /> : <Icon name="lock" size={13} />}
                Set up 2FA
              </Button>
            </>
          )}

          {/* ── QR code ── */}
          {phase === 'qr' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
                Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
              </p>
              <div style={{
                display: 'flex', justifyContent: 'center',
                background: '#fff', borderRadius: 8, padding: 16, marginBottom: 16,
              }}>
                <QRCodeSVG value={uri} size={160} />
              </div>

              {/* Manual entry fallback */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Or enter the key manually
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--surface)', borderRadius: 6, padding: '8px 12px',
                  border: '1px solid var(--border)',
                }}>
                  <code style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--text)', flex: 1, wordBreak: 'break-all' }}>
                    {secret}
                  </code>
                  <button onClick={copySecret} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: copied ? '#16a34a' : 'var(--text-muted)', padding: 2, flexShrink: 0,
                  }}>
                    <Icon name="copy" size={13} />
                  </button>
                </div>
                {copied && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>Copied!</div>}
              </div>

              <Button variant="primary" onClick={() => setPhase('verify')} style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}>
                I've scanned it — continue
              </Button>
            </>
          )}

          {/* ── Verify code ── */}
          {phase === 'verify' && (
            <form onSubmit={enable}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
                Enter the 6-digit code from your authenticator app to confirm the setup.
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontSize: 11, fontWeight: 600,
                  color: 'var(--text-muted)', marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  Verification code
                </label>
                <input
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                  autoComplete="one-time-code"
                  style={{ fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' }}
                />
              </div>
              {error && <ErrorBox>{error}</ErrorBox>}
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" type="button" onClick={() => setPhase('qr')} style={{ fontSize: 13 }}>
                  Back
                </Button>
                <Button
                  variant="primary" type="submit"
                  disabled={loading || code.length !== 6}
                  style={{ flex: 1, justifyContent: 'center', fontSize: 13 }}
                >
                  {loading ? <><Spinner size={12} /> Verifying…</> : 'Enable 2FA'}
                </Button>
              </div>
            </form>
          )}

          {/* ── Done ── */}
          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                2FA is now active
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
                Your account is protected. You'll need your authenticator code every time you sign in.
              </p>
              <Button variant="primary" onClick={onClose} style={{ justifyContent: 'center' }}>
                Done
              </Button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)',
      borderRadius: 8, padding: '10px 14px', fontSize: 13,
      color: 'var(--red)', marginBottom: 16,
    }}>
      {children}
    </div>
  )
}
