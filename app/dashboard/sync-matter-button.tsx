"use client";

import { useActionState } from "react";
import { SyncButton } from "@/components/dashboard-components";
import { syncMatterAction, type SyncMatterActionState } from "./actions";

const initialState: SyncMatterActionState = null;

export function SyncMatterButton() {
  const [state, formAction, isPending] = useActionState(syncMatterAction, initialState);

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <form action={formAction}>
        <SyncButton type="submit" isSyncing={isPending} idleLabel="Sync Matter" syncingLabel="Sync started..." />
      </form>
      {state ? (
        <p className={state.ok ? "text-sm text-emerald-400" : "text-sm text-destructive"} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
