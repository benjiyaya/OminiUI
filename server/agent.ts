import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

// ── Singleton model instance ──────────────────────────────────────────
let _model: ChatOpenAI | null = null

function getModel(): ChatOpenAI {
  if (_model) return _model
  const baseURL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1'
  const apiKey = process.env.LLM_API_KEY || 'ollama'
  const model = process.env.LLM_MODEL || 'qwen3:8b'
  _model = new ChatOpenAI({
    modelName: model,
    configuration: { baseURL },
    apiKey,
    temperature: 0.7,
    maxTokens: 4096,
  })
  return _model
}

// ── Conversation window ───────────────────────────────────────────────
const MAX_HISTORY_MESSAGES = 20

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

export interface StoryPlan {
  title: string
  synopsis: string
  style: string
  characters: StoryCharacter[]
  scenes: StoryScene[]
}

function windowMessages(
  history: { role: string; content: string }[],
  maxMessages: number = MAX_HISTORY_MESSAGES,
): { role: 'human' | 'ai' | 'system'; content: string }[] {
  if (history.length <= maxMessages) {
    return history.map((m) => ({
      role: m.role as 'human' | 'ai',
      content: m.content,
    }))
  }

  // Keep the most recent messages, drop the oldest
  const kept = history.slice(-maxMessages)
  const droppedCount = history.length - maxMessages

  const summaryPrefix = {
    role: 'system' as const,
    content: `[Context: ${droppedCount} earlier message(s) omitted for memory. Continue the story planning based on the recent conversation below.]`,
  }

  return [
    summaryPrefix,
    ...kept.map((m) => ({
      role: m.role as 'human' | 'ai',
      content: m.content,
    })),
  ]
}

// ── System prompt ─────────────────────────────────────────────────────
const STORY_PLANNER_PROMPT = `You are OminiUI Story Agent, an expert story planner and visual storytelling consultant.

## Your Role
You help users plan visual stories that will later be turned into images. You do NOT generate images yourself — you create detailed story plans for human review.

## CRITICAL: Output Format
When the user asks you to plan a story, you MUST output a JSON plan in a code block. Follow these rules EXACTLY:

1. Output the JSON inside a code block that starts with \`\`\`json on its own line and ends with \`\`\` on its own line
2. The JSON MUST be valid and properly formatted with newlines and indentation
3. Do NOT put everything on one line
4. After the JSON code block, you may add a brief conversational explanation

Example response format:

Here is your story plan:

\`\`\`json
{
  "title": "Story title",
  "synopsis": "2-3 sentence story summary",
  "style": "Overall visual style description",
  "characters": [
    {
      "name": "Character name",
      "description": "Who they are, their role",
      "visualNotes": "Detailed appearance: hair, skin, clothing, build, distinguishing features"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "Scene title",
      "description": "What happens in this scene",
      "characters": ["Character names present"],
      "setting": "Location and time of day",
      "mood": "Emotional tone",
      "cameraAngle": "Suggested camera angle",
      "imagePrompt": "Rich detailed prompt for image generation"
    }
  ]
}
\`\`\`

Brief explanation of your creative choices here.

## Guidelines
- Always write image prompts in English, even if the user writes in another language
- Make image prompts detailed and vivid: describe lighting, colors, composition, and mood
- Keep character visual descriptions consistent across all scenes
- Suggest 3-8 scenes for a complete story arc
- Each scene's imagePrompt should be self-contained (include character descriptions, setting, style)
- If the user provides feedback, revise the plan and output the updated JSON
- After the user approves, tell them to click "Approve Plan" to start generating`

/**
 * Attempt to repair common JSON mistakes made by LLMs:
 * - Missing opening braces in array objects: `}, "name":` -> `}, { "name":`
 * - Trailing commas before `]` or `}`
 * - Missing commas between properties
 */
function repairJson(str: string): string {
  // Fix missing opening brace in array elements:
  // Matches `}` or `]` followed by whitespace, then a property name without `{`
  // e.g. `}, "name":` -> `}, { "name":`
  let repaired = str.replace(
    /(\}|[a-zA-Z0-9"'])\s*,\s*("name"|"title"|"description"|"visualNotes"|"setting"|"mood"|"cameraAngle"|"imagePrompt"|"sceneNumber"|"characters"|"style"|"synopsis"|"scenes")\s*:/g,
    (match, before, prop) => {
      // If the before char is already `{` or `,` we don't need to add
      if (before === '{' || before === ',') return match
      return `${before}, { ${prop}:`
    }
  )

  // Fix trailing commas before closing brackets
  repaired = repaired.replace(/,\s*([}\]])/g, '$1')

  return repaired
}

/**
 * Parse a story plan JSON from the agent's response text.
 * Handles multiple formats:
 * 1. ```json\n{...}\n``` (properly formatted)
 * 2. ```json { ... } ``` (inline, no newlines)
 * 3. Bare JSON object in text
 * Includes repair for common LLM JSON mistakes.
 */
function parseStoryPlan(text: string): StoryPlan | null {
  // Strategy 1: Proper code block with newlines
  let jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/)

  // Strategy 2: Inline code block (everything on one line or mixed)
  if (!jsonMatch) {
    jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
  }

  const tryParse = (raw: string): StoryPlan | null => {
    const trimmed = raw.trim()
    // First try direct parse
    try {
      const plan = JSON.parse(trimmed)
      if (plan.title && plan.scenes && Array.isArray(plan.scenes)) {
        return plan as StoryPlan
      }
    } catch {}
    // Try repairing and parsing
    try {
      const repaired = repairJson(trimmed)
      const plan = JSON.parse(repaired)
      if (plan.title && plan.scenes && Array.isArray(plan.scenes)) {
        console.log('[agent] JSON repaired successfully')
        return plan as StoryPlan
      }
    } catch (e) {
      console.warn('[agent] JSON parse failed even after repair:', (e as Error).message)
    }
    return null
  }

  if (jsonMatch) {
    const result = tryParse(jsonMatch[1])
    if (result) return result
  }

  // Strategy 3: Look for a bare JSON object with the expected structure
  const bareMatch = text.match(/\{[\s\S]*?"title"\s*:\s*"[^"]*"[\s\S]*?"scenes"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/)
  if (bareMatch) {
    const result = tryParse(bareMatch[0])
    if (result) return result
  }

  return null
}

/**
 * Run the story planner agent. Returns the raw text response and
 * a parsed StoryPlan if the agent output valid JSON.
 */
export async function runAgentWorkflow(
  userMessage: string,
  conversationHistory: { role: string; content: string }[] = [],
): Promise<{ text: string; plan: StoryPlan | null }> {
  const model = getModel()
  const windowedHistory = windowMessages(conversationHistory)

  const messages = [
    new SystemMessage(STORY_PLANNER_PROMPT),
    ...windowedHistory.map((m) => {
      if (m.role === 'human') return new HumanMessage(m.content)
      if (m.role === 'ai') return new AIMessage(m.content)
      return new SystemMessage(m.content)
    }),
    new HumanMessage(userMessage),
  ]

  const response = await model.invoke(messages)
  const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

  const plan = parseStoryPlan(text)

  return { text, plan }
}

/**
 * Stream the story planner agent response.
 * Yields text chunks as they arrive, then yields a final parsed plan if available.
 */
export async function* streamAgentWorkflow(
  userMessage: string,
  conversationHistory: { role: string; content: string }[] = [],
): AsyncGenerator<{ type: 'chunk' | 'plan'; data: string | StoryPlan }> {
  const model = getModel()
  const windowedHistory = windowMessages(conversationHistory)

  const messages = [
    new SystemMessage(STORY_PLANNER_PROMPT),
    ...windowedHistory.map((m) => {
      if (m.role === 'human') return new HumanMessage(m.content)
      if (m.role === 'ai') return new AIMessage(m.content)
      return new SystemMessage(m.content)
    }),
    new HumanMessage(userMessage),
  ]

  let fullText = ''

  const stream = await model.stream(messages)
  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string' ? chunk.content : ''
    if (text) {
      fullText += text
      yield { type: 'chunk', data: text }
    }
  }

  const plan = parseStoryPlan(fullText)
  if (plan) {
    yield { type: 'plan', data: plan }
  }
}

/**
 * Re-export StoryPlan types for consumers.
 */
export type { StoryScene, StoryCharacter }
