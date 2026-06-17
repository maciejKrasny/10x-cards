import { useState } from "react";

import { Button } from "@/components/ui/button";
import DeckRowMenu from "./DeckRowMenu";
import type { Deck } from "./DeckListPage";

interface Props {
  deck: Deck;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

interface EditProps {
  deck: Deck;
  onCancelEdit: () => void;
  onSave: (name: string) => void;
}

function DeckRowEdit({ deck, onCancelEdit, onSave }: EditProps) {
  const [name, setName] = useState(deck.name);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-white/5 p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (name.trim().length > 0) onSave(name.trim());
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancelEdit();
          }
        }}
        maxLength={100}
        autoFocus
        className="flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
      />
      <Button
        onClick={() => {
          if (name.trim().length > 0) onSave(name.trim());
        }}
        disabled={name.trim().length === 0 || name.trim() === deck.name}
      >
        Save
      </Button>
      <Button
        onClick={onCancelEdit}
        variant="outline"
        className="border-white/30 bg-white/10 text-white hover:bg-white/20"
      >
        Cancel
      </Button>
    </div>
  );
}

export default function DeckRow({ deck, isEditing, onStartEdit, onCancelEdit, onSave, onDelete }: Props) {
  if (isEditing) {
    return <DeckRowEdit deck={deck} onCancelEdit={onCancelEdit} onSave={onSave} />;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <a href={`/decks/${deck.id}`} className="flex-1 truncate text-white hover:text-blue-200">
        <span className="font-medium">{deck.name}</span>
        <span className="ml-2 text-xs text-blue-100/60">
          {deck.card_count} card{plural(deck.card_count)}
        </span>
      </a>
      <div className="flex items-center gap-2">
        <Button
          asChild
          size="default"
          className="bg-purple-600 px-4 font-semibold text-white shadow-sm shadow-purple-900/40 hover:bg-purple-500"
        >
          <a href={`/study/${deck.id}`} className="inline-flex items-center gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            Study
          </a>
        </Button>
        <DeckRowMenu onRename={onStartEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}
