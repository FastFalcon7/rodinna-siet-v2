import { env, llmEnabled } from '../config/env';

/**
 * LLM Provider Adapter (ARCHITECTURE_V2.md §6): OpenAI-kompatibilné JSON API,
 * zameniteľný backend cez LLM_BASE_URL (Ollama / llama.cpp / OpenAI).
 * Používa sa výhradne z worker jobov a /api/llm proxy — real-time cesty appky
 * na LLM nikdy nečakajú (§15). Worker je sériový = prirodzený semafór,
 * na CPU-only NAS-e nikdy nebežia paralelné inferencie.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LlmDisabledError extends Error {
  constructor() {
    super('LLM nie je nakonfigurované (LLM_BASE_URL)');
  }
}

/** Neprúdová chat completion — pre dávkové joby (denník, kvízy). */
export async function chatCompletion(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (!llmEnabled) throw new LlmDisabledError();
  const res = await fetch(`${env.LLM_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
    // Nočný job na CPU pokojne beží minúty; watchdog až po 10 min.
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`LLM chat zlyhal: ${res.status} ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM vrátil prázdnu odpoveď');
  return content;
}

/** Embedding textu (nomic-embed-text, 768 dim) pre pgvector. */
export async function embedText(text: string): Promise<number[]> {
  if (!llmEnabled) throw new LlmDisabledError();
  const res = await fetch(`${env.LLM_BASE_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.LLM_EMBED_MODEL, input: text }),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`LLM embeddings zlyhali: ${res.status}`);
  const data = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = data.data?.[0]?.embedding;
  if (!vec || vec.length !== env.LLM_EMBED_DIM) {
    throw new Error(`Embedding má ${vec?.length ?? 0} dimenzií, čakám ${env.LLM_EMBED_DIM}`);
  }
  return vec;
}
