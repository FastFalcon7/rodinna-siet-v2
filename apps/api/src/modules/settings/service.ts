import { eq } from 'drizzle-orm';
import { db } from '../../core/db/client';
import { appSettings } from '../../core/db/schema';

/**
 * Globálne nastavenia (ladenie 07/2026): KV v tabuľke app_settings.
 * `ai_features_enabled` prepína AI funkcie (Kvízy, Denník, otázka dňa/týždňa)
 * pre celú rodinu — mení ho len admin. Predvolene VYPNUTÉ (výstupy sa ladia).
 */

const AI_KEY = 'ai_features_enabled';

async function getSetting(name: string): Promise<string | null> {
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.name, name)).limit(1);
  return rows[0]?.value ?? null;
}

async function setSetting(name: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ name, value })
    .onConflictDoUpdate({ target: appSettings.name, set: { value, updatedAt: new Date() } });
}

/** Sú AI funkcie zapnuté? Predvolene false (kľúč chýba). */
export async function getAiEnabled(): Promise<boolean> {
  return (await getSetting(AI_KEY)) === '1';
}

export async function setAiEnabled(on: boolean): Promise<void> {
  await setSetting(AI_KEY, on ? '1' : '0');
}
