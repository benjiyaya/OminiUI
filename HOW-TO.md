# OminiUI — How-To Guide

A complete guide to installing, configuring, and using OminiUI with its MCP plugin architecture, DeepAgents workflow mode, and multiple image/video model support.

---

## Table of Contents

1. [What is OminiUI](#what-is-ominiui)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Starting the App](#starting-the-app)
6. [Using the App](#using-the-app)
7. [MCP Plugin System](#mcp-plugin-system)
8. [Writing Your Own MCP Model Server](#writing-your-own-mcp-model-server)
9. [DeepAgents Workflow Mode](#deepagents-workflow-mode)
11. [Configuration Reference](#configuration-reference)
12. [API Reference](#api-reference)
13. [Troubleshooting](#troubleshooting)
14. [Project Structure](#project-structure)

---

## What is OminiUI

OminiUI is a modular AI creative studio. It connects to any number of image and video generation models through the **MCP (Model Context Protocol)** plugin system. Each model runs as an independent MCP server — adding a new model means spinning up a new MCP service and registering it, no code changes needed.

The chat is powered by an LLM (Ollama by default, configurable to any OpenAI-compatible endpoint) that decides which tool to call based on your request.

**Core features:**
- Text-to-image, image editing, subject-driven personalization
- Multiple model support via MCP plugins
- Workflow mode for multi-step creative projects (stories, character references, scene composition)
- Prompt enhancement via OpenAI-compatible API
- Real-time generation progress with SSE streaming
- Auto-save, chat history, multi-session

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | For the Express server and React frontend |
| LLM API key | — | Any OpenAI-compatible API (OpenAI, Groq, Together, Ollama, etc.) |

---

## Installation

### 1. Clone and install

```bash
git clone https://github.com/benjiyaya/HiDream-O1-Image-OminiUI.git
cd HiDream-O1-Image-OminiUI
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Set your LLM. Works with any OpenAI-compatible API:

```bash
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-key
LLM_MODEL=gpt-4o

# Groq (fast, free tier available)
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile

# Ollama (local, free)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3:8b

# Together, Fireworks, LM Studio, vLLM — same pattern
```

### 3. Start

```bash
npm run dev
```

Open http://localhost:5173. The app works immediately for text chat. To enable image/video generation, add an MCP server via the Settings panel (gear icon in the sidebar).

---

## Configuration

All settings are in `.env` at the project root.

### LLM (any OpenAI-compatible API)

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_BASE_URL` | API endpoint | `http://localhost:11434/v1` |
| `LLM_API_KEY` | API key | `ollama` |
| `LLM_MODEL` | Model name | — (required) |

Falls back to `OLLAMA_*` env vars if `LLM_*` not set.

### Prompt Enhancement (optional, separate from chat LLM)

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | Any OpenAI-compatible endpoint |
| `OPENAI_API_KEY` | API key |
| `OPENAI_MODEL` | Model name |

Leave empty to disable.

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Express backend port | `3001` |
| `RESULTS_DIR` | Directory to save generated images | `results` |

### MCP Servers

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_CONFIG_PATH` | Path to `mcp-servers.json` | `./mcp-servers.json` |

---

## Starting the App

### Full stack (recommended)

```bash
npm run dev
```

Runs both Vite frontend and Express backend concurrently.

### Individual services

```bash
# Frontend only (hot reload)
npm run dev:client

# Backend only (auto-restart on changes)
npm run dev:server
```

### Production build

```bash
npm run build
npm run preview
```

---

## Using the App

### Generate an image

Type a description in the chat:

```
A photorealistic cat wearing an astronaut helmet, floating in deep space
with Earth visible in the background. Cinematic lighting, 50mm lens.
```

The LLM automatically calls the appropriate image generation tool.

### Edit an image

1. Click **Attach images** and upload a source photo
2. Describe the edits:

```
Make this photo look like an oil painting in the style of Van Gogh
```

The LLM calls `edit_image` with your attached image.

### Subject-driven generation

1. Attach 2-6 reference images
2. Describe the output:

```
Generate a new portrait of this person in a cyberpunk city, neon lighting
```

The LLM calls `subject_driven_image` with your references.

### Prompt Enhancement

Click **Enhance Prompt** in the input toolbar. When enabled, your prompt is sent to an OpenAI-compatible API that rewrites it following the SCALIST framework (Subject, Composition, Action, Location, Image style, Specs, Text rendering).

Requires `OPENAI_API_KEY` in `.env`.

### Workflow Mode

Click the **Workflow** button (robot icon) to enable agent workflow mode. In this mode, the DeepAgents SDK takes over for complex multi-step creative tasks:

- Story planning with scene breakdowns
- Character reference generation
- Background and environment creation
- Scene composition with references
- Video generation from image references

See [DeepAgents Workflow Mode](#deepagents-workflow-mode) for details.

---

## MCP Plugin System

OminiUI uses MCP (Model Context Protocol) to discover and communicate with image/video model servers. Each model runs as an independent MCP server using streamable HTTP transport.

### How it works

1. On startup, OminiUI reads `mcp-servers.json` and connects to each enabled server
2. Each server exposes tools via MCP's `tools/list` endpoint
3. Tools are namespaced as `{serverName}_{toolName}` (e.g., `hidream_create_image`)
4. The LLM receives all discovered tools and picks the right one
5. Tool calls are routed to the correct MCP server
6. Results (images, videos) flow back through the MCP protocol

**Note:** MCP server adapters live in their respective model projects (e.g., HiDream's adapter is in the HiDream repo), not in OminiUI. This project is the MCP client only.

### Managing MCP servers

#### Via the UI

1. Open the **Settings** panel (gear icon in the sidebar footer)
2. Click **+ Add MCP Server**
3. Fill in:
   - **Name**: Short identifier (alphanumeric, used as tool prefix) — e.g., `flux`
   - **Display Name**: Human-readable name — e.g., `FLUX.1`
   - **MCP URL**: Server endpoint — e.g., `http://localhost:8081/mcp`
   - **Idle timeout**: Auto-unload timeout in ms (0 = disabled)
4. Click **Connect**

The server appears in the list with a status indicator:
- Green = connected
- Yellow = connecting
- Red = error (click Reconnect)
- Gray = disconnected

#### Via config file

Edit `mcp-servers.json`:

```json
{
  "servers": [
    {
      "name": "hidream",
      "displayName": "HiDream-O1-Image",
      "url": "http://localhost:8080/mcp",
      "enabled": true,
      "idleTimeoutMs": 600000
    },
    {
      "name": "flux",
      "displayName": "FLUX.1",
      "url": "http://localhost:8081/mcp",
      "enabled": true
    }
  ]
}
```

Restart the app after editing the config file, or use the Settings UI for live changes.

#### Via API

```bash
# List servers
curl http://localhost:3001/api/mcp-servers

# Add a server
curl -X POST http://localhost:3001/api/mcp-servers \
  -H 'Content-Type: application/json' \
  -d '{"name":"flux","displayName":"FLUX.1","url":"http://localhost:8081/mcp","enabled":true}'

# Reconnect a server
curl -X POST http://localhost:3001/api/mcp-servers/flux/reconnect

# Remove a server
curl -X DELETE http://localhost:3001/api/mcp-servers/flux

# List tools for a server
curl http://localhost:3001/api/mcp-servers/hidream/tools
```

### Config fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Short unique ID, used as tool namespace prefix. Alphanumeric, hyphens, underscores. |
| `displayName` | string | Yes | Human-readable name shown in the UI |
| `url` | string | Yes | MCP server endpoint URL (streamable HTTP) |
| `enabled` | boolean | No | Whether to connect on startup (default: `true`) |
| `idleTimeoutMs` | number | No | Auto-unload timeout in ms. Only for servers that support load/unload. |

---

## Writing Your Own MCP Model Server

Any image or video generation pipeline can be exposed as an MCP server. Here's how.

### Python (using `mcp` package)

```bash
pip install mcp uvicorn starlette
```

Minimal example:

```python
import json
import httpx
from mcp.server import Server
from mcp.server.streamable_http import StreamableHTTPServerTransport
from mcp.types import Tool, TextContent, ImageContent, CallToolResult
from starlette.applications import Starlette
from starlette.routing import Route

server = Server("my-image-model")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="generate_image",
            description="Generate an image from a text prompt",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "Image description"},
                    "width": {"type": "number", "description": "Width in pixels"},
                    "height": {"type": "number", "description": "Height in pixels"},
                },
                "required": ["prompt"],
            },
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "generate_image":
        # Call your model's inference API here
        # image_base64 = your_model.generate(arguments["prompt"])
        # return CallToolResult(
        #     content=[ImageContent(type="image", data=image_base64, mimeType="image/png")]
        # )
        pass

# ASGI app
transport = StreamableHTTPServerTransport(mcp_session_id=None)

async def handle_mcp(scope, receive, send):
    await transport.handle_request(scope, receive, send)

app = Starlette(routes=[Route("/mcp", endpoint=handle_mcp, methods=["GET", "POST", "DELETE"])])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
```

### Node.js (using `@modelcontextprotocol/sdk`)

```bash
npm install @modelcontextprotocol/sdk
```

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "my-image-model", version: "1.0.0" });

server.tool("generate_image", "Generate an image from a text prompt", {
  prompt: { type: "string", description: "Image description" },
}, async ({ prompt }) => {
  // Call your model's inference API here
  // const imageBase64 = await myModel.generate(prompt);
  return { content: [{ type: "image", data: imageBase64, mimeType: "image/png" }] };
});

// Set up streamable HTTP transport on your HTTP server
```

### Requirements for MCP servers

1. **Streamable HTTP transport** at the `/mcp` path (or custom path)
2. **`tools/list`** — return tool definitions with JSON Schema input
3. **`tools/call`** — execute tools and return results
4. **Image results** — return as `ImageContent` with base64 data
5. **Progress notifications** — optional, for long-running generations

### Tool naming convention

The MCP server's tool names become `{serverName}_{toolName}` in OminiUI. For example, if your server exposes `generate_image` and you name it `flux`, the LLM sees `flux_generate_image`.

---

## DeepAgents Workflow Mode

OminiUI integrates [DeepAgents](https://www.npmjs.com/package/deepagents) (by LangChain) for complex multi-step creative workflows. This mode is designed for tasks that require planning, multiple generations, and iterative refinement.

### When to use workflow mode

- **Story illustration**: Plan scenes, generate character references, then compose each scene
- **Character design**: Create reference sheets with multiple angles, then generate scenes
- **Scene composition**: Generate backgrounds, characters, and props separately, then composite
- **Video production**: Generate keyframes/image references, then use for video generation

### How it works

1. Enable **Workflow** mode (robot icon in the input toolbar)
2. Describe your project in natural language
3. The DeepAgent:
   - Plans the work using `write_todos` (task breakdown)
   - Generates character reference images
   - Generates background/location images
   - Composes final scenes using references
   - Tracks progress across steps
4. Results are returned in the chat

### Example: Story illustration

```
Enable Workflow, then type:

Create a short illustrated story about a fox who finds a magical forest.
Plan 3 scenes, generate character references for the fox first,
then generate each scene with consistent character appearance.
```

The agent will:
1. Break the story into 3 scenes
2. Generate a fox character reference image
3. Generate Scene 1 with the fox reference
4. Generate Scene 2 with the fox reference
5. Generate Scene 3 with the fox reference

### Architecture

```
User message
     │
     ▼
DeepAgent (LangGraph)
     │
     ├── write_todos (task planning)
     ├── read_file / write_file (working memory)
     ├── task (sub-agent delegation)
     │
     └── MCP tools (image/video generation)
          │
          ├── hidream_create_image
          ├── hidream_edit_image
          ├── flux_create_image
          └── ... (any registered MCP tools)
```

---

## Configuration Reference

### `.env` — all options

```bash
# ── LLM (any OpenAI-compatible API) ──
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-your-key
LLM_MODEL=gpt-4o

# ── Prompt Enhancement (optional) ──
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=

# ── Results directory ──
RESULTS_DIR=results

# ── MCP Servers Config ──
MCP_CONFIG_PATH=./mcp-servers.json

# ── Server ──
PORT=3001
```

### `mcp-servers.json` — MCP server registry

```json
{
  "servers": [
    {
      "name": "hidream",
      "displayName": "HiDream-O1-Image",
      "url": "http://localhost:8080/mcp",
      "enabled": true,
      "idleTimeoutMs": 600000
    }
  ]
}
```

---

## API Reference

### Chat & Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send messages to LLM with tool definitions |
| `POST` | `/api/tools/execute` | Execute a tool via MCP client |
| `GET` | `/api/tools/stream/:jobId` | SSE progress stream for tool execution |
| `POST` | `/api/workflow` | Run a DeepAgent workflow |
| `POST` | `/api/refine` | Enhance a prompt via OpenAI-compatible API |
| `POST` | `/api/generate` | Direct generation (backward-compatible alias) |

### MCP Server Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/mcp-servers` | List all servers with status |
| `POST` | `/api/mcp-servers` | Add a new server |
| `PUT` | `/api/mcp-servers/:name` | Update server config |
| `DELETE` | `/api/mcp-servers/:name` | Remove a server |
| `POST` | `/api/mcp-servers/:name/reconnect` | Force reconnect |
| `GET` | `/api/mcp-servers/:name/tools` | List tools for a server |

### Model Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/model` | LLM model name + MCP server statuses |
| `GET` | `/api/model/status` | MCP server statuses + idle tracker info |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create a session |
| `PUT` | `/api/sessions/:id` | Rename a session |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `GET` | `/api/sessions/:id/messages` | Get messages for a session |
| `POST` | `/api/sessions/:id/messages` | Save a message |
| `DELETE` | `/api/sessions/:id/messages` | Clear all messages in a session |

---

## Troubleshooting

### Common issues

| Problem | Solution |
|---------|----------|
| LLM connection refused | Check `LLM_BASE_URL` and `LLM_API_KEY` in `.env` |
| Model not found | Verify `LLM_MODEL` matches your API provider |
| HiDream API not reachable | Start the Flask server on port 7860 |
| Generation hangs | Check the MCP server / Flask terminal for GPU errors |
| Prompt enhancement fails | Set `OPENAI_API_KEY` in `.env` |
| MCP server shows red status | Click Reconnect in Settings, or check the server is running |
| No tools available | No MCP servers connected — add one in Settings |

### Checking MCP server status

```bash
# Via API
curl http://localhost:3001/api/mcp-servers | python -m json.tool

# Via the UI
# Click the gear icon in the sidebar footer
```

### Logs

The Express server logs to stdout. Look for:
- `[startup]` — MCP server connections on boot
- `[mcp-client]` — tool discovery and server status
- `[generate]` — tool execution requests
- `[chat]` — LLM communication
- `[workflow]` — DeepAgent execution

---

## Project Structure

```
OminiUI/
├── .env.example                  # Environment config template
├── .env                          # Your local config (not committed)
├── mcp-servers.json              # MCP server registry
├── app.py                        # Patched HiDream Flask API
├── package.json                  # Node.js dependencies
├── index.html                    # Vite entry point
├── vite.config.ts                # Vite dev server + API proxy
├── tsconfig.json                 # TypeScript config (frontend)
├── tsconfig.node.json            # TypeScript config (server)
│
├── server/                       # Express backend (TypeScript)
│   ├── index.ts                  # Entry point, all routes
│   ├── chat.ts                   # Chat handler (LLM + dynamic tools)
│   ├── generate.ts               # Generic tool execution router
│   ├── agent.ts                  # DeepAgents workflow integration
│   ├── mcp-client.ts             # MCP client manager
│   ├── mcp-config.ts             # Config file management
│   ├── model-tracker.ts          # Multi-server idle tracking
│   ├── prompt-refine.ts          # Prompt enhancement
│   └── db.ts                     # SQLite database layer
│
├── src/                          # React frontend (TypeScript)
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root component, session management
│   ├── index.css                 # Global dark-theme styles
│   └── components/
│       ├── Chat.tsx              # Chat UI + tool execution + workflow toggle
│       ├── MessageBubble.tsx     # Message rendering (text, tools, images)
│       ├── Sidebar.tsx           # Session list + model info + settings
│       └── Settings.tsx          # MCP server management UI
│
└── data/
    └── ominiui.db                # SQLite database (auto-created)
```
