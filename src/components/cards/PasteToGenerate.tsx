import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_CHARS = 6000;

const PHASE_LABELS = ["Sending text to AI…", "Generating cards…", "Saving to your deck…"] as const;

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Please sign in to generate cards.",
  INPUT_TOO_SHORT: "Text must be between 1 and 6000 characters.",
  INPUT_TOO_LONG: "Text must be between 1 and 6000 characters.",
  LLM_FAILURE: "Generation failed. Please try again.",
  DB_INSERT_FAILED: "Saving failed. Please try again.",
  INVALID_REQUEST: "Something went wrong. Please try again.",
};

function mapErrorMessage(code: string | undefined): string {
  if (!code) return ERROR_MESSAGES.INVALID_REQUEST;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INVALID_REQUEST;
}

interface GeneratedCardRow {
  id: string;
  front: string;
  back: string;
  created_at: string;
}

type Status = "idle" | "submitting" | "success" | "error";

export default function PasteToGenerate() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState<0 | 1 | 2>(0);
  const [cards, setCards] = useState<GeneratedCardRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const overLimit = text.length > MAX_CHARS;
  const canSubmit = text.length > 0 && !overLimit && status !== "submitting";

  async function handleGenerate() {
    if (!canSubmit) return;
    setStatus("submitting");
    setPhase(0);
    setErrorMessage(null);
    setSuccessMessage(null);

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
        body: JSON.stringify({ text }),
      });
    } catch {
      clearPhaseTimers();
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.LLM_FAILURE);
      return;
    }

    let body: { ok?: boolean; cards?: GeneratedCardRow[]; error?: { code?: string } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      clearPhaseTimers();
      setStatus("error");
      setErrorMessage(ERROR_MESSAGES.INVALID_REQUEST);
      return;
    }

    clearPhaseTimers();

    if (response.ok && body.ok && Array.isArray(body.cards)) {
      setCards(body.cards);
      setSuccessMessage(`Saved ${body.cards.length} cards to your deck`);
      setText("");
      setStatus("success");
      return;
    }

    setStatus("error");
    setErrorMessage(mapErrorMessage(body.error?.code));
  }

  return (
    <div className="space-y-4 text-white">
      {successMessage && (
        <Alert className="border-emerald-300/30 bg-emerald-500/15 text-emerald-50">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      {errorMessage && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Couldn&apos;t generate cards</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

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
          <Button onClick={handleGenerate} disabled={!canSubmit}>
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
          <style>{`
            @keyframes paste-progress-slide {
              0% { transform: translateX(-110%); }
              100% { transform: translateX(310%); }
            }
            .paste-progress-bar { animation: paste-progress-slide 1.4s ease-in-out infinite; }
          `}</style>
        </div>
      )}

      {cards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Latest batch</h2>
          <ul className="space-y-2">
            {cards.map((card) => (
              <li key={card.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-left">
                <p className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Front</p>
                <p className="mb-2 text-white">{card.front}</p>
                <p className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Back</p>
                <p className="text-white">{card.back}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
