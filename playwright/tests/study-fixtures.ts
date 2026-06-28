// study-fixtures.ts
//
// API-driven test-data helpers used by SR review session E2E specs.
// Internal boundaries (auth, routing, DB) stay real per /10x-e2e: the helpers
// call the same authenticated `/api/decks` + `/api/decks/:id/cards` routes the
// app uses. The `APIRequestContext` inherits cookies from the `setup` project's
// storageState so requests run as `test@test.pl`.
//
// File name intentionally lacks `.spec.ts` so playwright.config.ts's
// testMatch /.*\.spec\.ts/ does not treat it as a test file.

import type { APIRequestContext } from "@playwright/test";

interface CardPair {
  front: string;
  back: string;
}

export async function createStudyDeck(
  request: APIRequestContext,
  name: string,
  pairs: CardPair[],
): Promise<{ deckId: string }> {
  const deckRes = await request.post("/api/decks", { data: { name } });
  const deckBody = (await deckRes.json()) as
    | { ok: true; deck: { id: string } }
    | { ok: false; error: { code: string; message: string } };
  if (!deckRes.ok() || !deckBody.ok) {
    const code = !deckBody.ok ? deckBody.error.code : `HTTP_${deckRes.status()}`;
    throw new Error(`createStudyDeck: POST /api/decks failed (${code})`);
  }
  const deckId = deckBody.deck.id;

  for (const pair of pairs) {
    const cardRes = await request.post(`/api/decks/${deckId}/cards`, { data: pair });
    const cardBody = (await cardRes.json()) as
      | { ok: true; card: { id: string } }
      | { ok: false; error: { code: string; message: string } };
    if (!cardRes.ok() || !cardBody.ok) {
      const code = !cardBody.ok ? cardBody.error.code : `HTTP_${cardRes.status()}`;
      throw new Error(`createStudyDeck: POST /api/decks/${deckId}/cards failed (${code})`);
    }
  }

  return { deckId };
}

export async function deleteStudyDeck(request: APIRequestContext, deckId: string): Promise<void> {
  // Content-Type: application/json bypasses Astro's `security.checkOrigin` for
  // non-safe methods (the check only fires for the three HTML-form content
  // types). Without this header DELETE returns 403 Forbidden in dev.
  const res = await request.delete(`/api/decks/${deckId}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (res.ok()) return;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  // Idempotent cleanup: DECK_NOT_FOUND means a prior teardown already ran or
  // the test never created the deck. Swallow it; surface everything else.
  if (body?.error?.code === "DECK_NOT_FOUND") return;
  throw new Error(
    `deleteStudyDeck: DELETE /api/decks/${deckId} failed (${body?.error?.code ?? `HTTP_${res.status()}`})`,
  );
}
