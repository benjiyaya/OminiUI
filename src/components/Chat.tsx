import { useState, useRef, useEffect, useCallback } from 'react'
import MessageBubble from './MessageBubble'

interface StoryScene {
  sceneNumber: number
  title: string
  description: string
  characters: string[]
  setting: string
  mood: string
  cameraAngle: string
  imagePrompt: string
}

interface StoryCharacter {
  name: string
  description: string
  visualNotes: string
}

interface StoryPlan {
  title: string
  synopsis: string
  style: string
  characters: StoryCharacter[]
  scenes: StoryScene[]
}

interface Props {
  sessionId: string
  messages: any[]
  onUpdateMessages: (msgs: any[]) => void
  onPersistMessage: (msg: any) => void
  onNewChat: () => void
}

const WELCOME_CHIPS = [
  'A cat astronaut floating in space',
  'A cyberpunk city at sunset, neon lights',
  'A fantasy landscape with dragons',
  'Turn this sketch into a realistic photo',
]

export default function Chat({ sessionId, messages, onUpdateMessages, onPersistMessage, onNewChat }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [error, setError] = useState('')
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [refineEnabled, setRefineEnabled] = useState(false)
  const [refining, setRefining] = useState(false)
  const [storyAgentMode, setStoryAgentMode] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<StoryPlan | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, pendingPlan])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  useEffect(() => autoResize(), [input, autoResize])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const remaining = 6 - uploadedImages.length
    if (remaining <= 0) {
      setError('Maximum 6 files allowed')
      e.target.value = ''
      return
    }
    const toAdd = files.slice(0, remaining)
    toAdd.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        setUploadedImages((prev) => {
          if (prev.length >= 6) return prev
          return [...prev, reader.result as string]
        })
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeUpload = (idx: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== idx))
  }

  const refinePromptText = async (text: string): Promise<string> => {
    setRefining(true)
    try {
      const resp = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Refine failed' }))
        console.warn('[refine]', err.error)
        return text
      }
      const data = await resp.json()
      return data.prompt || text
    } catch (err) {
      console.warn('[refine]', err)
      return text
    } finally {
      setRefining(false)
    }
  }

  const executeTool = async (
    tc: any,
    attachedImages: string[],
    currentMsgs: any[]
  ): Promise<any> => {
    const toolName = tc.function.name
    const args = JSON.parse(tc.function.arguments || '{}')

    const progressMsg = {
      role: 'assistant' as const,
      content: '',
      tool_call_id: toolName,
      toolName,
      generating: true,
      progress: { step: 0, total: 100, preview: null },
    }
    onUpdateMessages([...currentMsgs, progressMsg])

    try {
      const resp = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args, attachedImages }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Generation failed' }))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }

      const data = await resp.json()

      return {
        role: 'tool' as const,
        content: data.image
          ? `Image generated successfully.`
          : `Tool ${toolName} executed successfully.`,
        tool_call_id: toolName,
        toolName,
        image: data.image,
        imagePath: data.imagePath,
        prompt: args.prompt,
      }
    } catch (err: any) {
      return {
        role: 'tool' as const,
        content: `Error: ${err.message}`,
        tool_call_id: toolName,
        toolName,
        error: true,
      }
    }
  }

  /**
   * Approve the plan -- short confirmation only.
   * The story plan is already visible in chat. No need to repeat it.
   */
  const approvePlan = async () => {
    if (!pendingPlan) return
    const plan = pendingPlan
    setPendingPlan(null)
    setStoryAgentMode(false)

    const planMsg: any = {
      role: 'assistant',
      content: `Plan approved for "${plan.title}". Switch off Story Agent and use any scene prompt to generate images.`,
      messageType: 'story-plan-status',
      plan,
    }
    const accumulated = [...messages, planMsg]
    onUpdateMessages(accumulated)
    onPersistMessage(planMsg)
  }

  const rejectPlan = () => {
    setPendingPlan(null)
    const feedbackMsg: any = {
      role: 'assistant',
      content: 'Plan rejected. Please tell me what you want to change -- characters, scenes, style, mood, or anything else -- and I will revise the plan.',
    }
    const accumulated = [...messages, feedbackMsg]
    onUpdateMessages(accumulated)
    onPersistMessage(feedbackMsg)
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    setError('')

    let finalText = text
    if (refineEnabled) {
      finalText = await refinePromptText(text)
    }

    const userMsg: any = { role: 'user', content: finalText }
    if (uploadedImages.length > 0) {
      userMsg.images = uploadedImages.map((dataUrl) => dataUrl.split(',')[1] || dataUrl)
      console.log(`[chat] Sending ${uploadedImages.length} attached files`)
    }

    const newMessages = [...messages, userMsg]
    onUpdateMessages(newMessages)
    onPersistMessage(userMsg)
    setInput('')
    setUploadedImages([])
    setLoading(true)

    try {
      if (storyAgentMode) {
        // Story Agent mode: plan story, no image generation
        const history = newMessages.map((m) => ({
          role: m.role === 'user' ? 'human' : m.role === 'assistant' ? 'ai' : m.role,
          content: m.content || '',
        }))

        const resp = await fetch('/api/workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: finalText, history }),
        })

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Workflow failed' }))
          throw new Error(err.error || `HTTP ${resp.status}`)
        }

        const data = await resp.json()

        // Build human-readable text from the agent response
        // If a plan was parsed, strip the JSON code block and show a summary
        let displayText = data.text || 'Story agent completed.'

        if (data.plan) {
          // Remove the ```json ... ``` block from the displayed text
          displayText = displayText.replace(/```json[\s\S]*?```/g, '').trim()
        }

        const assistantMsg: any = {
          role: 'assistant',
          content: displayText || 'Story agent completed.',
        }

        if (data.plan) {
          assistantMsg.messageType = 'story-plan'
          assistantMsg.plan = data.plan
          setPendingPlan(data.plan)
        }

        onUpdateMessages([...newMessages, assistantMsg])
        onPersistMessage(assistantMsg)
      } else {
        // Normal mode: simple chat + tool calls
        const apiMessages = newMessages.map((m) => ({
          role: m.role,
          content: m.content || '',
        }))

        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages }),
        })

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Request failed' }))
          throw new Error(err.error || `HTTP ${resp.status}`)
        }

        const data = await resp.json()

        if (data.tool_calls && data.tool_calls.length > 0) {
          const assistantMsg = {
            role: 'assistant',
            content: data.content || '',
            tool_calls: data.tool_calls,
          }
          let accumulated = [...newMessages, assistantMsg]
          onUpdateMessages(accumulated)
          onPersistMessage(assistantMsg)

          const lastUserMsg = [...newMessages].reverse().find((m) => m.role === 'user')
          const attachedImages: string[] = lastUserMsg?.images || []

          for (const tc of data.tool_calls) {
            const toolResult = await executeTool(tc, attachedImages, accumulated)
            if (toolResult) {
              accumulated = [...accumulated, toolResult]
              onUpdateMessages(accumulated)
              onPersistMessage(toolResult)
            }
          }

          const followUpResp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: accumulated
                .filter((m: any) => m.role !== 'tool')
                .map((m: any) => ({
                  role: m.role,
                  content: m.content || '',
                })),
            }),
          })

          if (followUpResp.ok) {
            const followUpData = await followUpResp.json()
            if (followUpData.content) {
              const followMsg = { role: 'assistant', content: followUpData.content }
              onUpdateMessages([...accumulated, followMsg])
              onPersistMessage(followMsg)
            }
          }
        } else {
          const assistantMsg = { role: 'assistant', content: data.content || '' }
          onUpdateMessages([...newMessages, assistantMsg])
          onPersistMessage(assistantMsg)
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleChip = (text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  const downloadImage = (b64: string, name: string) => {
    const a = document.createElement('a')
    a.href = `data:image/png;base64,${b64}`
    a.download = name
    a.click()
  }

  return (
    <div className="main">
      <div className="chat-header">
        <div className="chat-header-title">OminiUI</div>
        <div className="chat-header-status">
          <span className="status-dot" />
          Ready
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="welcome">
          <div className="welcome-content">
            <div className="welcome-icon">🎨</div>
            <div className="welcome-title">What shall we create?</div>
            <div className="welcome-sub">
              Describe an image or video to generate, or upload a photo to edit.
              Add model servers in Settings to enable generation tools.
            </div>
            <div className="welcome-chips">
              {WELCOME_CHIPS.map((c) => (
                <button key={c} className="welcome-chip" onClick={() => handleChip(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="messages" ref={scrollRef}>
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              onImageClick={setLightboxSrc}
              onDownload={downloadImage}
              onAddToAttachment={(b64: string) => {
                const dataUrl = `data:image/png;base64,${b64}`
                setUploadedImages((prev) => {
                  if (prev.length >= 6) return prev
                  return [...prev, dataUrl]
                })
              }}
            />
          ))}
          {loading && (
            <div className="message">
              <div className="message-avatar assistant">✦</div>
              <div className="message-body">
                <div className="message-role">Assistant</div>
                <div className="typing-indicator">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Story Plan Approve/Reject bar */}
      {pendingPlan && (
        <div className="plan-action-bar">
          <span className="plan-action-label">Review the story plan above</span>
          <button className="btn-approve" onClick={approvePlan}>
            Approve
          </button>
          <button className="btn-reject" onClick={rejectPlan}>
            Reject
          </button>
        </div>
      )}

      <div className="input-area">
        <div className="input-wrapper">
          {uploadedImages.length > 0 && (
            <div className="upload-preview">
              {uploadedImages.map((dataUrl, i) => {
                const mime = dataUrl.split(';')[0].split(':')[1] || 'image/png'
                if (mime.startsWith('video/')) {
                  return (
                    <div key={i} className="upload-thumb">
                      <video src={dataUrl} muted />
                      <button className="upload-thumb-remove" onClick={() => removeUpload(i)}>
                        x
                      </button>
                    </div>
                  )
                }
                if (mime.startsWith('audio/')) {
                  return (
                    <div key={i} className="upload-thumb upload-thumb-audio">
                      <span className="upload-thumb-audio-icon">~</span>
                      <button className="upload-thumb-remove" onClick={() => removeUpload(i)}>
                        x
                      </button>
                    </div>
                  )
                }
                return (
                  <div key={i} className="upload-thumb">
                    <img src={dataUrl} alt="Upload" />
                    <button className="upload-thumb-remove" onClick={() => removeUpload(i)}>
                      x
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="input-tools">
            <button
              className="btn-tool"
              onClick={() => fileRef.current?.click()}
              disabled={uploadedImages.length >= 6}
              title={uploadedImages.length >= 6 ? 'Maximum 6 files' : 'Attach up to 6 files (images, audio, video)'}
            >
              + {uploadedImages.length > 0 ? `${uploadedImages.length}/6 files` : 'Attach files'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,video/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button
              className={`btn-tool ${refineEnabled ? 'active' : ''}`}
              onClick={() => setRefineEnabled(!refineEnabled)}
              title="Enhance prompt with AI before sending"
            >
              * {refining ? 'Refining...' : 'Enhance Prompt'}
            </button>
            <button
              className={`btn-tool ${storyAgentMode ? 'active' : ''}`}
              onClick={() => setStoryAgentMode(!storyAgentMode)}
              title="Story Agent mode: plan a visual story with scenes, then review and approve before generating"
            >
              @ {storyAgentMode ? 'Story Agent ON' : 'Story Agent'}
            </button>
          </div>
          <div className="input-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                storyAgentMode
                  ? 'Describe a story you want to create (characters, scenes, style)...'
                  : 'Describe an image to create, or upload a photo and describe edits...'
              }
              rows={1}
            />
            <button
              className="btn-send"
              onClick={sendMessage}
              disabled={!input.trim() || loading || refining}
              title="Send"
            >
              {'->'}
            </button>
          </div>
          <div className="input-hint">
            Press Enter to send | Shift+Enter for new line
            {refineEnabled && ' | * Prompt enhancement ON'}
            {storyAgentMode && ' | @ Story Agent ON'}
          </div>
        </div>
      </div>

      {error && <div className="error-toast" onClick={() => setError('')}>{error}</div>}

      {lightboxSrc && (
        <div className="lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="Full size" />
        </div>
      )}
    </div>
  )
}
