import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BarChart3, BookOpenCheck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { logout } from "@/lib/auth-actions";

import "./globals.css";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/reports", label: "Reports" },
  { href: "/sources", label: "Sources" },
  { href: "/authors", label: "Authors" },
  { href: "/tags", label: "Tags" },
  { href: "/articles", label: "Articles" },
  { href: "/year-in-reading", label: "Year in Reading" },
  { href: "/settings", label: "Settings" },
];

export const metadata: Metadata = {
  title: "Matter Stats",
  description: "A private single-user reading analytics dashboard for Matter.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <TooltipProvider delayDuration={150}>
          <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 lg:px-8">
            <header className="mb-8 rounded-3xl border border-white/10 bg-card/75 p-4 shadow-soft backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <Link href="/dashboard" className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                    <BookOpenCheck className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <p className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                      Matter Stats <Badge variant="secondary">Private</Badge>
                    </p>
                    <p className="text-sm text-muted-foreground">Dark-first reading analytics</p>
                  </div>
                </Link>
                <div className="flex flex-col gap-4 lg:items-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="secondary" size="sm" className="w-fit">
                        <BarChart3 aria-hidden /> Ready for charts
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Recharts is wired for dashboard visualizations.</TooltipContent>
                  </Tooltip>
                  <Separator className="lg:hidden" />
                  <div className="flex flex-wrap items-center gap-2">
                    <nav aria-label="Primary navigation" className="flex flex-wrap gap-2">
                      {navigation.map((item) => (
                        <Button key={item.href} asChild variant="ghost" size="sm">
                          <Link href={item.href}>{item.label}</Link>
                        </Button>
                      ))}
                    </nav>
                    <form action={logout}>
                      <Button type="submit" variant="outline" size="sm">
                        Log out
                      </Button>
                    </form>
                  </div>
                </div>
              </div>
            </header>
            <main className="flex-1">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
