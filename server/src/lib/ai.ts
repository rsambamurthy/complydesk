/**
 * One way to ask Claude for structured output: a forced tool call. Used by document reading, the help assistant and
 * meeting drafting. ANTHROPIC_API_KEY switches it on; EXTRACT_DRIVER=mock makes callers use their fixtures instead.
 */
export const aiMode = (): 'claude' | 'mock' | null => (process.env.EXTRACT_DRIVER === 'mock' ? 'mock' : process.env.ANTHROPIC_API_KEY ? 'claude' : null);
export const defaultModel = () => process.env.EXTRACT_MODEL || 'claude-sonnet-5-5';

export interface ToolCall {
  model?: string;
  /** System prompt blocks; `cache: true` marks a long, unchanging block (e.g. a manual) for prompt caching. */
  system: { text: string; cache?: boolean }[];
  messages: { role: 'user' | 'assistant'; content: any }[];
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number; timeoutMs?: number;
}
export interface ToolResult<T> { input: T; model: string; inputTokens?: number; outputTokens?: number }

export async function callTool<T = Record<string, any>>(c: ToolCall): Promise<ToolResult<T>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: c.timeoutMs ?? 120_000, maxRetries: 2 });
  const model = c.model ?? defaultModel();
  const msg = await client.messages.create({
    model, max_tokens: c.maxTokens ?? 4000,
    system: c.system.map((b) => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) })) as any,
    tools: [c.tool as any],
    tool_choice: { type: 'tool', name: c.tool.name },
    messages: c.messages as any,
  });
  const tool = msg.content.find((x: any) => x.type === 'tool_use') as any;
  if (!tool) throw new Error('No answer from the model');
  return { input: tool.input as T, model, inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens };
}
