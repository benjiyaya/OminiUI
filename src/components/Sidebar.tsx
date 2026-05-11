import { useState, useEffect } from 'react'
import type { ChatSession } from '../App'

interface McpServerStatus {
  name: string
  displayName: string
  status: 'connected' | 'connecting' | 'error' | 'disconnected'
  toolCount: number
}

interface Props {
  sessions: ChatSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  modelName: string
  onOpenSettings: () => void
}

const STATUS_COLORS: Record<string, string> = {
  connected: '#22c55e',
  connecting: '#f59e0b',
  error: '#ef4444',
  disconnected: '#6b7280',
}

export default function Sidebar({ sessions, activeId, onSelect, onNew, onDelete, modelName, onOpenSettings }: Props) {
  const [serverStatuses, setServerStatuses] = useState<McpServerStatus[]>([])

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const resp = await fetch('/api/mcp-servers')
        const data = await resp.json()
        setServerStatuses(data.status || [])
      } catch {}
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">🎨</div>
            <div>
              <div className="brand-text">OminiUI</div>
              <div className="brand-sub">AI Image Studio</div>
            </div>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="btn-new-chat" onClick={onNew}>
            <span>+</span> New conversation
          </button>
        </div>

        <div className="chat-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`chat-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
            >
              <span className="chat-item-icon">💬</span>
              <span className="chat-item-title">{s.title}</span>
              <button
                className="chat-item-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(s.id)
                }}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="settings-row">
            <span className="settings-label">LLM</span>
            <span className="settings-value">
              {modelName || 'Ollama'}
            </span>
          </div>
          {serverStatuses.length > 0 && (
            <div className="settings-row">
              <span className="settings-label">Engines</span>
              <div className="settings-engine-list">
                {serverStatuses.map((s) => (
                  <span key={s.name} className="settings-engine-tag">
                    <span
                      className="settings-status-dot"
                      style={{ background: STATUS_COLORS[s.status] }}
                    />
                    {s.displayName}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button className="settings-gear-btn" onClick={onOpenSettings}>
            ⚙ Settings
          </button>
        </div>
      </div>
    </>
  )
}
