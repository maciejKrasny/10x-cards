import { useState } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  onSubmit: (name: string) => Promise<void> | void;
}

export default function AddDeckForm({ onSubmit }: Props) {
  const [mode, setMode] = useState<"collapsed" | "expanded">("collapsed");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim());
      setName("");
      setMode("collapsed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setName("");
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
        + Add deck
      </Button>
    );
  }

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
            void handleSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
          }
        }}
        placeholder="Deck name"
        maxLength={100}
        disabled={submitting}
        autoFocus
        className="flex-1 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
      />
      <Button
        onClick={() => {
          void handleSubmit();
        }}
        disabled={!canSubmit}
      >
        {submitting ? "Saving…" : "Submit"}
      </Button>
      <Button
        onClick={handleCancel}
        variant="outline"
        disabled={submitting}
        className="border-white/30 bg-white/10 text-white hover:bg-white/20"
      >
        Cancel
      </Button>
    </div>
  );
}
