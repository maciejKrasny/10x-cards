import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_CHARS = 6000;

const PHASE_LABELS = ["Sending text to AI…", "Generating cards…", "Saving to your deck…"] as const;

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
type SubmitStatus = "idle" | "submitting" | "error";

type DeckListResponse = { ok: true; decks: Deck[] } | { ok: false; error: { code: string; message: string } };
type DeckCreateResponse = { ok: true; deck: Deck } | { ok: false; error: { code: string; message: string } };

export default function PasteToGenerate() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksStatus, setDecksStatus] = useState<DecksStatus>("loading");
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
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

  const overLimit = text.length > MAX_CHARS;
  const canSubmit =
    text.length > 0 && !overLimit && status !== "submitting" && decksStatus === "idle" && selectedDeckId !== null;

  async function handleGenerate() {
    if (!canSubmit || !selectedDeckId) return;
    setStatus("submitting");
    setPhase(0);
    setErrorMessage(null);

    const requestStartedAt = new Date().toISOString();

    const phaseTimers = [
      setTimeout(() => {
        setPhase(1);
      }, 2000),
      setTimeout(() => {
        setPhase(2);
      }, 12000),
    ];
    const clearPhaseTimers = () => {
      phaseTimers.forEach((t) => {
        clearTimeout(t);
      });
    };

    let response: Response;
    try {
      response = await fetch("/api/cards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, deck_id: selectedDeckId }),
      });
    } catch {
      clearPhaseTimers();
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.LLM_FAILURE);
      return;
    }

    let body: { ok?: boolean; cards?: unknown[]; error?: { code?: string } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      clearPhaseTimers();
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.INVALID_REQUEST);
      return;
    }

    clearPhaseTimers();

    if (response.ok && body.ok) {
      window.sessionStorage.setItem("lastUsedDeckId", selectedDeckId);
      window.location.href = `/decks/${selectedDeckId}?since=${encodeURIComponent(requestStartedAt)}`;
      return;
    }

    setStatus("error");
    setErrorMessage(mapErrorMessage(body.error?.code));
  }

  return (
    <div className="space-y-4 text-white">
      {errorMessage && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Couldn&apos;t generate cards</AlertTitle>
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
            disabled={status === "submitting" || decksStatus !== "idle" || decks.length === 0}
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
        <a href="/decks" className="text-sm text-blue-200 hover:text-white">
          Manage decks →
        </a>
      </div>

      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          placeholder="Paste text to generate flashcards…"
          maxLength={MAX_CHARS}
          rows={8}
          disabled={status === "submitting"}
          className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
        />
        <div className="flex items-center justify-between text-xs">
          <span className={overLimit ? "text-red-300" : "text-blue-100/60"}>
            {text.length} / {MAX_CHARS}
          </span>
          <Button
            onClick={() => {
              void handleGenerate();
            }}
            disabled={!canSubmit}
          >
            {status === "submitting" ? "Generating…" : "Generate flashcards"}
          </Button>
        </div>
      </div>

      {status === "submitting" && (
        <div className="space-y-2">
          <p className="text-sm text-blue-100/80">{PHASE_LABELS[phase]}</p>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="paste-progress-bar absolute top-0 left-0 h-full w-1/3 rounded-full bg-blue-400" />
          </div>
        </div>
      )}
    </div>
  );
}
