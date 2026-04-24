import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { type User, type Role, type Tool } from '../../types'
import {
  Button, Icon, StatusDot, Tag, Modal, FormRow,
  Table, Tr, Td, EmptyState, Spinner, ConfirmDialog, AlertDialog,
} from '../../components/ui'

const avatarBg = (name: string) => `hsl(${(name.charCodeAt(0) * 37) % 360}, 40%, 22%)`
const initials  = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase()
const authLabel: Record<string, string> = {
  none: 'None', basic: 'Basic auth', token: 'API token', oauth: 'OAuth 2.0', saml: 'SAML',
}

export default function UsersTab() {
  const [users,   setUsers]   = useState<User[]>([])
  const [roles,   setRoles]   = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showInvite, setShowInvite]   = useState(false)
  const [editUser,   setEditUser]     = useState<User | null>(null)
  const [credUser,   setCredUser]     = useState<User | null>(null)
  const [confirmDel, setConfirmDel]   = useState<User | null>(null)

  const load = () => {
    Promise.all([api.users(), api.roles()])
      .then(([u, r]) => { setUsers(u); setRoles(r) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const toggleStatus = async (user: User) => {
    await api.updateUserStatus(user.id, user.status === 'active' ? 'suspended' : 'active')
    load()
  }

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input
          placeholder="Search users..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="primary" onClick={() => setShowInvite(true)}>
            <Icon name="plus" size={13} /> Invite user
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      ) : (
        <Table headers={['User', 'Role', 'MFA', 'Status', 'Last seen', '']}>
          {filtered.length === 0 && (
            <tr><td colSpan={6}><EmptyState message="No users found." /></td></tr>
          )}
          {filtered.map(user => (
            <Tr key={user.id} faded={user.status === 'suspended'}>
              <Td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: avatarBg(user.name),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                  }}>
                    {initials(user.name)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user.email}</div>
                  </div>
                </div>
              </Td>
              <Td>{user.role ? <Tag>{user.role}</Tag> : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}</Td>
              <Td>
                {user.mfa_enabled
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--green)',  fontSize: 12 }}><Icon name="check" size={12} /> Enabled</span>
                  : <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--amber)', fontSize: 12 }}><Icon name="x"     size={12} /> Off</span>
                }
              </Td>
              <Td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot status={user.status} />
                  <span style={{ fontSize: 12, textTransform: 'capitalize', color: user.status === 'suspended' ? 'var(--red)' : 'var(--text)' }}>
                    {user.status}
                  </span>
                </div>
              </Td>
              <Td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.last_seen ?? '—'}</span></Td>
              <Td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="ghost" style={{ padding: '4px 8px' }} onClick={() => setEditUser(user)}>
                    <Icon name="edit" size={12} />
                  </Button>
                  <Button variant="ghost" style={{ padding: '4px 8px' }} title="Per-user credentials" onClick={() => setCredUser(user)}>
                    <Icon name="key" size={12} />
                  </Button>
                  <Button
                    variant={user.status === 'active' ? 'danger' : 'ghost'}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => toggleStatus(user)}
                  >
                    {user.status === 'active' ? 'Suspend' : 'Reinstate'}
                  </Button>
                  <Button variant="danger" style={{ padding: '4px 8px' }} onClick={() => setConfirmDel(user)}>
                    <Icon name="trash" size={12} />
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      )}

      {showInvite && (
        <InviteModal
          roles={roles}
          onClose={() => setShowInvite(false)}
          onSaved={() => { setShowInvite(false); load() }}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          roles={roles}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); load() }}
        />
      )}

      {credUser && (
        <UserCredsModal
          user={credUser}
          onClose={() => setCredUser(null)}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          variant="danger"
          title="Delete user"
          message={`Permanently delete ${confirmDel.name}? This cannot be undone and will remove all their access.`}
          confirmLabel="Delete user"
          onConfirm={async () => { await api.deleteUser(confirmDel.id); setConfirmDel(null); load() }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ── Invite modal ──────────────────────────────────────────────────────────────
function InviteModal({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [roleId,   setRoleId]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const save = async () => {
    if (!name || !email || !password) { setError('All fields are required.'); return }
    setSaving(true)
    try {
      await api.createUser({ email, name, password, role_id: roleId || undefined })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally { setSaving(false) }
  }

  return (
    <Modal title="Invite user" onClose={onClose}>
      <FormRow label="Full name"><input value={name}     onChange={e => setName(e.target.value)}     placeholder="Jane Smith" /></FormRow>
      <FormRow label="Email">    <input value={email}    onChange={e => setEmail(e.target.value)}    type="email" placeholder="jane@company.com" /></FormRow>
      <FormRow label="Password"> <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••" /></FormRow>
      <FormRow label="Role">
        <select value={roleId} onChange={e => setRoleId(e.target.value)}>
          <option value="">No role</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </FormRow>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Create user</Button>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </Modal>
  )
}

// ── Edit user modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, roles, onClose, onSaved }: {
  user: User; roles: Role[]; onClose: () => void; onSaved: () => void
}) {
  const [name,     setName]     = useState(user.name)
  const [email,    setEmail]    = useState(user.email)
  const [password, setPassword] = useState('')
  const [roleId,   setRoleId]   = useState(user.role_id ?? '')
  const [status,   setStatus]   = useState(user.status)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateUser(user.id, {
        name, email,
        password: password || undefined,
        role_id: roleId || undefined,
        status,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally { setSaving(false) }
  }

  return (
    <Modal title={`Edit — ${user.name}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormRow label="Full name">
          <input value={name} onChange={e => setName(e.target.value)} />
        </FormRow>
        <FormRow label="Email">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </FormRow>
      </div>
      <FormRow label="New password" hint="Leave blank to keep current password.">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
      </FormRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormRow label="Role">
          <select value={roleId} onChange={e => setRoleId(e.target.value)}>
            <option value="">No role</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Status">
          <select value={status} onChange={e => setStatus(e.target.value as User['status'])}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </FormRow>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Save changes</Button>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </Modal>
  )
}

// ── Per-user credentials modal ────────────────────────────────────────────────
function UserCredsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [tools,        setTools]        = useState<Tool[]>([])
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const [existingKeys, setExistingKeys] = useState<{ key: string; updated_at: string }[]>([])
  const [creds,        setCreds]        = useState<Record<string, string>>({})
  const [saving,       setSaving]       = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [success,      setSuccess]      = useState<string | null>(null)
  const [confirmDelCreds, setConfirmDelCreds] = useState(false)

  useEffect(() => {
    api.adminTools().then(t => { setTools(t); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedTool) return
    api.getUserCredentials(user.id, selectedTool.id)
      .then(setExistingKeys)
      .catch(() => setExistingKeys([]))
    setCreds({})
  }, [selectedTool, user.id])

  const save = async () => {
    if (!selectedTool || Object.keys(creds).length === 0) return
    setSaving(true)
    try {
      await api.setUserCredentials(user.id, selectedTool.id, creds)
      const updated = await api.getUserCredentials(user.id, selectedTool.id)
      setExistingKeys(updated)
      setCreds({})
      setSuccess('Credentials saved successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials')
    } finally { setSaving(false) }
  }

  const CredFields = () => {
    if (!selectedTool) return null
    const type = selectedTool.auth_type
    if (type === 'none') return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No credentials needed.</p>
    return (
      <>
        {type === 'basic' && (<>
          <FormRow label="Username"><input onChange={e => setCreds(c => ({ ...c, username: e.target.value }))} /></FormRow>
          <FormRow label="Password"><input type="password" onChange={e => setCreds(c => ({ ...c, password: e.target.value }))} /></FormRow>
        </>)}
        {type === 'token' && (
          <FormRow label="Token"><input onChange={e => setCreds(c => ({ ...c, token: e.target.value }))} /></FormRow>
        )}
        {type === 'oauth' && (<>
          <FormRow label="Access token"><input onChange={e => setCreds(c => ({ ...c, access_token: e.target.value }))} /></FormRow>
        </>)}
      </>
    )
  }

  return (
    <Modal title={`Credentials — ${user.name}`} onClose={onClose} width={520}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Per-user credentials override the tool's shared credentials for this user only.
      </p>

      <FormRow label="Select tool">
        {loading ? <Spinner size={14} /> : (
          <select
            value={selectedTool?.id ?? ''}
            onChange={e => setSelectedTool(tools.find(t => t.id === e.target.value) ?? null)}
          >
            <option value="">— choose a tool —</option>
            {tools.map(t => <option key={t.id} value={t.id}>{t.name} ({authLabel[t.auth_type]})</option>)}
          </select>
        )}
      </FormRow>

      {selectedTool && (
        <>
          {existingKeys.length > 0 && (
            <div style={{
              background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
                  Custom credentials active
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Keys: {existingKeys.map(k => k.key).join(', ')}
                </div>
              </div>
              <Button variant="danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setConfirmDelCreds(true)}>
                Remove
              </Button>
            </div>
          )}

          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '14px 16px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Set new credentials
            </div>
            <CredFields />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={save} loading={saving}
              disabled={Object.keys(creds).length === 0}>
              Save credentials
            </Button>
          </div>
        </>
      )}

      {confirmDelCreds && selectedTool && (
        <ConfirmDialog
          variant="danger"
          title="Remove credentials"
          message={`Remove all per-user credentials for ${selectedTool.name}? The shared tool credentials will be used instead.`}
          confirmLabel="Remove"
          onConfirm={async () => {
            await api.deleteUserCredentials(user.id, selectedTool.id)
            setExistingKeys([])
            setConfirmDelCreds(false)
          }}
          onCancel={() => setConfirmDelCreds(false)}
        />
      )}
      {error   && <AlertDialog variant="error"   message={error}   onClose={() => setError(null)} />}
      {success && <AlertDialog variant="success" message={success} onClose={() => setSuccess(null)} />}
    </Modal>
  )
}
