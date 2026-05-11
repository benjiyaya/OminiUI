import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { chatHandler, modelInfoHandler } from './chat.js'
import { executeHandler, streamHandler, generateHandler } from './generate.js'
import { runAgentWorkflow, streamAgentWorkflow } from './agent.js'
import type { StoryPlan } from './agent.js'
import { refinePrompt } from './prompt-refine.js'
import { mcpClient } from './mcp-client.js'
import { loadConfig, saveConfig, onConfigChange } from './mcp-config.js'
import { initTrackers, startIdleCheck, getTrackerStatuses } from './model-tracker.js'
import {
  createSession,
  getSessions,
  getMessages,
  saveMessage,
  renameSession,
  removeSession,
  clearSessionMessages,
} from './db.js'
import type { ServerConfig } from './mcp-config.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '100mb' }))

app.use((req, _res, next) => {
  if (req.method === 'POST') {
    const contentLength = req.headers['content-length']
    if (contentLength) {
      const mb = (parseInt(contentLength) / 1024 / 1024).toFixed(1)
      console.log(`[req] ${req.method} ${req.url} — ${mb}MB`)
    }
  }
  next()
})

const PORT = parseInt(process.env.PORT || '3001', 10)

// ── Chat & Tool Execution ─────────────────────────────────────────────
app.post('/api/chat', chatHandler)
app.post('/api/tools/execute', executeHandler)
app.get('/api/tools/stream/:jobId', streamHandler)

// ── Story Agent Workflow ────────────────────────────────────────────────
app.post('/api/workflow', async (req, res) => {
  try {
    const { message, history } = req.body as {
      message: string
      history?: { role: string; content: string }[]
    }
    if (!message) {
      res.status(400).json({ error: 'Missing message' })
      return
    }
    const result = await runAgentWorkflow(message, history || [])
    res.json({ text: result.text, plan: result.plan })
  } catch (err: any) {
    console.error('[workflow]', err)
    res.status(500).json({ error: err.message || 'Workflow failed' })
  }
})

// Streaming story plan generation
app.post('/api/workflow/stream', async (req, res) => {
  const { message, history } = req.body as {
    message: string
    history?: { role: string; content: string }[]
  }
  if (!message) {
    res.status(400).json({ error: 'Missing message' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  try {
    const stream = streamAgentWorkflow(message, history || [])
    for await (const event of stream) {
      if (event.type === 'chunk') {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: event.data })}\n\n`)
      } else if (event.type === 'plan') {
        res.write(`data: ${JSON.stringify({ type: 'plan', plan: event.data })}\n\n`)
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (err: any) {
    console.error('[workflow/stream]', err)
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
    res.end()
  }
})

// Approve a story plan and execute scene generation
app.post('/api/workflow/approve', async (req, res) => {
  try {
    const { plan } = req.body as { plan: StoryPlan }
    if (!plan || !plan.scenes || plan.scenes.length === 0) {
      res.status(400).json({ error: 'Invalid or empty story plan' })
      return
    }

    // Return the approved plan — the frontend will drive scene-by-scene
    // generation via the normal /api/chat + /api/tools/execute pipeline.
    // This endpoint validates and acknowledges the plan.
    res.json({
      ok: true,
      sceneCount: plan.scenes.length,
      characterCount: plan.characters?.length || 0,
      scenes: plan.scenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        title: s.title,
        imagePrompt: s.imagePrompt,
      })),
    })
  } catch (err: any) {
    console.error('[workflow/approve]', err)
    res.status(500).json({ error: err.message || 'Approval failed' })
  }
})

// Backward-compatible generate endpoint
app.post('/api/generate', generateHandler)
app.get('/api/generate/stream/:jobId', streamHandler)

// ── Model Info ────────────────────────────────────────────────────────
app.get('/api/model', modelInfoHandler)
app.get('/api/model/status', (_req, res) => {
  const mcpStatuses = mcpClient.getServerStatuses()
  const trackerStatuses = getTrackerStatuses()
  res.json({ servers: mcpStatuses, trackers: trackerStatuses })
})

// ── MCP Server Management ─────────────────────────────────────────────
app.get('/api/mcp-servers', (_req, res) => {
  const config = loadConfig()
  const statuses = mcpClient.getServerStatuses()
  res.json({ servers: config.servers, status: statuses })
})

app.post('/api/mcp-servers', async (req, res) => {
  try {
    const serverConfig = req.body as ServerConfig
    if (!serverConfig.name || !serverConfig.url || !serverConfig.displayName) {
      res.status(400).json({ error: 'Missing required fields: name, displayName, url' })
      return
    }

    // Validate name format
    if (!/^[a-zA-Z0-9_-]+$/.test(serverConfig.name)) {
      res.status(400).json({ error: 'Name must be alphanumeric (hyphens and underscores allowed)' })
      return
    }

    const config = loadConfig()
    const existing = config.servers.findIndex((s) => s.name === serverConfig.name)
    if (existing >= 0) {
      res.status(409).json({ error: `Server "${serverConfig.name}" already exists. Use PUT to update.` })
      return
    }

    config.servers.push({ ...serverConfig, enabled: serverConfig.enabled !== false })
    saveConfig(config)

    // Connect to the new server
    await mcpClient.addServer(serverConfig)

    // Update trackers if idle timeout configured
    if (serverConfig.idleTimeoutMs) {
      initTrackers(config.servers)
    }

    const status = mcpClient.getServerStatus(serverConfig.name)
    res.json({ ok: true, status })
  } catch (err: any) {
    console.error('[mcp-servers] Add error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/mcp-servers/:name', async (req, res) => {
  try {
    const { name } = req.params
    const updates = req.body as Partial<ServerConfig>

    const config = loadConfig()
    const idx = config.servers.findIndex((s) => s.name === name)
    if (idx < 0) {
      res.status(404).json({ error: `Server "${name}" not found` })
      return
    }

    const oldConfig = config.servers[idx]
    const newConfig: ServerConfig = {
      ...oldConfig,
      ...updates,
      name, // name is immutable
    }
    config.servers[idx] = newConfig
    saveConfig(config)

    // Reconnect if URL changed
    if (updates.url && updates.url !== oldConfig.url) {
      await mcpClient.removeServer(name)
      await mcpClient.addServer(newConfig)
    } else if (updates.enabled === false) {
      await mcpClient.removeServer(name)
    } else if (updates.enabled === true && oldConfig.enabled === false) {
      await mcpClient.addServer(newConfig)
    }

    initTrackers(config.servers)
    const status = mcpClient.getServerStatus(name)
    res.json({ ok: true, status })
  } catch (err: any) {
    console.error('[mcp-servers] Update error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/mcp-servers/:name', async (req, res) => {
  try {
    const { name } = req.params
    const config = loadConfig()
    config.servers = config.servers.filter((s) => s.name !== name)
    saveConfig(config)

    await mcpClient.removeServer(name)
    initTrackers(config.servers)
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[mcp-servers] Delete error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/mcp-servers/:name/reconnect', async (req, res) => {
  try {
    const { name } = req.params
    await mcpClient.reconnectServer(name)
    const status = mcpClient.getServerStatus(name)
    res.json({ ok: true, status })
  } catch (err: any) {
    console.error('[mcp-servers] Reconnect error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/mcp-servers/:name/tools', (req, res) => {
  const { name } = req.params
  const conn = mcpClient.getServerConnection(name)
  if (!conn) {
    res.status(404).json({ error: `Server "${name}" not found` })
    return
  }
  const tools = mcpClient.getAggregatedTools().filter((t: any) => {
    const mapping = mcpClient.getToolMapping(t.function.name)
    return mapping?.serverName === name
  })
  res.json({ tools, status: conn.status })
})

// ── Prompt Refinement ─────────────────────────────────────────────────
app.post('/api/refine', async (req, res) => {
  try {
    const { prompt } = req.body
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Missing prompt' })
      return
    }
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const apiKey = process.env.OPENAI_API_KEY || ''
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    if (!apiKey) {
      res.status(400).json({ error: 'OPENAI_API_KEY not configured in .env' })
      return
    }
    const result = await refinePrompt(prompt, baseUrl, apiKey, model)
    res.json(result)
  } catch (err: any) {
    console.error('[refine]', err)
    res.status(500).json({ error: err.message || 'Refine failed' })
  }
})

// ── Session CRUD ──────────────────────────────────────────────────────
app.get('/api/sessions', (_req, res) => {
  res.json(getSessions())
})

app.post('/api/sessions', (req, res) => {
  const { id, title } = req.body
  createSession(id, title || 'New conversation')
  res.json({ ok: true })
})

app.put('/api/sessions/:id', (req, res) => {
  const { title } = req.body
  renameSession(req.params.id, title)
  res.json({ ok: true })
})

app.delete('/api/sessions/:id', (req, res) => {
  removeSession(req.params.id)
  res.json({ ok: true })
})

// ── Message CRUD ──────────────────────────────────────────────────────
app.get('/api/sessions/:id/messages', (req, res) => {
  res.json(getMessages(req.params.id))
})

app.post('/api/sessions/:id/messages', (req, res) => {
  saveMessage(req.params.id, req.body)
  res.json({ ok: true })
})

app.delete('/api/sessions/:id/messages', (req, res) => {
  clearSessionMessages(req.params.id)
  res.json({ ok: true })
})

// ── Startup ───────────────────────────────────────────────────────────
async function start() {
  const config = loadConfig()

  // Fire MCP connections in background — don't block server startup
  // Servers that aren't running yet will auto-retry with exponential backoff
  console.log(`[startup] Starting MCP connections for ${config.servers.length} server(s)...`)
  mcpClient.connectAll(config.servers).catch(() => {})
  mcpClient.startHealthCheck()

  // Initialize model trackers
  initTrackers(config.servers)
  startIdleCheck()

  // Watch for config changes
  onConfigChange((newConfig) => {
    initTrackers(newConfig.servers)
  })

  app.listen(PORT, () => {
    console.log(`[OminiUI server] listening on http://localhost:${PORT}`)
    console.log(`[startup] MCP servers will connect in background — check Settings for status`)
  })
}

start().catch((err) => {
  console.error('[startup] Fatal error:', err)
  process.exit(1)
})
