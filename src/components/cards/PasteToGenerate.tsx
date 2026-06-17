import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReviewCardRow, { type ReviewCard } from "./ReviewCardRow";

const MAX_CHARS = 6000;

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Please sign in to generate cards.",
  INPUT_TOO_SHORT: "Text is empty. Please paste at least 1 character.",
  INPUT_TOO_LONG: "Text exceeds 6000 characters. Please shorten it.",
  LLM_FAILURE: "Generation failed. Please try again.",
  DB_INSERT_FAILED: "Saving failed. Please try again.",
  DECK_NOT_FOUND: "This deck no longer exists. Reload to pick another.",
  INVALID_REQUEST: "Something went wrong. Please try again.",
};

function mapErrorMessage(code: string | undefined): string {
  if (!code) return ERROR_MESSAGES.INVALID_REQUEST;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INVALID_REQUEST;
}

interface Deck {
  id: string;
  name: string;
  created_at: string;
  card_count: number;
}

type DecksStatus = "loading" | "idle" | "error";
type Phase = "idle" | "generating" | "reviewing" | "saving";

type DeckListResponse = { ok: true; decks: Deck[] } | { ok: false; error: { code: string; message: string } };
type DeckCreateResponse = { ok: true; deck: Deck } | { ok: false; error: { code: string; message: string } };
type GenerateResponse = { ok: true; cards: ReviewCard[] } | { ok: false; error: { code: string; message: string } };
type BulkResponse =
  | { ok: true; deck_id: string; cards: { id: string; created_at: string }[] }
  | { ok: false; error: { code: string; message: string } };

export default function PasteToGenerate() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksStatus, setDecksStatus] = useState<DecksStatus>("loading");
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [batch, setBatch] = useState<ReviewCard[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDecks = useCallback(async () => {
    setDecksStatus("loading");
    try {
      const res = await fetch("/api/decks");
      const body = (await res.json()) as DeckListResponse;
      if (!res.ok || !body.ok) {
        setDecksStatus("error");
        return;
      }

      if (body.decks.length === 0) {
        const createRes = await fetch("/api/decks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Deck" }),
        });
        const createBody = (await createRes.json()) as DeckCreateResponse;
        if (!createRes.ok || !createBody.ok) {
          setDecksStatus("error");
          return;
        }
        setDecks([createBody.deck]);
        setSelectedDeckId(createBody.deck.id);
        setDecksStatus("idle");
        return;
      }

      const stored = window.sessionStorage.getItem("lastUsedDeckId");
      const defaultId = stored && body.decks.some((d) => d.id === stored) ? stored : body.decks[0].id;
      setDecks(body.decks);
      setSelectedDeckId(defaultId);
      setDecksStatus("idle");
    } catch {
      setDecksStatus("error");
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- mount: load decks; setState calls happen post-await */
    void loadDecks();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [loadDecks]);

  // Browser-native prompt when the user navigates away with unsaved cards.
  // Mounted only while `reviewing` so the warning doesn't fire during the
  // post-submit redirect or in the empty/generating states.
  useEffect(() => {
    if (phase !== "reviewing") return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [phase]);

  const overLimit = text.length > MAX_CHARS;
  const formDisabled = phase === "generating" || phase === "saving";
  const canGenerate =
    text.length > 0 && !overLimit && !formDisabled && decksStatus === "idle" && selectedDeckId !== null;

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) ?? null;

  async function runGenerate(deckId: string) {
    setPhase("generating");
    setErrorMessage(null);

    let response: Response;
    try {
      response = await fetch("/api/cards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, deck_id: deckId }),
      });
    } catch {
      setPhase("idle");
      setErrorMessage(ERROR_MESSAGES.LLM_FAILURE);
      return;
    }

    let body: GenerateResponse;
    try {
      body = (await response.json()) as GenerateResponse;
    } catch {
      setPhase("idle");
      setErrorMessage(ERROR_MESSAGES.INVALID_REQUEST);
      return;
    }

    if (response.ok && body.ok) {
      setBatch(body.cards);
      setEditingIndex(null);
      setPhase("reviewing");
      return;
    }

    setPhase("idle");
    setErrorMessage(mapErrorMessage(!body.ok ? body.error.code : undefined));
  }

  async function handleGenerate() {
    if (!canGenerate || !selectedDeckId) return;
    if (batch.length > 0) {
      const ok = window.confirm(
        `Replace ${batch.length} unsaved card${batch.length === 1 ? "" : "s"} with a new batch?`,
      );
      if (!ok) return;
    }
    await runGenerate(selectedDeckId);
  }

  function handleDiscardCard(index: number) {
    setBatch((prev) => prev.filter((_, i) => i !== index));
    setEditingIndex((curr) => {
      if (curr === null) return null;
      if (curr === index) return null;
      return curr > index ? curr - 1 : curr;
    });
  }

  function handleSaveEdit(index: number, front: string, back: string) {
    setBatch((prev) => prev.map((c, i) => (i === index ? { front, back } : c)));
    setEditingIndex(null);
  }

  function handleDiscardAll() {
    setBatch([]);
    setEditingIndex(null);
    setPhase("idle");
  }

  async function handleSubmit() {
    if (phase !== "reviewing" || batch.length === 0 || !selectedDeckId) return;
    setPhase("saving");
    setErrorMessage(null);

    let response: Response;
    try {
      response = await fetch("/api/cards/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck_id: selectedDeckId, cards: batch }),
      });
    } catch {
      setPhase("reviewing");
      setErrorMessage(ERROR_MESSAGES.DB_INSERT_FAILED);
      return;
    }

    let body: BulkResponse;
    try {
      body = (await response.json()) as BulkResponse;
    } catch {
      setPhase("reviewing");
      setErrorMessage(ERROR_MESSAGES.INVALID_REQUEST);
      return;
    }

    if (response.ok && body.ok) {
      window.sessionStorage.setItem("lastUsedDeckId", selectedDeckId);
      // Use the earliest server-side created_at as the `since` boundary so the
      // "New" badge on /decks/[id] catches every row from this batch. Using a
      // client-clock timestamp risks marking nothing as new under clock skew.
      const since = body.cards.reduce<string | null>(
        (min, c) => (min === null || c.created_at < min ? c.created_at : min),
        null,
      );
      // Clear batch so the beforeunload effect tears down before navigation.
      setBatch([]);
      setPhase("idle");
      const query = since ? `?since=${encodeURIComponent(since)}` : "";
      window.location.href = `/decks/${selectedDeckId}${query}`;
      return;
    }

    setPhase("reviewing");
    setErrorMessage(mapErrorMessage(!body.ok ? body.error.code : undefined));
  }

  const reviewing = phase === "reviewing" || phase === "saving";
  const submitDisabled = batch.length === 0 || phase === "saving";
  const targetDeckName = selectedDeck?.name ?? "deck";

  return (
    <div className="space-y-4 text-white">
      {errorMessage && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {decksStatus === "error" && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Couldn&apos;t load decks</AlertTitle>
          <AlertDescription>
            Reload the page to try again.
            <Button
              onClick={() => {
                void loadDecks();
              }}
              variant="outline"
              size="sm"
              className="ml-2 border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 space-y-1">
          <label htmlFor="deck-select" className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">
            Target deck
          </label>
          <select
            id="deck-select"
            value={selectedDeckId ?? ""}
            onChange={(e) => {
              setSelectedDeckId(e.target.value);
            }}
            disabled={formDisabled || decksStatus !== "idle" || decks.length === 0}
            className="w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-400/50 focus:outline-none disabled:opacity-50"
          >
            {decksStatus === "loading" && <option value="">Loading…</option>}
            {decksStatus === "idle" &&
              decks.map((deck) => (
                <option key={deck.id} value={deck.id} className="bg-slate-900">
                  {deck.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder="Paste text to generate cards…"
          maxLength={MAX_CHARS}
          rows={8}
          disabled={formDisabled}
          className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
        />
        <div className="flex items-center justify-between text-xs">
          <span className={overLimit ? "text-red-300" : "text-blue-100/60"}>
            {text.length} / {MAX_CHARS} characters
          </span>
          <Button
            onClick={() => {
              void handleGenerate();
            }}
            disabled={!canGenerate}
          >
            {phase === "generating" ? "Generating…" : "Generate cards"}
          </Button>
        </div>
      </div>

      {phase === "generating" && (
        <div className="space-y-2">
          <p className="text-sm text-blue-100/80">Generating cards…</p>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="paste-progress-bar absolute top-0 left-0 h-full w-1/3 rounded-full bg-blue-400" />
          </div>
        </div>
      )}

      {reviewing && batch.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Review {batch.length} generated card{batch.length === 1 ? "" : "s"}
            </h2>
            <p className="text-sm text-blue-100/70">Edit or discard any. Nothing is saved until you click Save.</p>
          </div>

          <ul className="space-y-3">
            {batch.map((card, index) => (
              <li key={index}>
                <ReviewCardRow
                  card={card}
                  isEditing={editingIndex === index}
                  disabled={phase === "saving"}
                  onStartEdit={() => {
                    setEditingIndex(index);
                  }}
                  onCancelEdit={() => {
                    setEditingIndex(null);
                  }}
                  onSave={(front, back) => {
                    handleSaveEdit(index, front, back);
                  }}
                  onDiscard={() => {
                    handleDiscardCard(index);
                  }}
                />
              </li>
            ))}
          </ul>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-[#0f1529]/95 p-3 backdrop-blur">
            <Button
              onClick={handleDiscardAll}
              variant="outline"
              disabled={phase === "saving"}
              className="border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              Discard all
            </Button>
            <Button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={submitDisabled}
            >
              {phase === "saving"
                ? "Saving…"
                : `Save ${batch.length} card${batch.length === 1 ? "" : "s"} to ${targetDeckName}`}
            </Button>
          </div>
        </div>
      )}

      {phase === "reviewing" && batch.length === 0 && (
        <p className="text-sm text-blue-100/70">
          No cards to save — paste again or edit text, then click Generate cards.
        </p>
      )}
    </div>
  );
}
