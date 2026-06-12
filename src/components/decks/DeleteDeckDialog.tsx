import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  deck: { id: string; name: string; card_count: number } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export default function DeleteDeckDialog({ deck, onCancel, onConfirm }: Props) {
  return (
    <AlertDialog
      open={deck !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete deck &lsquo;{deck?.name}&rsquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the deck and its {deck?.card_count ?? 0} card{plural(deck?.card_count ?? 0)}.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={cn(buttonVariants({ variant: "destructive" }))}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
