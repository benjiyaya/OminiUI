import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'

export interface ServerConfig {
  name: string
  displayName: string
  url: string
  enabled: boolean
  idleTimeoutMs?: number
}

export interface McpConfig {
  servers: ServerConfig[]
}

const CONFIG_PATH = process.env.MCP_CONFIG_PATH || path.resolve('mcp-servers.json')

const events = new EventEmitter()

function defaultConfig(): McpConfig {
  return { servers: [] }
}

function validate(config: any): config is McpConfig {
  if (!config || typeof config !== 'object') return false
  if (!Array.isArray(config.servers)) return false
  for (const s of config.servers) {
    if (typeof s.name !== 'string' || !s.name) return false
    if (typeof s.displayName !== 'string' || !s.displayName) return false
    if (typeof s.url !== 'string' || !s.url) return false
    if (typeof s.enabled !== 'boolean') s.enabled = true
  }
  return true
}

export function loadConfig(): McpConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      const config = JSON.parse(raw)
      if (validate(config)) return config
      console.warn('[mcp-config] Invalid config file, using defaults')
    }
  } catch (err: any) {
    console.warn('[mcp-config] Failed to load config:', err.message)
  }
  const config = defaultConfig()
  saveConfig(config)
  return config
}

export function saveConfig(config: McpConfig): void {
  const tmp = CONFIG_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  fs.renameSync(tmp, CONFIG_PATH)
  events.emit('change', config)
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function onConfigChange(listener: (config: McpConfig) => void): void {
  events.on('change', listener)
}
