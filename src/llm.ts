// Provider abstraction — supports OpenAI (default) and Anthropic.
// Set CORTEX_PROVIDER=anthropic to use Anthropic; defaults to openai.
import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';

export type ModelTier = 'fast' | 'capable';
export type Provider = 'openai' | 'anthropic';

export function getProvider(): Provider {
  return process.env.CORTEX_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
}

// Resolves the model ID for a given tier based on the active provider.
// OpenAI:    fast=gpt-4o-mini, capable=gpt-4o
// Anthropic: fast=claude-haiku-4-5-20251001, capable=claude-opus-4-6
export function resolveModel(tier: ModelTier): string {
  if (getProvider() === 'openai') {
    return tier === 'fast'
      ? (process.env.CORTEX_FAST_MODEL ?? 'gpt-4o-mini')
      : (process.env.CORTEX_CAPABLE_MODEL ?? 'gpt-4o');
  }
  return tier === 'fast'
    ? (process.env.CORTEX_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001')
    : (process.env.CORTEX_OPUS_MODEL ?? 'claude-opus-4-6');
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Anthropic-style tool definition (matches what the MCP client returns).
// Converted to OpenAI function format internally when provider=openai.
export interface LLMTool {
  name: string;
  description: string | undefined;
  input_schema: Record<string, unknown>;
}

export interface StreamParams {
  model: string;
  maxTokens: number;
  messages: LLMMessage[];
  tools?: LLMTool[];
  // When tools are provided, callTool wires up the execution loop so the LLM
  // can actually invoke MCP tools and receive results before producing output.
  callTool?: (name: string, input: unknown) => Promise<unknown>;
}

// Streams a chat completion, executing any tool calls the model makes before
// returning the final text. Calls onChunk for each text token as it arrives.
// Returns the full concatenated text when the stream is complete.
// Throws if no response arrives within CORTEX_LLM_TIMEOUT_MS (default: 5 min).
export async function streamChat(
  params: StreamParams,
  onChunk: (text: string) => void,
): Promise<string> {
  const timeoutMs = Number(process.env.CORTEX_LLM_TIMEOUT_MS ?? 300_000);
  const provider = getProvider() === 'openai'
    ? streamOpenAI(params, onChunk)
    : streamAnthropic(params, onChunk);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`LLM call timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([provider, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function streamOpenAI(
  params: StreamParams,
  onChunk: (text: string) => void,
): Promise<string> {
  let OpenAI: typeof import('openai').default;
  try {
    ({ default: OpenAI } = await import('openai'));
  } catch {
    throw new Error(
      "OpenAI SDK not installed. Run: npm install openai\n" +
      "Or switch providers: CORTEX_PROVIDER=anthropic (requires npm install @anthropic-ai/sdk)",
    );
  }
  const openai = new OpenAI();

  const tools = params.tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    },
  }));

  // Use native OpenAI message types for the tool loop so we can append
  // assistant tool_calls and tool results without fighting our simple LLMMessage type.
  const messages: OpenAI.ChatCompletionMessageParam[] = params.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const allText: string[] = [];

  // Tool-use loop — runs until finish_reason is 'stop' or no callTool provided.
  for (;;) {
    const stream = await openai.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: true,
    });

    // Accumulate tool call deltas (each index is one tool call, streamed in pieces)
    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null = null;
    const textChunks: string[] = [];

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta.content) {
        onChunk(delta.content);
        textChunks.push(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!pendingCalls.has(tc.index)) {
            pendingCalls.set(tc.index, { id: '', name: '', arguments: '' });
          }
          const entry = pendingCalls.get(tc.index)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }

    allText.push(...textChunks);

    if (finishReason !== 'tool_calls' || !params.callTool || pendingCalls.size === 0) {
      break;
    }

    const toolCalls = Array.from(pendingCalls.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    // Append assistant message that contains the tool call requests
    messages.push({
      role: 'assistant',
      content: textChunks.join('') || null,
      tool_calls: toolCalls,
    });

    // Execute all tool calls in parallel, then append results
    const toolResults = await Promise.all(
      toolCalls.map(async tc => {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          console.warn(`Tool call "${tc.function.name}" has malformed arguments (using {}):`, tc.function.arguments);
          input = {};
        }
        const result = await params.callTool!(tc.function.name, input);
        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        };
      }),
    );

    messages.push(...toolResults);
  }

  return allText.join('');
}

async function streamAnthropic(
  params: StreamParams,
  onChunk: (text: string) => void,
): Promise<string> {
  let Anthropic: typeof import('@anthropic-ai/sdk').default;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error(
      "Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk\n" +
      "Or use the default provider: CORTEX_PROVIDER=openai (requires npm install openai)",
    );
  }
  const anthropic = new Anthropic();

  const messages: Anthropic.MessageParam[] = params.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const allText: string[] = [];

  // Tool-use loop — runs until stop_reason is 'end_turn' or no callTool provided.
  for (;;) {
    const chunks: string[] = [];
    const stream = anthropic.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      tools: params.tools as Anthropic.Tool[] | undefined,
      messages,
    });

    stream.on('text', (text: string) => {
      onChunk(text);
      chunks.push(text);
    });

    const finalMessage = await stream.finalMessage();
    allText.push(...chunks);

    if (finalMessage.stop_reason !== 'tool_use' || !params.callTool) {
      break;
    }

    // Append the assistant's full content (includes tool_use blocks)
    messages.push({ role: 'assistant', content: finalMessage.content as Anthropic.ContentBlock[] });

    // Execute tool calls in parallel
    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async block => {
        const result = await params.callTool!(block.name, block.input);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        };
      }),
    );

    messages.push({ role: 'user', content: toolResults });
  }

  return allText.join('');
}
