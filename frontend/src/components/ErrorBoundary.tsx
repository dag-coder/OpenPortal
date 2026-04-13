import React from 'react'

interface Props  { children: React.ReactNode; fallback?: string }
interface State  { hasError: boolean; error: string; info: string }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '', info: '' }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[OpenPortal] React render error:', error, info)
    this.setState({ info: info.componentStack ?? '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#F8F9FA', padding: 24,
        }}>
          <div style={{
            maxWidth: 480, width: '100%',
            background: '#fff', border: '1px solid #DEE2E6',
            borderRadius: 12, padding: 32, textAlign: 'center',
            boxShadow: '0 4px 12px rgba(52,58,64,0.08)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#343A40', marginBottom: 8 }}>
              {this.props.fallback ?? 'Something went wrong'}
            </h2>
            <p style={{ fontSize: 13, color: '#6C757D', marginBottom: 20 }}>
              {this.state.error}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '9px 20px', background: '#303F9F', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                }}
              >
                Refresh page
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: '', info: '' })}
                style={{
                  padding: '9px 20px', background: 'transparent', color: '#6C757D',
                  border: '1px solid #DEE2E6', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
