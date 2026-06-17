import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface ReviewCard {
  front: string;
  back: string;
}

interface Props {
  card: ReviewCard;
  isEditing: boolean;
  disabled: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (front: string, back: string) => void;
  onDiscard: () => void;
}

interface EditProps {
  card: ReviewCard;
  onCancelEdit: () => void;
  onSave: (front: string, back: string) => void;
}

function ReviewCardRowEdit({ card, onCancelEdit, onSave }: EditProps) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);

  const trimmedFront = front.trim();
  const trimmedBack = back.trim();
  const unchanged = trimmedFront === card.front && trimmedBack === card.back;
  const disabled = trimmedFront.length === 0 || trimmedBack.length === 0 || unchanged;

  function handleEscape(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancelEdit();
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/15 bg-white/5 p-3">
      <div className="space-y-1">
        <label className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Front</label>
        <Textarea
          value={front}
          onChange={(e) => {
            setFront(e.target.value);
          }}
          onKeyDown={handleEscape}
          maxLength={1000}
          rows={3}
          autoFocus
          className="border-white/20 bg-white/5 text-white"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Back</label>
        <Textarea
          value={back}
          onChange={(e) => {
            setBack(e.target.value);
          }}
          onKeyDown={handleEscape}
          maxLength={1000}
          rows={3}
          className="border-white/20 bg-white/5 text-white"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          onClick={onCancelEdit}
          variant="outline"
          className="border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            onSave(trimmedFront, trimmedBack);
          }}
          disabled={disabled}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export default function ReviewCardRow({
  card,
  isEditing,
  disabled,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDiscard,
}: Props) {
  if (isEditing) {
    return <ReviewCardRowEdit card={card} onCancelEdit={onCancelEdit} onSave={onSave} />;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="mb-2 space-y-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Front</p>
          <p className="text-white">{card.front}</p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Back</p>
          <p className="text-white">{card.back}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          onClick={onStartEdit}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          Edit
        </Button>
        <Button
          onClick={onDiscard}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
