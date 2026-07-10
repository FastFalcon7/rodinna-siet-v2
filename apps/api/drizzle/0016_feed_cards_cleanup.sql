-- Ladenie 07/2026: udalosti, kvízy a albumy sa už vo Feede nezobrazujú —
-- žijú vo vlastných častiach (Kalendár/chat, Kvízy, Albumy). Zmaž existujúce karty.
DELETE FROM "feed_cards" WHERE "module" IN ('events', 'quiz', 'albums');
