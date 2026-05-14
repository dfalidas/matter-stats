"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { syncMatterAction, type SyncMatterActionState } from "./actions";

const initialState: SyncMatterActionState = null;

export function SyncMatterButton() {
  const [state, formAction, isPending] = useActionState(syncMatterAction, initialState);

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <form action={formAction}>
        <Button type="submit" disabled={isPending}>
          <RefreshCw className={isPending ? "animate-spin" : undefined} aria-hidden />
          {isPending ? "Syncing Matter..." : "Sync Matter"}
        </Button>
      </form>
      {state ? (
        <p className={state.ok ? "text-sm text-emerald-400" : "text-sm text-destructive"} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
