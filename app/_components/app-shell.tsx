import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { BookOpen, LogOut } from "lucide-react";
import { logout } from "@/lib/auth-actions";
import { AppNavigation } from "./app-navigation";
import { AccountMenu, SettingsLink } from "./account-menu";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r bg-card px-5 py-7 lg:flex lg:flex-col">
        <Link
          href="/dashboard"
          className="mb-10 flex min-h-11 items-center gap-3 rounded-xl font-semibold focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
            <BookOpen className="h-4 w-4" />
          </span>
          Matter Stats
        </Link>
        <Suspense>
          <AppNavigation />
        </Suspense>
        <div className="mt-auto space-y-1 border-t pt-4">
          <SettingsLink className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" />
          <form action={logout}>
            <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <LogOut className="h-5 w-5" />
              Log out
            </button>
          </form>
        </div>
      </aside>
      <header className="flex min-h-16 items-center justify-between border-b bg-card px-5 lg:hidden">
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-3 rounded-xl font-semibold focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background">
            <BookOpen className="h-4 w-4" />
          </span>
          Matter Stats
        </Link>
        <AccountMenu>
          <SettingsLink className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-muted" />
          <form action={logout}>
            <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-muted">
              <LogOut className="h-5 w-5" />
              Log out
            </button>
          </form>
        </AccountMenu>
      </header>
      <main className="mx-auto min-w-0 max-w-[88rem] px-5 pb-28 pt-8 sm:px-8 lg:ml-60 lg:px-12 lg:pb-14 lg:pt-12">
        {children}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <Suspense>
          <AppNavigation variant="mobile" />
        </Suspense>
      </div>
    </div>
  );
}
