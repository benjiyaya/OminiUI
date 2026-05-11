interface Props {
  msg: any
  onImageClick: (src: string) => void
  onDownload: (b64: string, name: string) => void
  onAddToAttachment?: (b64: string) => void
}

function getToolIcon(toolName: string): string {
  if (toolName.includes('video')) return '🎬'
  if (toolName.includes('create') || toolName.includes('generate')) return '🎨'
  if (toolName.includes('edit')) return '✏️'
  if (toolName.includes('subject')) return '👤'
  return '🔧'
}

function getToolLabel(toolName: string): string {
  // Extract server name prefix for display
  const parts = toolName.split('_')
  if (parts.length > 1) {
    const serverName = parts[0]
    const action = parts.slice(1).join(' ')
    return `${serverName} · ${action.replace(/_/g, ' ')}`
  }
  return toolName.replace(/_/g, ' ')
}

function getProgressLabel(toolName: string): string {
  if (toolName.includes('video')) return 'Generating video'
  if (toolName.includes('edit')) return 'Editing image'
  if (toolName.includes('subject')) return 'Generating with references'
  return 'Generating image'
}

function getDownloadFilename(toolName: string): string {
  const serverName = toolName.split('_')[0] || 'output'
  const ext = toolName.includes('video') ? 'mp4' : 'png'
  return `${serverName}_${Date.now()}.${ext}`
}

export default function MessageBubble({ msg, onImageClick, onDownload, onAddToAttachment }: Props) {
  const isUser = msg.role === 'user'
  const isTool = msg.role === 'tool'
  const isAssistant = msg.role === 'assistant'
  const isStoryPlan = msg.messageType === 'story-plan'

  return (
    <div className="message">
      <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? 'U' : isStoryPlan ? 'S' : '✦'}
      </div>
      <div className="message-body">
        <div className="message-role">
          {isUser ? 'You' : isTool ? getToolLabel(msg.toolName || 'Tool') : isStoryPlan ? 'Story Agent' : 'Assistant'}
        </div>

        {/* User-attached images */}
        {isUser && msg.images && msg.images.length > 0 && (
          <div className="user-attached-images">
            {msg.images.map((b64: string, i: number) => (
              <div key={i} className="user-attached-thumb" onClick={() => onImageClick(`data:image/png;base64,${b64}`)}>
                <img src={`data:image/png;base64,${b64}`} alt={`Attached ${i + 1}`} />
              </div>
            ))}
          </div>
        )}

        {/* Story plan inline card */}
        {isStoryPlan && msg.plan && (
          <div className="story-plan-inline">
            <div className="story-plan-inline-title">{msg.plan.title}</div>
            <div className="story-plan-inline-synopsis">{msg.plan.synopsis}</div>
            <div className="story-plan-inline-stats">
              {msg.plan.scenes?.length || 0} scenes | {msg.plan.characters?.length || 0} characters
              {msg.plan.style && ` | Style: ${msg.plan.style}`}
            </div>
            {msg.plan.characters?.length > 0 && (
              <div className="story-plan-chars-detail">
                {msg.plan.characters.map((ch: any, i: number) => (
                  <div key={i} className="story-plan-char-detail">
                    <span className="story-plan-char-name">{ch.name}</span>
                    <span className="story-plan-char-desc">{ch.description}</span>
                    <span className="story-plan-char-visual">{ch.visualNotes}</span>
                  </div>
                ))}
              </div>
            )}
            {msg.plan.scenes?.length > 0 && (
              <div className="story-plan-scenes-detail">
                {msg.plan.scenes.map((sc: any, i: number) => (
                  <div key={i} className="story-plan-scene-detail">
                    <div className="story-plan-scene-header">
                      Scene {sc.sceneNumber}: {sc.title}
                    </div>
                    <div className="story-plan-scene-desc">{sc.description}</div>
                    <div className="story-plan-scene-meta">
                      {sc.setting && <span>Setting: {sc.setting}</span>}
                      {sc.mood && <span>Mood: {sc.mood}</span>}
                      {sc.cameraAngle && <span>Camera: {sc.cameraAngle}</span>}
                    </div>
                    {sc.characters?.length > 0 && (
                      <div className="story-plan-scene-chars">
                        {sc.characters.map((c: string, ci: number) => (
                          <span key={ci} className="story-plan-char-tag">{c}</span>
                        ))}
                      </div>
                    )}
                    {sc.imagePrompt && (
                      <div className="story-plan-scene-prompt">
                        <div className="story-plan-prompt-label">Image Prompt</div>
                        <div className="story-plan-prompt-text">{sc.imagePrompt}</div>
                        <button
                          className="story-plan-copy-btn"
                          onClick={() => navigator.clipboard.writeText(sc.imagePrompt)}
                        >
                          Copy prompt
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Text content */}
        {msg.content && (
          <div className="message-content">
            <p>{msg.content}</p>
          </div>
        )}

        {/* Tool call cards */}
        {msg.tool_calls?.map((tc: any, i: number) => {
          const args = JSON.parse(tc.function.arguments || '{}')
          return (
            <div key={i} className="tool-call-card">
              <div className="tool-call-header">
                <span className="tool-call-icon">
                  {getToolIcon(tc.function.name)}
                </span>
                <span className="tool-call-name">{getToolLabel(tc.function.name)}</span>
                <span className="tool-call-status">
                  <span className="status-dot" style={{ background: 'var(--accent)' }} />
                  calling
                </span>
              </div>
              <div className="tool-call-body">
                {args.prompt && (
                  <div className="tool-call-param">
                    <div className="tool-call-param-label">Prompt</div>
                    <div className="tool-call-param-value">{args.prompt}</div>
                  </div>
                )}
                {args.width && args.height && (
                  <div className="tool-call-param">
                    <div className="tool-call-param-label">Size</div>
                    <div className="tool-call-param-value">
                      {args.width} × {args.height}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Generation progress */}
        {msg.generating && (
          <div className="progress-container">
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${Math.round(((msg.progress?.step || 0) / (msg.progress?.total || 1)) * 100)}%`,
                }}
              />
            </div>
            <div className="progress-info">
              <span>{getProgressLabel(msg.toolName || '')}</span>
              <span>
                Step {msg.progress?.step || 0} / {msg.progress?.total || '?'}
              </span>
            </div>
            {msg.progress?.preview && (
              <div className="progress-preview">
                <img
                  src={`data:image/jpeg;base64,${msg.progress.preview}`}
                  alt="Preview"
                />
              </div>
            )}
          </div>
        )}

        {/* Generated/edited image or video */}
        {msg.image && (
          <div className="generated-image-container">
            <img
              className="generated-image"
              src={`data:image/png;base64,${msg.image}`}
              alt={msg.prompt || 'Generated image'}
              onClick={() => onImageClick(`data:image/png;base64,${msg.image}`)}
            />
            <div className="image-actions">
              <button
                className="btn-image-action"
                onClick={() => onDownload(msg.image, getDownloadFilename(msg.toolName || 'output'))}
              >
                ⬇ Download
              </button>
              <button
                className="btn-image-action"
                onClick={() => onImageClick(`data:image/png;base64,${msg.image}`)}
              >
                🔍 Full size
              </button>
              {onAddToAttachment && (
                <button
                  className="btn-image-action"
                  onClick={() => onAddToAttachment(msg.image)}
                >
                  📎 Add to attachment
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error indicator */}
        {msg.error && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: 'rgba(220, 38, 38, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.2)',
              borderRadius: 'var(--radius-xs)',
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {msg.content}
          </div>
        )}
      </div>
    </div>
  )
}
