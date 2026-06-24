import { z } from 'zod';

/** Odpoveď `/api/health` — zdieľaná medzi API (validácia výstupu) a web (typ). */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
