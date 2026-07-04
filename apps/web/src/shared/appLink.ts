/**
 * Interné `app://` linky (plán §M0-4, kontrakt K2): živá karta v chate/poste
 * je odkaz `app://<modul>/<entityId>` v tele textu. Vlastná schéma =
 * žiadna kolízia s reálnymi URL (linkify ani OG preview ich nechytajú),
 * deep-link na entitu zadarmo.
 */

const APP_LINK_RE = /app:\/\/([a-z0-9-]+)\/([A-Za-z0-9][\w-]*)/;

export interface AppLink {
  module: string;
  entityId: string;
  /** Presný text linku (na odstránenie z zobrazeného textu). */
  raw: string;
}

export function parseAppLink(text: string): AppLink | null {
  const m = APP_LINK_RE.exec(text);
  return m ? { module: m[1]!, entityId: m[2]!, raw: m[0]! } : null;
}

/** Text bez app linku (karta sa renderuje samostatne pod textom). */
export function stripAppLink(text: string, link: AppLink): string {
  return text.replace(link.raw, '').replace(/\s{2,}/g, ' ').trim();
}

export function buildAppLink(module: string, entityId: string): string {
  return `app://${module}/${entityId}`;
}
