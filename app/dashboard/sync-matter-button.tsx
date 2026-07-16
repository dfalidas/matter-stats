"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { SyncButton } from "@/components/dashboard-components";
import {
  buildMatterRateLimitMessage,
  DEFAULT_RECENT_ACTIVITY_WINDOW,
  formatMatterRetryTime,
  isMatterRateLimitActive,
  MATTER_RECENT_ACTIVITY_WINDOW_OPTIONS,
  shouldDisableMatterSyncButton,
} from "@/lib/matter-sync-progress";
import { getMatterSyncAvailabilityAction, syncMatterAction, type SyncMatterActionState } from "./actions";

const initialState: SyncMatterActionState = null;

export function SyncMatterButton({ showBackfill = false }: { showBackfill?: boolean } = {}) {
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
      <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
        <label className="sr-only" htmlFor="recentActivityWindow">Recent activity window</label>
        <select
          id="recentActivityWindow"
          name="recentActivityWindow"
          defaultValue={DEFAULT_RECENT_ACTIVITY_WINDOW}
          disabled={isDisabled}
          className="h-9 rounded-md border border-white/10 bg-dashboard-card px-3 text-sm text-dashboard-text shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {MATTER_RECENT_ACTIVITY_WINDOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SyncButton
          type="submit"
          name="mode"
          value="recent_activity_manual"
          isSyncing={isPending}
          disabled={isDisabled}
          idleLabel="Sync Recent Activity"
          syncingLabel="Sync started..."
        />
        {showBackfill ? (
          <SyncButton
            type="submit"
            name="mode"
            value="backfill_library"
            variant="outline"
            className="border-white/10 bg-transparent hover:bg-white/[0.05]"
            isSyncing={isPending}
            disabled={isDisabled}
            idleLabel="Backfill Library"
            syncingLabel="Sync started..."
          />
        ) : null}
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
