import { z } from 'zod';

/**
 * Validácia prostredia pri štarte — ak chýba povinná premenná,
 * proces spadne hneď s jasnou chybou (nie až za behu).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DOMAIN: z.string().default('localhost'),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Od T2 povinná — auth/feed/chat potrebujú DB.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL je povinná'),
  // Životnosť session (dni). Sliding expiration sa predĺži pri aktivite.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Koreňový adresár pre nahrané súbory (na NAS bind-mount /volume1/rodinna/media).
  MEDIA_PATH: z.string().default('./media'),
  // Max veľkosť nahrávaného obrázka v MB (§9: 50 MB foto).
  MAX_IMAGE_MB: z.coerce.number().int().positive().default(50),
  // Max veľkosť videa v MB (§9: 200 MB; ukladá sa originál bez transkódovania).
  MAX_VIDEO_MB: z.coerce.number().int().positive().default(200),
  // Max veľkosť iného súboru (dokument, PDF…) v MB.
  MAX_FILE_MB: z.coerce.number().int().positive().default(50),
  // Web Push (M0): pár vygeneruj `bun run vapid` a ulož do .env. Bez kľúčov
  // beží appka normálne, len sa push notifikácie neodosielajú (log warning).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Kontakt pre push službu (mailto: alebo https URL) — vyžaduje VAPID spec.
  VAPID_SUBJECT: z.string().default('mailto:admin@rodinna.local'),
  // Tajomstvo pre read-only ICS feed (M4). Bez neho sa token odvodí
  // z DATABASE_URL (funguje, ale rotácia hesla DB zneplatní odbery).
  ICS_SECRET: z.string().optional(),
  // LLM (M5, §6): OpenAI-kompatibilný server (Ollama: http://ollama:11434).
  // Bez URL beží appka normálne — LLM funkcie sú vypnuté, /api/llm vracia mock.
  LLM_BASE_URL: z.string().url().optional(),
  // Interaktívne/nočné joby (§15: malý CPU-friendly model).
  LLM_MODEL: z.string().default('llama3.2:3b-instruct-q4_K_M'),
  LLM_EMBED_MODEL: z.string().default('nomic-embed-text'),
  // Dimenzia embeddingov musí sedieť s modelom (nomic-embed-text = 768)
  // aj so stĺpcom diary_embeddings.embedding — zmena = nová migrácia.
  LLM_EMBED_DIM: z.coerce.number().int().positive().default(768),
  // Svet okolo (M7): override kurátorovaných RSS feedov (JSON objekt
  // kategória → pole URL). Používajú ho testy; na NAS-e netreba.
  NEWS_FEEDS_JSON: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';

/** Cookie 'Secure' iba v produkcii (dev na NAS beží cez http://IP:port). */
export const cookieSecure = isProd;

/** Push je zapnutý len s kompletným VAPID párom. */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/** LLM funkcie (denník, neskôr kvízy/digest) bežia len s nakonfigurovaným serverom. */
export const llmEnabled = Boolean(env.LLM_BASE_URL);
