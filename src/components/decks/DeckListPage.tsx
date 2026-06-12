import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import AddDeckForm from "./AddDeckForm";
import DeckRow from "./DeckRow";
import DeleteDeckDialog from "./DeleteDeckDialog";

export interface Deck {
  id: string;
  name: string;
  created_at: string;
  card_count: number;
}

type Status = "loading" | "idle" | "error";

type DeckListResponse = { ok: true; decks: Deck[] } | { ok: false; error: { code: string; message: string } };
type DeckResponse = { ok: true; deck: Deck } | { ok: false; error: { code: string; message: string } };
type SimpleOkResponse = { ok: true } | { ok: false; error: { code: string; message: string } };

export default function DeckListPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deletingDeck, setDeletingDeck] = useState<Deck | null>(null);

  async function loadDecks() {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/decks");
      const body = (await res.json()) as DeckListResponse;
      if (res.ok && body.ok) {
        setDecks(body.decks);
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage("Couldn't load your decks. Reload to retry.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't load your decks. Reload to retry.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount pattern; setState calls happen after await, not synchronously
    void loadDecks();
  }, []);

  async function handleCreate(name: string) {
    setTransientError(null);
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as DeckResponse;
      if (res.ok && body.ok) {
        setDecks((prev) => [body.deck, ...prev]);
      } else {
        setTransientError("Couldn't create the deck. Please try again.");
      }
    } catch {
      setTransientError("Couldn't create the deck. Please try again.");
    }
  }

  async function handleRename(id: string, name: string) {
    setTransientError(null);
    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as DeckResponse;
      if (res.ok && body.ok) {
        setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, name: body.deck.name } : d)));
        setEditingDeckId(null);
      } else {
        setTransientError("Couldn't rename the deck. Please try again.");
      }
    } catch {
      setTransientError("Couldn't rename the deck. Please try again.");
    }
  }

  async function handleDelete(id: string) {
    setTransientError(null);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: "DELETE" });
      const body = (await res.json()) as SimpleOkResponse;
      if (res.ok && body.ok) {
        setDecks((prev) => prev.filter((d) => d.id !== id));
        setDeletingDeck(null);
      } else {
        setTransientError("Couldn't delete the deck. Please try again.");
      }
    } catch {
      setTransientError("Couldn't delete the deck. Please try again.");
    }
  }

  return (
    <div className="space-y-6 text-white">
      <div>
        <h1 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-3xl font-bold text-transparent">
          Your decks
        </h1>
        <p className="mt-1 text-sm text-blue-100/70">Manage your flashcard decks.</p>
      </div>

      {transientError && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{transientError}</AlertDescription>
        </Alert>
      )}

      {status === "error" && errorMessage && (
        <Alert variant="destructive" className="border-red-300/40 bg-red-500/15 text-red-50">
          <AlertTitle>Couldn&apos;t load decks</AlertTitle>
          <AlertDescription>
            {errorMessage}
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

      {status !== "error" && (
        <>
          <AddDeckForm onSubmit={handleCreate} />

          {status === "loading" && <p className="text-sm text-blue-100/70">Loading…</p>}

          {status === "idle" && decks.length === 0 && (
            <p className="text-sm text-blue-100/70">No decks yet. Create your first deck above.</p>
          )}

          {status === "idle" && decks.length > 0 && (
            <ul className="space-y-2">
              {decks.map((deck) => (
                <li key={deck.id}>
                  <DeckRow
                    deck={deck}
                    isEditing={editingDeckId === deck.id}
                    onStartEdit={() => {
                      setEditingDeckId(deck.id);
                    }}
                    onCancelEdit={() => {
                      setEditingDeckId(null);
                    }}
                    onSave={(name) => {
                      void handleRename(deck.id, name);
                    }}
                    onDelete={() => {
                      setDeletingDeck(deck);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <DeleteDeckDialog
        deck={deletingDeck}
        onCancel={() => {
          setDeletingDeck(null);
        }}
        onConfirm={() => {
          if (deletingDeck) {
            void handleDelete(deletingDeck.id);
          }
        }}
      />
    </div>
  );
}
