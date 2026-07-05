import type { ServerWsEvent } from '@rodinna/shared-types';
import { sql } from './db/client';
import { publish } from './realtime';

/**
 * Cross-process WS most (§5 events, M1): worker nemá referenciu na Bun server
 * so socketmi, takže WS event pošle cez Postgres NOTIFY a API proces ho
 * po LISTEN republishne do svojho pub/sub. V API procese ide event rovno
 * lokálne (bez round-tripu do DB). Payload limit NOTIFY je 8 kB — eventy
 * nesú len identifikátory (napr. pollId), nie hydratované dáta.
 */

const CHANNEL = 'ws_broadcast';

let bridgeStarted = false;

/** Publish do WS topicu, funkčný z API aj worker procesu. */
export async function publishCrossProcess(topic: string, event: ServerWsEvent): Promise<void> {
  if (bridgeStarted) {
    // Sme v API procese — netreba DB round-trip.
    publish(topic, event);
    return;
  }
  await sql.notify(CHANNEL, JSON.stringify({ topic, event }));
}

/** Spustí LISTEN v API procese (volá index.ts po Bun.serve). */
export async function startWsBridge(): Promise<void> {
  await sql.listen(CHANNEL, (payload) => {
    try {
      const { topic, event } = JSON.parse(payload) as { topic: string; event: ServerWsEvent };
      publish(topic, event);
    } catch {
      /* nevalidný payload — ignoruj */
    }
  });
  bridgeStarted = true;
}
