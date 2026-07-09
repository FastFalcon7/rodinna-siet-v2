import { Hono } from 'hono';
import type { AppEnv } from '../../core/types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../auth/middleware';
import { rateLimit } from '../auth/ratelimit';
import { env, llmEnabled } from '../../config/env';

/**
 * LLM-ready API vrstva (ARCHITECTURE_V2.md §6, akceptácia §14.7):
 * /api/llm/chat/completions zrkadlí OpenAI spec. S nakonfigurovaným
 * LLM_BASE_URL proxuje (vrátane streamu) na Ollama/llama.cpp; bez neho
 * vracia mock stream — appka je LLM-ready aj pred zapojením modelu.
 * Interné moduly (denník) volajú adaptér core/llm.ts priamo cez worker.
 */

const MOCK_TEXT = 'Ahoj! Som zatiaľ len mock — nastav LLM_BASE_URL a ožijem. 🤖';

function mockStream(): Response {
  const chunks = MOCK_TEXT.split(' ');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      let i = 0;
      const tick = () => {
        if (i < chunks.length) {
          const delta = { choices: [{ delta: { content: (i > 0 ? ' ' : '') + chunks[i] } }] };
          controller.enqueue(enc.encode(`data: ${JSON.stringify(delta)}\n\n`));
          i++;
          setTimeout(tick, 40);
        } else {
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        }
      };
      tick();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

const router = new Hono<AppEnv>();

/** POST /api/llm/chat/completions — OpenAI-kompatibilné (stream aj JSON). */
router.post('/chat/completions', requireAuth, async (c) => {
  const me = c.get('user')!;
  if (!rateLimit(`llm:${me.id}`, 10, 60_000)) {
    return c.json({ error: 'Priveľa LLM dopytov, skús o chvíľu' }, 429);
  }

  const body = await c.req.json().catch(() => ({}));

  if (!llmEnabled) {
    if (body?.stream === false) {
      return c.json({ choices: [{ message: { role: 'assistant', content: MOCK_TEXT } }] });
    }
    return mockStream();
  }

  // Proxy 1:1 — model doplníme, ak klient neposlal.
  const upstream = await fetch(`${env.LLM_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.LLM_MODEL, ...body }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-cache',
    },
  });
});

export const llmModule: AppModule = {
  name: 'llm',
  basePath: '/llm',
  router,
  permissions: ['llm.use'],
};
