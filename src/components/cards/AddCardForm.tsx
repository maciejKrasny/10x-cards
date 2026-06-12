import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSubmit: (front: string, back: string) => Promise<void> | void;
}

export default function AddCardForm({ onSubmit }: Props) {
  const [mode, setMode] = useState<"collapsed" | "expanded">("collapsed");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = front.trim().length > 0 && back.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(front.trim(), back.trim());
      setFront("");
      setBack("");
      setMode("collapsed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setFront("");
    setBack("");
    setMode("collapsed");
  }

  if (mode === "collapsed") {
    return (
      <Button
        onClick={() => {
          setMode("expanded");
        }}
        variant="outline"
        className="border-white/30 bg-white/10 text-white hover:bg-white/20"
      >
        + Add card
      </Button>
    );
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
          maxLength={1000}
          rows={3}
          disabled={submitting}
          autoFocus
          className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium tracking-wide text-blue-200/70 uppercase">Back</label>
        <Textarea
          value={back}
          onChange={(e) => {
            setBack(e.target.value);
          }}
          maxLength={1000}
          rows={3}
          disabled={submitting}
          className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          onClick={handleCancel}
          variant="outline"
          disabled={submitting}
          className="border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            void handleSubmit();
          }}
          disabled={!canSubmit}
        >
          {submitting ? "Saving…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
