import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { authActions } from '../stores/auth'
import { Button, Spinner } from '../components/ui'

type Step = 'credentials' | 'totp'

export default function LoginPage() {
  const [step,         setStep]         = useState<Step>('credentials')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [totpCode,     setTotpCode]     = useState('')
  const [pendingToken, setPendingToken] = useState('')
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const setAuth  = authActions.setAuth
  const navigate = useNavigate()
  const codeRef  = useRef<HTMLInputElement>(null)

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.login(email, password)
      if (res.totp_required) {
        setPendingToken(res.pending_token)
        setStep('totp')
        setTimeout(() => codeRef.current?.focus(), 50)
      } else {
        setAuth({ email: res.email, name: res.name, is_admin: res.is_admin }, res.token)
        navigate(res.is_admin ? '/admin' : '/dashboard')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const submitTOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.verifyTOTP(pendingToken, totpCode)
      setAuth({ email: res.email, name: res.name, is_admin: res.is_admin }, res.token)
      navigate(res.is_admin ? '/admin' : '/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      setTotpCode('')
      setTimeout(() => codeRef.current?.focus(), 50)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
    }}>
      {/* ── Left panel — brand ─────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(145deg, #1A2370 0%, #303F9F 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', width: 400, height: 400,
          borderRadius: '50%', border: '1px solid rgba(255,255,255,0.07)',
          top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        }} />
        <div style={{
          position: 'absolute', width: 600, height: 600,
          borderRadius: '50%', border: '1px solid rgba(255,255,255,0.04)',
          top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        }} />
        <img
          src="/logo-icon.png"
          alt="OpenPortal"
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 160, height: 160, objectFit: 'contain',
          }}
        />
        <div style={{
          position: 'absolute',
          top: 'calc(50% + 115px)', left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          <div style={{ color: '#FFFFFF', fontSize: 22, fontWeight: 700, letterSpacing: '0.02em' }}>
            OpenPortal
          </div>
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.65)', fontSize: 13, letterSpacing: '0.06em' }}>
            Your Secure Entry
          </div>
        </div>
      </div>

      {/* ── Right panel — form ─────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 48, background: 'var(--bg)',
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>

          {step === 'credentials' ? (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.02em' }}>
                Welcome back
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
                Sign in to your workspace.
              </p>

              <form onSubmit={submitCredentials}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: 'block', fontSize: 12, fontWeight: 600,
                    color: 'var(--text-muted)', marginBottom: 6,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    Email
                  </label>
                  <input
                    type="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required autoFocus
                  />
                </div>

                <div style={{ marginBottom: 28 }}>
                  <label style={{
                    display: 'block', fontSize: 12, fontWeight: 600,
                    color: 'var(--text-muted)', marginBottom: 6,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    Password
                  </label>
                  <input
                    type="password" value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error && <ErrorBanner>{error}</ErrorBanner>}

                <Button
                  variant="primary" type="submit" disabled={loading}
                  style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', fontSize: 14 }}
                >
                  {loading ? <><Spinner size={13} /> Signing in…</> : 'Sign in'}
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* TOTP step */}
              <button
                onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: 'var(--text-muted)', fontSize: 12, marginBottom: 24, padding: 0,
                }}
              >
                ← Back
              </button>

              <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.02em' }}>
                Two-factor auth
              </h1>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
                Enter the 6-digit code from your authenticator app.
              </p>

              <form onSubmit={submitTOTP}>
                <div style={{ marginBottom: 28 }}>
                  <label style={{
                    display: 'block', fontSize: 12, fontWeight: 600,
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
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    required
                    autoComplete="one-time-code"
                    style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
                  />
                </div>

                {error && <ErrorBanner>{error}</ErrorBanner>}

                <Button
                  variant="primary" type="submit"
                  disabled={loading || totpCode.length !== 6}
                  style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', fontSize: 14 }}
                >
                  {loading ? <><Spinner size={13} /> Verifying…</> : 'Verify'}
                </Button>
              </form>
            </>
          )}

          <p style={{ marginTop: 40, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
            Self-hosted · Open source · Your data stays yours
          </p>
        </div>
      </div>
    </div>
  )
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
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
