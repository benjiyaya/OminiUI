import type { Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { mcpClient } from './mcp-client.js'

const RESULTS_DIR = path.resolve(process.env.RESULTS_DIR || path.join('results'))
fs.mkdirSync(RESULTS_DIR, { recursive: true })

// In-memory job store for SSE streaming
const jobs = new Map<string, EventEmitter>()

function timestampFilename(ext = 'png'): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8)
  return `img_${ts}_${rand}.${ext}`
}

function saveImageToResults(base64Data: string, mimeType = 'image/png'): string {
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png'
  const filename = timestampFilename(ext)
  const filepath = path.join(RESULTS_DIR, filename)
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'))
  console.log(`[generate] Saved -> ${filepath}`)
  return filepath
}

/**
 * Copy a local file into the results directory and return the path.
 * Handles ComfyUI-style outputs that write to a local output folder.
 */
function copyFileToResults(sourcePath: string): string | null {
  try {
    if (!fs.existsSync(sourcePath)) {
      console.warn(`[generate] Source file not found: ${sourcePath}`)
      return null
    }

    const ext = path.extname(sourcePath).replace('.', '') || 'png'
    const filename = timestampFilename(ext)
    const destPath = path.join(RESULTS_DIR, filename)
    fs.copyFileSync(sourcePath, destPath)
    console.log(`[generate] Copied -> ${destPath}`)
    return destPath
  } catch (err: any) {
    console.warn(`[generate] Failed to copy file: ${err.message}`)
    return null
  }
}

/**
 * Fetch an image from a URL (asset_url from ComfyUI MCP etc.)
 * and save it to the results directory. Returns the local path.
 */
async function downloadUrlToResults(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn(`[generate] Failed to fetch ${url}: HTTP ${resp.status}`)
      return null
    }

    const contentType = resp.headers.get('content-type') || 'image/png'
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
      : contentType.includes('webp') ? 'webp'
      : contentType.includes('gif') ? 'gif'
      : 'png'
    const filename = timestampFilename(ext)
    const filepath = path.join(RESULTS_DIR, filename)

    const buffer = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(filepath, buffer)
    console.log(`[generate] Downloaded -> ${filepath} (${(buffer.length / 1024).toFixed(1)}KB)`)
    return filepath
  } catch (err: any) {
    console.warn(`[generate] Failed to download ${url}: ${err.message}`)
    return null
  }
}

interface ToolExecuteParams {
  toolName: string
  args: Record<string, unknown>
  attachedImages?: string[]
}

/**
 * Generic tool execution through MCP client.
 * Handles multiple MCP server return formats:
 *
 * 1. MCP standard: content block with type="image" + base64 data
 * 2. Custom base64: text block with JSON { image: "base64..." }
 * 3. ComfyUI-style: text block with JSON { asset_url: "http://..." } or { asset_url: "/path/to/file.png" }
 * 4. ComfyUI inline preview: text block with JSON { inline_preview_base64: "base64..." }
 * 5. Local file path: text block with a file path ending in image extension
 */
export async function executeToolCall(
  params: ToolExecuteParams
): Promise<{ image?: string; imagePath?: string; result: any }> {
  const { toolName, args, attachedImages } = params
  const mapping = mcpClient.getToolMapping(toolName)
  if (!mapping) {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  // Inject attached images into args if the tool expects them
  const finalArgs = { ...args }
  if (attachedImages && attachedImages.length > 0) {
    const schema = mapping.inputSchema as any
    const props = schema?.properties || {}
    if (props.image && attachedImages.length >= 1) {
      finalArgs.image = attachedImages[0]
    }
    if (props.images && attachedImages.length >= 1) {
      finalArgs.images = attachedImages
    }
    if (props.refs_b64 && attachedImages.length >= 1) {
      finalArgs.refs_b64 = attachedImages
    }
    if (props.ref_images && attachedImages.length >= 1) {
      finalArgs.ref_images = attachedImages
    }
  }

  console.log(`[generate] Executing ${toolName} on ${mapping.displayName}`)

  const mcpResult = await mcpClient.callTool(toolName, finalArgs)

  let image: string | undefined
  let imagePath: string | undefined

  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    for (const block of mcpResult.content) {
      // ── Format 1: MCP standard image block (type="image", base64 data) ──
      if (block.type === 'image' && block.data) {
        image = block.data
        imagePath = saveImageToResults(block.data, block.mimeType || 'image/png')
        break
      }

      if (block.type === 'text' && block.text) {
        // Try parsing as JSON for formats 2-4
        try {
          const parsed = JSON.parse(block.text)

          // ── Format 2: Custom base64 in JSON ──
          if (parsed.image) {
            image = parsed.image
            imagePath = saveImageToResults(parsed.image)
            break
          }

          // ── Format 3: ComfyUI asset_url ──
          if (parsed.asset_url) {
            const assetUrl: string = parsed.asset_url

            // Check if it's a local file path (not a URL)
            if (assetUrl.startsWith('/') || assetUrl.match(/^[A-Za-z]:\\/)) {
              const localPath = copyFileToResults(assetUrl)
              if (localPath) {
                imagePath = localPath
                // Read the copied file back as base64 for the frontend
                image = fs.readFileSync(localPath).toString('base64')
                break
              }
            }

            // It's an HTTP URL — download it
            const localPath = await downloadUrlToResults(assetUrl)
            if (localPath) {
              imagePath = localPath
              image = fs.readFileSync(localPath).toString('base64')
              break
            }
          }

          // ── Format 4: ComfyUI inline preview ──
          if (parsed.inline_preview_base64) {
            image = parsed.inline_preview_base64
            imagePath = saveImageToResults(parsed.inline_preview_base64)
            break
          }

          // ── Format: Multiple assets array ──
          if (Array.isArray(parsed.assets) && parsed.assets.length > 0) {
            const firstAsset = parsed.assets[0]
            if (firstAsset.asset_url) {
              const assetUrl: string = firstAsset.asset_url
              if (assetUrl.startsWith('/') || assetUrl.match(/^[A-Za-z]:\\/)) {
                const localPath = copyFileToResults(assetUrl)
                if (localPath) {
                  imagePath = localPath
                  image = fs.readFileSync(localPath).toString('base64')
                  break
                }
              } else {
                const localPath = await downloadUrlToResults(assetUrl)
                if (localPath) {
                  imagePath = localPath
                  image = fs.readFileSync(localPath).toString('base64')
                  break
                }
              }
            }
            if (firstAsset.image || firstAsset.base64) {
              image = firstAsset.image || firstAsset.base64
              imagePath = saveImageToResults(image)
              break
            }
          }
        } catch {
          // Not JSON — check for bare file path (format 5)
          const text = block.text.trim()
          if (isImageFilePath(text)) {
            const localPath = copyFileToResults(text)
            if (localPath) {
              imagePath = localPath
              image = fs.readFileSync(localPath).toString('base64')
              break
            }
          }
        }

        // ── Format 5: Bare file path in text block ──
        const text = block.text.trim()
        if (!image && isImageFilePath(text)) {
          const localPath = copyFileToResults(text)
          if (localPath) {
            imagePath = localPath
            image = fs.readFileSync(localPath).toString('base64')
            break
          }
        }
      }
    }
  }

  return { image, imagePath, result: mcpResult }
}

/**
 * Check if a string looks like a path to an image file.
 */
function isImageFilePath(text: string): boolean {
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']
  const lower = text.toLowerCase()
  return imageExts.some((ext) => lower.endsWith(ext)) &&
    (text.startsWith('/') || text.match(/^[A-Za-z]:\\/) || text.startsWith('.\\') || text.startsWith('./'))
}

// SSE streaming endpoint for progress
export async function streamHandler(req: Request, res: Response) {
  const { jobId } = req.params
  const emitter = jobs.get(jobId)
  if (!emitter) {
    res.status(404).json({ error: 'Unknown job' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const onProgress = (data: any) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`)
  }
  const onDone = (result: any) => {
    res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`)
    res.end()
  }
  const onError = (msg: string) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`)
    res.end()
  }

  emitter.on('progress', onProgress)
  emitter.on('done', onDone)
  emitter.on('error', onError)

  req.on('close', () => {
    emitter.off('progress', onProgress)
    emitter.off('done', onDone)
    emitter.off('error', onError)
  })
}

// Direct execution endpoint (returns final result)
export async function executeHandler(req: Request, res: Response) {
  const params = req.body as ToolExecuteParams
  const jobId = uuid()
  const emitter = new EventEmitter()
  jobs.set(jobId, emitter)

  try {
    const result = await executeToolCall(params)
    emitter.emit('done', result)
    jobs.delete(jobId)
    res.json({ jobId, ...result })
  } catch (err: any) {
    console.error('[generate] Error:', err.message)
    jobs.delete(jobId)
    res.status(500).json({ error: err.message || 'Generation failed' })
  }
}

// Backward-compatible /api/generate endpoint
export async function generateHandler(req: Request, res: Response) {
  const params = req.body as any
  const { mode, prompt, refs_b64, width, height, seed, keep_original_aspect } = params

  // Map old format to new tool call
  let toolName = 'hidream_create_image'
  if (mode === 'edit') toolName = 'hidream_edit_image'
  if (mode === 'subject') toolName = 'hidream_subject_driven_image'

  const args: Record<string, unknown> = { prompt, width, height, seed }
  if (keep_original_aspect !== undefined) args.keep_original_aspect = keep_original_aspect

  try {
    const result = await executeToolCall({ toolName, args, attachedImages: refs_b64 })
    res.json({ image: result.image, imagePath: result.imagePath })
  } catch (err: any) {
    console.error('[generate] Error:', err.message)
    res.status(500).json({ error: err.message || 'Generation failed' })
  }
}

export { jobs }
