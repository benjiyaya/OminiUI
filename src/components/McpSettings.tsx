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

interface ToolInfo {
  type: string
  function: {
    name: string
    description: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

interface Props {
  onBack: () => void
}

const STATUS_COLORS: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  error: '#ef4444',
  disconnected: '#6b7280',
}

export default function McpSettings({ onBack }: Props) {
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [tools, setTools] = useState<Record<string, ToolInfo[]>>({})
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({})

  const fetchServers = async () => {
    try {
      const resp = await fetch('/api/mcp-servers')
      const data = await resp.json()
      setServers(data.servers || [])
      setStatuses(data.status || [])
    } catch {}
  }

  useEffect(() => {
    fetchServers()
    const interval = setInterval(fetchServers, 3000)
    return () => clearInterval(interval)
  }, [])

  const fetchTools = async (serverName: string) => {
    setLoadingTools((prev) => ({ ...prev, [serverName]: true }))
    try {
      const resp = await fetch(`/api/mcp-servers/${serverName}/tools`)
      const data = await resp.json()
      setTools((prev) => ({ ...prev, [serverName]: data.tools || [] }))
    } catch {
      setTools((prev) => ({ ...prev, [serverName]: [] }))
    } finally {
      setLoadingTools((prev) => ({ ...prev, [serverName]: false }))
    }
  }

  const toggleExpand = (serverName: string) => {
    const next = !expanded[serverName]
    setExpanded((prev) => ({ ...prev, [serverName]: next }))
    if (next && !tools[serverName]) {
      fetchTools(serverName)
    }
  }

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

  return (
    <div className="mcp-page">
      <div className="mcp-page-header">
        <button className="mcp-back-btn" onClick={onBack}>
          ← Back
        </button>
        <h2>MCP Servers</h2>
      </div>

      <div className="mcp-page-body">
        {error && <div className="mcp-error">{error}</div>}

        <div className="mcp-server-list">
          {servers.map((server) => {
            const st = statuses.find((s) => s.name === server.name)
            const isExpanded = !!expanded[server.name]
            const serverTools = tools[server.name] || []
            const isLoading = !!loadingTools[server.name]

            return (
              <div key={server.name} className={`mcp-server-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="mcp-server-header" onClick={() => toggleExpand(server.name)}>
                  <div className="mcp-server-info">
                    <span
                      className="mcp-status-dot"
                      style={{ background: STATUS_COLORS[st?.status || 'disconnected'] }}
                    />
                    <div>
                      <div className="mcp-server-name">{server.displayName}</div>
                      <div className="mcp-server-url">{server.url}</div>
                    </div>
                  </div>
                  <div className="mcp-server-right">
                    <div className="mcp-server-meta">
                      <span>{st?.toolCount || 0} tools</span>
                      <span className={`mcp-status-badge ${st?.status || 'disconnected'}`}>
                        {st?.status || 'unknown'}
                      </span>
                    </div>
                    <div className="mcp-server-actions" onClick={(e) => e.stopPropagation()}>
                      <label className="mcp-toggle">
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(e) => toggleServer(server.name, e.target.checked)}
                        />
                        <span className="mcp-toggle-slider" />
                      </label>
                      {st?.status === 'error' && (
                        <button className="mcp-btn-sm" onClick={() => reconnectServer(server.name)}>
                          ↻
                        </button>
                      )}
                      <button className="mcp-btn-sm danger" onClick={() => removeServer(server.name)}>
                        ✕
                      </button>
                    </div>
                    <span className={`mcp-chevron ${isExpanded ? 'open' : ''}`}>›</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mcp-server-panel">
                    {st?.lastError && (
                      <div className="mcp-panel-error">{st.lastError}</div>
                    )}
                    {isLoading ? (
                      <div className="mcp-panel-loading">Loading tools...</div>
                    ) : serverTools.length === 0 ? (
                      <div className="mcp-panel-empty">No tools available</div>
                    ) : (
                      <div className="mcp-tool-list">
                        {serverTools.map((tool) => {
                          const params = tool.function.parameters?.properties || {}
                          const required = tool.function.parameters?.required || []
                          const paramKeys = Object.keys(params)

                          return (
                            <div key={tool.function.name} className="mcp-tool-item">
                              <div className="mcp-tool-name">{tool.function.name}</div>
                              <div className="mcp-tool-desc">{tool.function.description}</div>
                              {paramKeys.length > 0 && (
                                <div className="mcp-tool-params">
                                  {paramKeys.map((key) => (
                                    <div key={key} className="mcp-tool-param">
                                      <span className="mcp-tool-param-name">
                                        {key}{required.includes(key) && <span className="mcp-required">*</span>}
                                      </span>
                                      <span className="mcp-tool-param-type">{params[key].type || 'any'}</span>
                                      {params[key].description && (
                                        <span className="mcp-tool-param-desc">{params[key].description}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {adding ? (
          <div className="mcp-add-form">
            <div className="mcp-form-row">
              <label>Name</label>
              <input
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                placeholder="e.g. flux, kling"
              />
            </div>
            <div className="mcp-form-row">
              <label>Display Name</label>
              <input
                value={newServer.displayName}
                onChange={(e) => setNewServer({ ...newServer, displayName: e.target.value })}
                placeholder="e.g. FLUX.1, Kling Video"
              />
            </div>
            <div className="mcp-form-row">
              <label>MCP URL</label>
              <input
                value={newServer.url}
                onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                placeholder="http://localhost:8080/mcp"
              />
            </div>
            <div className="mcp-form-row">
              <label>Idle timeout (ms)</label>
              <input
                type="number"
                value={newServer.idleTimeoutMs || 0}
                onChange={(e) => setNewServer({ ...newServer, idleTimeoutMs: parseInt(e.target.value) || 0 })}
                placeholder="600000 (10 min, 0 = disabled)"
              />
            </div>
            <div className="mcp-form-actions">
              <button className="mcp-btn" onClick={addServer}>Connect</button>
              <button className="mcp-btn secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="mcp-add-btn" onClick={() => setAdding(true)}>
            + Add MCP Server
          </button>
        )}
      </div>
    </div>
  )
}
