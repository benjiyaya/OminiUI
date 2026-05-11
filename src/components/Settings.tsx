import { useState, useEffect } from 'react'

interface McpServer {
  name: string
  displayName: string
  url: string
  enabled: boolean
  idleTimeoutMs?: number
}

interface McpServerStatus {
  name: string
  displayName: string
  url: string
  status: 'connected' | 'connecting' | 'error' | 'disconnected'
  toolCount: number
  lastError?: string
  enabled: boolean
}

interface Props {
  open: boolean
  onClose: () => void
}

const STATUS_COLORS: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  error: '#ef4444',
  disconnected: '#6b7280',
}

export default function Settings({ open, onClose }: Props) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [adding, setAdding] = useState(false)
  const [newServer, setNewServer] = useState<McpServer>({
    name: '',
    displayName: '',
    url: 'http://localhost:8080/mcp',
    enabled: true,
    idleTimeoutMs: 600000,
  })
  const [error, setError] = useState('')

  const fetchServers = async () => {
    try {
      const resp = await fetch('/api/mcp-servers')
      const data = await resp.json()
      setServers(data.servers || [])
      setStatuses(data.status || [])
    } catch {}
  }

  useEffect(() => {
    if (open) {
      fetchServers()
      const interval = setInterval(fetchServers, 3000)
      return () => clearInterval(interval)
    }
  }, [open])

  const addServer = async () => {
    setError('')
    if (!newServer.name || !newServer.displayName || !newServer.url) {
      setError('All fields are required')
      return
    }
    try {
      const resp = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newServer),
      })
      if (!resp.ok) {
        const err = await resp.json()
        setError(err.error || 'Failed to add server')
        return
      }
      setAdding(false)
      setNewServer({ name: '', displayName: '', url: 'http://localhost:8080/mcp', enabled: true, idleTimeoutMs: 600000 })
      fetchServers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const removeServer = async (name: string) => {
    if (!confirm(`Remove server "${name}"?`)) return
    try {
      await fetch(`/api/mcp-servers/${name}`, { method: 'DELETE' })
      fetchServers()
    } catch {}
  }

  const reconnectServer = async (name: string) => {
    try {
      await fetch(`/api/mcp-servers/${name}/reconnect`, { method: 'POST' })
      fetchServers()
    } catch {}
  }

  const toggleServer = async (name: string, enabled: boolean) => {
    try {
      await fetch(`/api/mcp-servers/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      fetchServers()
    } catch {}
  }

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>MCP Servers</h2>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {error && <div className="settings-error">{error}</div>}

          <div className="settings-list">
            {servers.map((server) => {
              const st = statuses.find((s) => s.name === server.name)
              return (
                <div key={server.name} className="settings-server-card">
                  <div className="settings-server-header">
                    <div className="settings-server-info">
                      <span
                        className="settings-status-dot"
                        style={{ background: STATUS_COLORS[st?.status || 'disconnected'] }}
                      />
                      <div>
                        <div className="settings-server-name">{server.displayName}</div>
                        <div className="settings-server-url">{server.url}</div>
                      </div>
                    </div>
                    <div className="settings-server-actions">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(e) => toggleServer(server.name, e.target.checked)}
                        />
                        <span className="settings-toggle-slider" />
                      </label>
                      {st?.status === 'error' && (
                        <button className="settings-btn-sm" onClick={() => reconnectServer(server.name)}>
                          ↻ Reconnect
                        </button>
                      )}
                      <button className="settings-btn-sm danger" onClick={() => removeServer(server.name)}>
                        ✕
                      </button>
                    </div>
                  </div>
                  {st && (
                    <div className="settings-server-meta">
                      <span>{st.toolCount} tools</span>
                      <span>{st.status}</span>
                      {st.lastError && <span className="settings-last-error">{st.lastError}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {adding ? (
            <div className="settings-add-form">
              <div className="settings-form-row">
                <label>Name</label>
                <input
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  placeholder="e.g. flux, kling"
                />
              </div>
              <div className="settings-form-row">
                <label>Display Name</label>
                <input
                  value={newServer.displayName}
                  onChange={(e) => setNewServer({ ...newServer, displayName: e.target.value })}
                  placeholder="e.g. FLUX.1, Kling Video"
                />
              </div>
              <div className="settings-form-row">
                <label>MCP URL</label>
                <input
                  value={newServer.url}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  placeholder="http://localhost:8080/mcp"
                />
              </div>
              <div className="settings-form-row">
                <label>Idle timeout (ms)</label>
                <input
                  type="number"
                  value={newServer.idleTimeoutMs || 0}
                  onChange={(e) => setNewServer({ ...newServer, idleTimeoutMs: parseInt(e.target.value) || 0 })}
                  placeholder="600000 (10 min, 0 = disabled)"
                />
              </div>
              <div className="settings-form-actions">
                <button className="settings-btn" onClick={addServer}>Connect</button>
                <button className="settings-btn secondary" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="settings-add-btn" onClick={() => setAdding(true)}>
              + Add MCP Server
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
