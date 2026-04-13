import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { type Role, type Tool } from '../../types'
import { Button, Icon, Tag, Modal, FormRow, EmptyState, Spinner, ConfirmDialog, AlertDialog } from '../../components/ui'

export default function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Role | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = () => {
    Promise.all([api.roles(), api.adminTools()])
      .then(([r, t]) => {
        setRoles(r)
        setTools(t)
        if (!selected && r.length > 0) setSelected(r[0])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const toggleTool = async (toolName: string) => {
    if (!selected) return
    const tool = tools.find(t => t.name === toolName)
    if (!tool) return
    const hasIt = (selected.tools ?? []).includes(toolName)
    const newTools = hasIt
      ? (selected.tools ?? []).filter(t => t !== toolName)
      : [...(selected.tools ?? []), toolName]
    const updated = { ...selected, tools: newTools }
    setSelected(updated)
    setRoles(rs => rs.map(r => r.id === updated.id ? updated : r))

    setSaving(true)
    const allToolIds = tools.filter(t => newTools.includes(t.name)).map(t => t.id)
    await api.setRoleTools(selected.id, allToolIds).catch(() => {})
    setSaving(false)
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
      {/* Roles list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Roles
          </span>
          <Button variant="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={11} />
          </Button>
        </div>

        {roles.length === 0 && <EmptyState message="No roles yet." />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {roles.map(role => (
            <div
              key={role.id}
              onClick={() => setSelected(role)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                cursor: 'pointer',
                background: selected?.id === role.id ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${selected?.id === role.id ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
                transition: 'all 0.1s',
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: role.color, flexShrink: 0 }} />
              <span style={{
                fontSize: 13, flex: 1,
                fontWeight: selected?.id === role.id ? 500 : 400,
                color: selected?.id === role.id ? 'var(--accent)' : 'var(--text)',
              }}>
                {role.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{role.user_count}u</span>
              <Button
                variant="ghost"
                style={{ padding: '2px 4px', opacity: 0.5 }}
                onClick={e => { e.stopPropagation(); setConfirmDel(role.id) }}
              >
                <Icon name="trash" size={11} />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Role detail */}
      {selected ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: selected.color }} />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</h3>
            <Tag color="var(--text-muted)">{selected.user_count} user{selected.user_count !== 1 ? 's' : ''}</Tag>
            {saving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving…</span>}
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Tool access
          </div>

          {tools.length === 0 ? (
            <EmptyState message="No tools configured yet." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {tools.map(tool => {
                const granted = (selected.tools ?? []).includes(tool.name)
                return (
                  <div
                    key={tool.id}
                    onClick={() => toggleTool(tool.name)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                      border: `1px solid ${granted ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`,
                      background: granted ? 'var(--accent-dim)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: granted ? 'rgba(99,102,241,0.2)' : 'var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700,
                        color: granted ? 'var(--accent)' : 'var(--text-muted)',
                      }}>
                        {tool.name[0]}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{tool.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tool.category}</div>
                      </div>
                    </div>
                    <div style={{
                      width: 16, height: 16, borderRadius: 4,
                      border: `1.5px solid ${granted ? 'var(--accent)' : 'var(--text-muted)'}`,
                      background: granted ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {granted && <Icon name="check" size={10} />}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13 }}>
          Select a role to configure access
        </div>
      )}

      {showAdd && (
        <AddRoleModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load() }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          variant="danger"
          title="Delete role"
          message="Delete this role? Users assigned to it will lose their role assignment."
          confirmLabel="Delete role"
          onConfirm={async () => { await api.deleteRole(confirmDel); setConfirmDel(null); load() }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function AddRoleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#303F9F')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    try {
      await api.createRole({ name, color })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Create role" onClose={onClose}>
      <FormRow label="Role name"><input value={name} onChange={e => setName(e.target.value)} placeholder="Engineering" /></FormRow>
      <FormRow label="Color">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 40, height: 36, padding: 2, cursor: 'pointer' }} />
          <input value={color} onChange={e => setColor(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
      </FormRow>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Create role</Button>
      </div>
      {error && <AlertDialog message={error} onClose={() => setError(null)} />}
    </Modal>
  )
}
