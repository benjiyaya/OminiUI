import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { EventEmitter } from 'events'
import type { ServerConfig } from './mcp-config.js'

export interface ToolMapping {
  namespacedName: string
  serverName: string
  originalName: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerStatus {
  name: string
  displayName: string
  url: string
  status: 'connected' | 'connecting' | 'error' | 'disconnected' | 'retrying'
  toolCount: number
  lastError?: string
  enabled: boolean
}

interface McpServerConnection {
  client: Client
  config: ServerConfig
  tools: any[]
  status: McpServerStatus['status']
  lastError?: string
  retryCount: number
  retryTimer?: ReturnType<typeof setTimeout>
}

class McpClientManagerImpl extends EventEmitter {
  private servers = new Map<string, McpServerConnection>()
  private toolRegistry = new Map<string, ToolMapping>()
  private healthTimer: ReturnType<typeof setInterval> | null = null

  async connectAll(configs: ServerConfig[]): Promise<void> {
    const enabled = configs.filter((c) => c.enabled)
    // Fire all connections in parallel — don't block startup on failures
    for (const config of enabled) {
      this.connectServer(config).catch(() => {})
    }
  }

  async connectServer(config: ServerConfig): Promise<void> {
    const existing = this.servers.get(config.name)
    if (existing) {
      // Don't retry if already connecting
      if (existing.status === 'connecting' || existing.status === 'retrying') return
      await this.disconnectServer(config.name)
    }

    const client = new Client(
      { name: 'ominiui', version: '1.0.0' },
      { capabilities: {} }
    )

    const conn: McpServerConnection = {
      client,
      config,
      tools: [],
      status: 'connecting',
      retryCount: 0,
    }
    this.servers.set(config.name, conn)
    this.emit('status', config.name, 'connecting')

    try {
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        reconnectionOptions: {
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 30000,
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 0,
        },
      })
      await client.connect(transport)

      const { tools } = await client.listTools()
      conn.tools = tools
      conn.status = 'connected'
      conn.lastError = undefined
      conn.retryCount = 0

      // Register tools in the namespace
      this.registerTools(config, tools)

      console.log(`[mcp-client] Connected to ${config.displayName} (${tools.length} tools)`)
      this.emit('status', config.name, 'connected')
      this.emit('tools-changed')
    } catch (err: any) {
      conn.status = 'error'
      conn.lastError = err.message
      console.warn(`[mcp-client] Failed to connect to ${config.displayName}: ${err.message} — will retry`)
      this.emit('status', config.name, 'error', err.message)
      this.scheduleRetry(conn)
    }
  }

  private registerTools(config: ServerConfig, tools: any[]): void {
    // Clear old tools for this server first
    for (const [key, mapping] of this.toolRegistry) {
      if (mapping.serverName === config.name) {
        this.toolRegistry.delete(key)
      }
    }

    for (const tool of tools) {
      const namespacedName = `${config.name}_${tool.name}`
      this.toolRegistry.set(namespacedName, {
        namespacedName,
        serverName: config.name,
        originalName: tool.name,
        displayName: config.displayName,
        description: tool.description || '',
        inputSchema: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
      })
    }
  }

  private scheduleRetry(conn: McpServerConnection): void {
    if (conn.retryTimer) clearTimeout(conn.retryTimer)
    if (conn.retryCount >= 10) {
      console.warn(`[mcp-client] Giving up retrying ${conn.config.displayName} after ${conn.retryCount} attempts`)
      return
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
    const delay = Math.min(2000 * Math.pow(2, conn.retryCount), 30000)
    conn.retryCount++
    conn.status = 'retrying'

    console.log(`[mcp-client] Will retry ${conn.config.displayName} in ${delay / 1000}s (attempt ${conn.retryCount})`)
    this.emit('status', conn.config.name, 'retrying')

    conn.retryTimer = setTimeout(() => {
      console.log(`[mcp-client] Retrying connection to ${conn.config.displayName}...`)
      this.connectServer(conn.config).catch(() => {})
    }, delay)
  }

  async disconnectServer(name: string): Promise<void> {
    const conn = this.servers.get(name)
    if (!conn) return

    // Cancel pending retry
    if (conn.retryTimer) {
      clearTimeout(conn.retryTimer)
      conn.retryTimer = undefined
    }

    // Remove tools from registry
    for (const [key, mapping] of this.toolRegistry) {
      if (mapping.serverName === name) {
        this.toolRegistry.delete(key)
      }
    }

    try {
      await conn.client.close()
    } catch {}

    conn.status = 'disconnected'
    this.servers.delete(name)
    this.emit('status', name, 'disconnected')
    this.emit('tools-changed')
  }

  async reconnectServer(name: string): Promise<void> {
    const conn = this.servers.get(name)
    if (conn) {
      conn.retryCount = 0
      await this.connectServer(conn.config)
    }
  }

  async addServer(config: ServerConfig): Promise<void> {
    await this.connectServer(config)
  }

  async removeServer(name: string): Promise<void> {
    await this.disconnectServer(name)
  }

  getAggregatedTools(): any[] {
    const tools: any[] = []
    for (const mapping of this.toolRegistry.values()) {
      tools.push({
        type: 'function' as const,
        function: {
          name: mapping.namespacedName,
          description: `${mapping.description} (Powered by ${mapping.displayName})`,
          parameters: mapping.inputSchema,
        },
      })
    }
    return tools
  }

  getToolMapping(namespacedName: string): ToolMapping | undefined {
    return this.toolRegistry.get(namespacedName)
  }

  /**
   * Ensure the server for a tool is connected before calling.
   * Attempts lazy connection if the server is offline.
   */
  private async ensureConnected(serverName: string): Promise<McpServerConnection> {
    let conn = this.servers.get(serverName)

    if (conn?.status === 'connected') return conn

    // Server not known or not connected — try to connect
    const config = conn?.config
    if (!config) {
      throw new Error(`Unknown server: ${serverName}`)
    }

    console.log(`[mcp-client] Lazy-connecting to ${config.displayName}...`)
    await this.connectServer(config)

    conn = this.servers.get(serverName)
    if (!conn || conn.status !== 'connected') {
      throw new Error(`Server ${config.displayName} is not available (last error: ${conn?.lastError || 'unknown'})`)
    }

    return conn
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const mapping = this.toolRegistry.get(namespacedName)
    if (!mapping) {
      // Tool not in registry — server might not be connected yet
      // Try lazy connection
      const serverName = namespacedName.split('_')[0]
      try {
        await this.ensureConnected(serverName)
      } catch (err: any) {
        throw new Error(`Unknown tool: ${namespacedName} (${err.message})`)
      }

      // Re-check after connection attempt
      const mappingAfter = this.toolRegistry.get(namespacedName)
      if (!mappingAfter) {
        throw new Error(`Tool ${namespacedName} not available — server may not expose this tool`)
      }
    }

    const finalMapping = this.toolRegistry.get(namespacedName)!
    let conn = await this.ensureConnected(finalMapping.serverName)

    try {
      const result = await conn.client.callTool(
        { name: finalMapping.originalName, arguments: args },
        undefined,
        { timeout: 600000 }
      )
      return result
    } catch (err: any) {
      // On timeout, ping to check connection, reconnect if needed, retry once
      if (err.code === -32001 || err.message?.includes('timed out')) {
        console.log(`[mcp-client] Tool call timed out for ${conn.config.displayName}, reconnecting...`)
        try {
          await conn.client.ping()
        } catch {
          // Connection dead — reconnect
          await this.connectServer(conn.config)
          conn = await this.ensureConnected(finalMapping.serverName)
        }
        // Retry once
        return await conn.client.callTool(
          { name: finalMapping.originalName, arguments: args },
          undefined,
          { timeout: 600000 }
        )
      }
      throw err
    }
  }

  getServerStatuses(): McpServerStatus[] {
    const statuses: McpServerStatus[] = []
    for (const [name, conn] of this.servers) {
      statuses.push({
        name,
        displayName: conn.config.displayName,
        url: conn.config.url,
        status: conn.status,
        toolCount: conn.tools.length,
        lastError: conn.lastError,
        enabled: conn.config.enabled,
      })
    }
    return statuses
  }

  getServerStatus(name: string): McpServerStatus | undefined {
    const conn = this.servers.get(name)
    if (!conn) return undefined
    return {
      name,
      displayName: conn.config.displayName,
      url: conn.config.url,
      status: conn.status,
      toolCount: conn.tools.length,
      lastError: conn.lastError,
      enabled: conn.config.enabled,
    }
  }

  getServerConnection(name: string): McpServerConnection | undefined {
    return this.servers.get(name)
  }

  startHealthCheck(intervalMs = 60000): void {
    this.healthTimer = setInterval(async () => {
      for (const [name, conn] of this.servers) {
        if (conn.status === 'connected') {
          try {
            await conn.client.ping()
          } catch (err: any) {
            console.warn(`[mcp-client] Health check failed for ${conn.config.displayName}: ${err.message}`)
            conn.status = 'error'
            conn.lastError = `Health check failed: ${err.message}`
            this.emit('status', name, 'error', conn.lastError)
            this.scheduleRetry(conn)
          }
        }
      }
    }, intervalMs)
  }

  stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  async destroy(): Promise<void> {
    this.stopHealthCheck()
    const names = Array.from(this.servers.keys())
    await Promise.allSettled(names.map((n) => this.disconnectServer(n)))
  }
}

export const mcpClient = new McpClientManagerImpl()
