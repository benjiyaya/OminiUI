import type { Request, Response } from 'express'
import OpenAI from 'openai'
import { mcpClient } from './mcp-client.js'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

function getSystemPrompt(): string {
  const tools = mcpClient.getAggregatedTools()
  const statuses = mcpClient.getServerStatuses()
  const connectedServers = statuses.filter((s) => s.status === 'connected')

  if (tools.length === 0) {
    return `You are OminiUI, an AI creative assistant. No image or video generation tools are currently connected. Politely let the user know and suggest they check the MCP server settings.`
  }

  const toolList = tools
    .map((t: any) => {
      const fn = t.function
      const params = fn.parameters?.properties
        ? Object.keys(fn.parameters.properties).join(', ')
        : 'none'
      return `- ${fn.name}: ${fn.description}\n  Parameters: ${params}`
    })
    .join('\n\n')

  const serverList = connectedServers.map((s) => `${s.displayName} (${s.toolCount} tools)`).join(', ')

  return `You are OminiUI, an AI creative assistant. You help users create, edit, and generate images and videos through natural conversation.

## Connected Engines
${serverList}

## Available Tools
${toolList}

## How images work
- The user can attach up to 6 images. You do NOT need to pass image data in tool arguments — the system attaches them automatically.
- If the user attached 1 image → use an edit tool
- If the user attached 2-6 images → use a subject-driven/personalization tool
- If no images attached → use a text-to-image tool
- You should NOT ask the user to "pass" or "send" images. They are already attached.

## Guidelines
- Choose the most appropriate tool based on the user's request and available engines.
- When multiple engines support the same capability, pick the one best suited for the task.
- Always write rich, detailed prompts in English following the SCALIST framework: Subject, Composition, Action, Location, Image style, Specs, Text rendering.
- If the user writes in another language, still produce the prompt in English.
- Be conversational and helpful. Explain what you're about to create before calling a tool.
- After generation, describe what was created and offer to make adjustments.
- For text rendering in images, put the exact text in quotes and specify font, color, size, and position.`
}

function getClient(): OpenAI {
  const baseURL = process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1'
  const apiKey = process.env.LLM_API_KEY || process.env.OLLAMA_API_KEY || 'ollama'
  return new OpenAI({ baseURL, apiKey })
}

export function getModelName(): string {
  return process.env.LLM_MODEL || process.env.OLLAMA_MODEL || ''
}

export async function chatHandler(req: Request, res: Response) {
  try {
    const { messages, model: userModel } = req.body as {
      messages: ChatMessage[]
      model?: string
    }

    const model = userModel || getModelName()
    const client = getClient()
    const tools = mcpClient.getAggregatedTools()

    // Filter and sanitize messages for Ollama compatibility
    const cleanMessages: ChatMessage[] = messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        ...m,
        content: m.content || '',
      }))

    const fullMessages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      ...cleanMessages,
    ]

    const completion = await client.chat.completions.create({
      model,
      messages: fullMessages as any,
      tools: tools.length > 0 ? (tools as any) : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      temperature: 0.7,
      max_tokens: 4096,
    })

    const choice = completion.choices[0]
    const message = choice.message

    res.json({
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls || undefined,
    })
  } catch (err: any) {
    console.error('[chat]', err)
    res.status(500).json({ error: err.message || 'Chat failed' })
  }
}

export async function modelInfoHandler(_req: Request, res: Response) {
  res.json({
    model: getModelName(),
    servers: mcpClient.getServerStatuses(),
  })
}
