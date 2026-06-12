import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Card } from "./DeckDetailPage";

interface Props {
  cards: Card[];
  since: string | null;
  onDismiss: () => void;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export default function NewCardsBanner({ cards, since, onDismiss }: Props) {
  if (!since) return null;
  const newCount = cards.filter((c) => c.created_at >= since).length;
  if (newCount === 0) return null;

  return (
    <Alert className="border-emerald-300/30 bg-emerald-500/15 text-emerald-50">
      <AlertTitle>
        {newCount} new card{plural(newCount)} added
      </AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>Recently added cards are highlighted below.</span>
        <Button
          onClick={onDismiss}
          variant="outline"
          size="sm"
          className="border-white/30 bg-white/10 text-white hover:bg-white/20"
        >
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}
