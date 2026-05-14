import type { ReactNode } from "react";
import { BookOpenCheck, CheckCircle2, Clock3, Crown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logout } from "@/lib/auth-actions";

import { AppNavigation } from "./app-navigation";

function LogoLockup() {
  return (
    <Link href="/dashboard" className="group flex items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform group-hover:-rotate-3">
        <BookOpenCheck className="h-6 w-6" aria-hidden />
      </span>
      <span>
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          Matter Stats <Badge className="border-primary/25 bg-primary/10 text-primary hover:bg-primary/15">Private</Badge>
        </span>
        <span className="block text-sm text-muted-foreground">Reading analytics</span>
      </span>
    </Link>
  );
}

function StatusCards({ compact = false }: { compact?: boolean }) {
  const cardClass = compact
    ? "min-w-[10.5rem] flex-1 rounded-2xl border border-white/10 bg-white/[0.035] p-3"
    : "rounded-2xl border border-white/10 bg-white/[0.035] p-3.5";

  return (
    <div className={compact ? "flex gap-2 overflow-x-auto" : "space-y-2.5"}>
      <div className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" aria-hidden /> User
        </div>
        <p className="mt-2 font-semibold text-foreground">Reader Name</p>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <Crown className="h-3.5 w-3.5" aria-hidden /> Plan
        </div>
        <p className="mt-2 font-semibold text-primary">Premium</p>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden /> Matter
        </div>
        <p className="mt-2 font-semibold text-foreground">Connected</p>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" aria-hidden /> Sync
        </div>
        <p className="mt-2 text-sm font-semibold text-foreground">Last synced — Pending</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:gap-6 lg:px-8 lg:py-6">
        <aside className="hidden lg:sticky lg:top-6 lg:flex lg:h-[calc(100vh-3rem)] lg:w-72 lg:shrink-0 lg:flex-col lg:rounded-[2rem] lg:border lg:border-white/10 lg:bg-card/75 lg:p-4 lg:shadow-soft lg:backdrop-blur-xl">
          <LogoLockup />
          <Separator className="my-5 bg-white/10" />
          <AppNavigation />
          <div className="mt-auto space-y-4 pt-6">
            <StatusCards />
            <form action={logout}>
              <Button type="submit" variant="outline" className="w-full border-white/10 bg-transparent hover:bg-white/[0.05]">
                <LogOut className="h-4 w-4" aria-hidden /> Log out
              </Button>
            </form>
          </div>
        </aside>

        <header className="rounded-[1.75rem] border border-white/10 bg-card/80 p-4 shadow-soft backdrop-blur-xl lg:hidden">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <LogoLockup />
              <form action={logout}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="submit" variant="outline" size="icon" className="border-white/10 bg-transparent hover:bg-white/[0.05]">
                      <LogOut className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Log out</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Log out</TooltipContent>
                </Tooltip>
              </form>
            </div>
            <AppNavigation variant="mobile" />
            <StatusCards compact />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl pb-8 lg:pb-12">{children}</div>
        </main>
      </div>
    </div>
  );
}
