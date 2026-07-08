import webpush from 'web-push';

/**
 * Vygeneruje VAPID pár pre Web Push (M0). Spusti raz, ulož do .env na NAS-e
 * a nikdy nemeň — zmena kľúčov zneplatní všetky existujúce subscriptions.
 *
 *   bun run vapid
 */
const keys = webpush.generateVAPIDKeys();
console.log('# Vlož do .env (compose ich podá api aj worker službe):');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:tvoj@email.sk');
