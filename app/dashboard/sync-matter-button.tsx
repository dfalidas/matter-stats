"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { SyncButton } from "@/components/dashboard-components";
import {
  buildMatterRateLimitMessage,
  formatMatterRetryTime,
  isMatterRateLimitActive,
  shouldDisableMatterSyncButton,
} from "@/lib/matter-sync-progress";
import { getMatterSyncAvailabilityAction, syncMatterAction, type SyncMatterActionState } from "./actions";

const initialState: SyncMatterActionState = null;

export function SyncMatterButton() {
  const [state, formAction, isPending] = useActionState(syncMatterAction, initialState);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<string | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let isMounted = true;

    getMatterSyncAvailabilityAction()
      .then((availability) => {
        if (!isMounted) {
          return;
        }

        setRateLimitedUntil(availability.rateLimitedUntil);
        setAvailabilityMessage(availability.message);
      })
      .catch(() => {
        if (isMounted) {
          setAvailabilityMessage(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (state?.rateLimitedUntil !== undefined) {
      setRateLimitedUntil(state.rateLimitedUntil);
      setAvailabilityMessage(state.rateLimitedUntil ? buildMatterRateLimitMessage(state.rateLimitedUntil) : null);
    }
  }, [state]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, []);

  const isRateLimited = isMatterRateLimitActive(rateLimitedUntil, now);
  const isDisabled = shouldDisableMatterSyncButton({ isPending, rateLimitedUntil, now });
  const rateLimitNotice = useMemo(() => {
    if (!rateLimitedUntil || !isRateLimited || isPending) {
      return null;
    }

    return `Matter sync is paused until ${formatMatterRetryTime(rateLimitedUntil)}.`;
  }, [isPending, isRateLimited, rateLimitedUntil]);

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <form action={formAction}>
        <SyncButton
          type="submit"
          isSyncing={isPending}
          disabled={isDisabled}
          idleLabel="Sync Matter"
          syncingLabel="Sync started..."
        />
      </form>
      {rateLimitNotice ? <p className="text-sm text-warning">{rateLimitNotice}</p> : null}
      {state || (availabilityMessage && isRateLimited) ? (
        <p className={state?.ok ? "text-sm text-emerald-400" : "text-sm text-destructive"} role="status" aria-live="polite">
          {state?.message ?? availabilityMessage}
        </p>
      ) : null}
    </div>
  );
}
