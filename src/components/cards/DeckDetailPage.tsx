import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import AddCardForm from "./AddCardForm";
import CardRow from "./CardRow";
import DeleteCardDialog from "./DeleteCardDialog";
import NewCardsBanner from "./NewCardsBanner";

export interface Card {
  id: string;
  front: string;
  back: string;
  created_at: string;
}

interface DeckSummary {
  id: string;
  name: string;
}

type Status = "loading" | "idle" | "error";

type CardsListResponse =
  | { ok: true; deck: DeckSummary; cards: Card[] }
  | { ok: false; error: { code: string; message: string } };
type CardResponse = { ok: true; card: Card } | { ok: false; error: { code: string; message: string } };
type SimpleOkResponse = { ok: true } | { ok: false; error: { code: string; message: string } };

interface Props {
  deckId: string;
}

export default function DeckDetailPage({ deckId }: Props) {
  const [deck, setDeck] = useState<DeckSummary | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [deletingCard, setDeletingCard] = useState<Card | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const loadCards = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/cards`);
      const body = (await res.json()) as CardsListResponse;
      if (res.ok && body.ok) {
        setDeck(body.deck);
        setCards(body.cards);
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage("Couldn't load this deck. It may not exist or belong to you.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't load this deck. It may not exist or belong to you.");
    }
  }, [deckId]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- mount: capture ?since= and trigger fetch-on-mount; setState in fetch happens post-await */
    setSince(new URLSearchParams(window.location.search).get("since"));
    void loadCards();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [loadCards]);

  async function handleCreate(front: string, back: string) {
    setTransientError(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });
      const body = (await res.json()) as CardResponse;
      if (res.ok && body.ok) {
        setCards((prev) => [body.card, ...prev]);
      } else {
        setTransientError("Couldn't add the card. Please try again.");
      }
    } catch {
      setTransientError("Couldn't add the card. Please try again.");
    }
  }

  async function handleEdit(id: string, front: string, back: string) {
    setTransientError(null);
    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });
      const body = (await res.json()) as CardResponse;
      if (res.ok && body.ok) {
        setCards((prev) => prev.map((c) => (c.id === id ? { ...c, front: body.card.front, back: body.card.back } : c)));
        setEditingCardId(null);
      } else {
        setTransientError("Couldn't save the card. Please try again.");
      }
    } catch {
      setTransientError("Couldn't save the card. Please try again.");
    }
  }

  async function handleDelete(id: string) {
    setTransientError(null);
    try {
      const res = await fetch(`/api/cards/${id}`, { method: "DELETE" });
      const body = (await res.json()) as SimpleOkResponse;
      if (res.ok && body.ok) {
        setCards((prev) => prev.filter((c) => c.id !== id));
        setDeletingCard(null);
      } else {
        setTransientError("Couldn't delete the card. Please try again.");
      }
    } catch {
      setTransientError("Couldn't delete the card. Please try again.");
    }
  }

  function dismissBanner() {
    setBannerDismissed(true);
    window.history.replaceState(null, "", window.location.pathname);
  }

  if (status === "error") {
    return (
      <div className="space-y-6 text-white">
        <a href="/decks" className="inline-block text-sm text-blue-200/80 hover:text-white">
          ← Back to decks
        </a>
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Couldn&apos;t load this deck</AlertTitle>
          <AlertDescription>
            {errorMessage}
            <Button
              onClick={() => {
                void loadCards();
              }}
              variant="outline"
              size="sm"
              className="ml-2 border-white/30 bg-white/10 text-white hover:bg-white/20"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-white">
      <a href="/decks" className="inline-block text-sm text-blue-200/80 hover:text-white">
        ← Back to decks
      </a>

      <div>
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-3xl font-bold text-transparent">
          {deck?.name ?? "Deck"}
        </h1>
        <p className="mt-1 text-sm text-blue-100/70">Manage cards in this deck.</p>
      </div>

      {transientError && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{transientError}</AlertDescription>
        </Alert>
      )}

      {!bannerDismissed && <NewCardsBanner cards={cards} since={since} onDismiss={dismissBanner} />}

      <AddCardForm onSubmit={handleCreate} />

      {status === "loading" && <p className="text-sm text-blue-100/70">Loading…</p>}

      {status === "idle" && cards.length === 500 && (
        <Alert className="border-amber-300/30 bg-amber-500/15 text-amber-50">
          <AlertTitle>Showing the 500 most recent cards</AlertTitle>
          <AlertDescription>Pagination is on the roadmap.</AlertDescription>
        </Alert>
      )}

      {status === "idle" && cards.length === 0 && (
        <p className="text-sm text-blue-100/70">
          No cards yet. Add one above or{" "}
          <a href="/generate" className="text-blue-200 hover:text-white">
            use Generate to paste text
          </a>
          .
        </p>
      )}

      {status === "idle" && cards.length > 0 && (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.id}>
              <CardRow
                card={card}
                isEditing={editingCardId === card.id}
                isNew={since !== null && card.created_at >= since}
                onStartEdit={() => {
                  setEditingCardId(card.id);
                }}
                onCancelEdit={() => {
                  setEditingCardId(null);
                }}
                onSave={(front, back) => {
                  void handleEdit(card.id, front, back);
                }}
                onDelete={() => {
                  setDeletingCard(card);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <DeleteCardDialog
        card={deletingCard}
        onCancel={() => {
          setDeletingCard(null);
        }}
        onConfirm={() => {
          if (deletingCard) {
            void handleDelete(deletingCard.id);
          }
        }}
      />
    </div>
  );
}
