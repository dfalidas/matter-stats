"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpenText, FileText, Gauge, Settings, Sparkles, Tags, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/sources", label: "Sources", icon: BookOpenText },
  { href: "/authors", label: "Authors", icon: Users },
  { href: "/tags", label: "Tags", icon: Tags },
  { href: "/articles", label: "Articles", icon: FileText },
  { href: "/year-in-reading", label: "Year in Reading", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppNavigation({ className, variant = "sidebar" }: { className?: string; variant?: "sidebar" | "mobile" }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className={cn(variant === "mobile" ? "flex gap-2 overflow-x-auto pb-1" : "space-y-1.5", className)}>
      {navigation.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-2xl border text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
              variant === "mobile" ? "min-w-fit px-3.5 py-2.5" : "px-3.5 py-3",
              isActive
                ? "border-primary/35 bg-primary/15 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_14px_40px_hsl(var(--primary)/0.08)]"
                : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/[0.04] hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "bg-white/[0.04] text-muted-foreground group-hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
