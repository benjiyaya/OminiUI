import { mcpClient } from './mcp-client.js'
import type { ServerConfig } from './mcp-config.js'

interface TrackerState {
  serverName: string
  lastActivity: number
  loaded: boolean
  idleTimeoutMs: number
}

const trackers = new Map<string, TrackerState>()
let idleTimer: ReturnType<typeof setInterval> | null = null

export function initTrackers(configs: ServerConfig[]): void {
  trackers.clear()
  for (const config of configs) {
    if (config.idleTimeoutMs && config.idleTimeoutMs > 0) {
      trackers.set(config.name, {
        serverName: config.name,
        lastActivity: Date.now(),
        loaded: true,
        idleTimeoutMs: config.idleTimeoutMs,
      })
    }
  }
}

export async function touchActivity(serverName: string): Promise<void> {
  const tracker = trackers.get(serverName)
  if (!tracker) return

  tracker.lastActivity = Date.now()

  if (!tracker.loaded) {
    await reloadServer(serverName)
  }
}

export function getTrackerStatuses(): Record<string, any> {
  const statuses: Record<string, any> = {}
  for (const [name, tracker] of trackers) {
    statuses[name] = {
      loaded: tracker.loaded,
      lastActivity: tracker.lastActivity,
      idleMs: Date.now() - tracker.lastActivity,
      idleTimeoutMs: tracker.idleTimeoutMs,
    }
  }
  return statuses
}

async function unloadServer(serverName: string): Promise<void> {
  const tracker = trackers.get(serverName)
  if (!tracker || !tracker.loaded) return

  const conn = mcpClient.getServerConnection(serverName)
  if (!conn) return

  console.log(`[model-tracker] Unloading ${serverName} after idle timeout...`)
  try {
    // Try calling a standard unload tool if the server exposes one
    const hasUnloadTool = conn.tools.some(
      (t: any) => t.name === 'unload' || t.name === 'model_unload'
    )
    if (hasUnloadTool) {
      const toolName = conn.tools.find((t: any) => t.name === 'unload' || t.name === 'model_unload')?.name
      await mcpClient.callTool(`${serverName}_${toolName}`, {})
    }
    tracker.loaded = false
    console.log(`[model-tracker] ${serverName} unloaded`)
  } catch (err: any) {
    console.error(`[model-tracker] Failed to unload ${serverName}: ${err.message}`)
  }
}

async function reloadServer(serverName: string): Promise<void> {
  const tracker = trackers.get(serverName)
  if (!tracker || tracker.loaded) return

  const conn = mcpClient.getServerConnection(serverName)
  if (!conn) return

  console.log(`[model-tracker] Reloading ${serverName}...`)
  try {
    const hasReloadTool = conn.tools.some(
      (t: any) => t.name === 'reload' || t.name === 'model_reload'
    )
    if (hasReloadTool) {
      const toolName = conn.tools.find((t: any) => t.name === 'reload' || t.name === 'model_reload')?.name
      await mcpClient.callTool(`${serverName}_${toolName}`, {})
    }
    tracker.loaded = true
    console.log(`[model-tracker] ${serverName} reloaded`)
  } catch (err: any) {
    console.error(`[model-tracker] Failed to reload ${serverName}: ${err.message}`)
    throw err
  }
}

export function startIdleCheck(): void {
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [name, tracker] of trackers) {
      if (tracker.loaded && now - tracker.lastActivity >= tracker.idleTimeoutMs) {
        unloadServer(name)
      }
    }
  }, 60_000)
  console.log('[model-tracker] Idle check started')
}

export function stopIdleCheck(): void {
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}
