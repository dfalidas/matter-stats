"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/activity", label: "Activity", icon: CalendarDays },
  { href: "/articles", label: "Library", icon: BookOpen },
  { href: "/reports", label: "Reports", icon: BarChart3 },
] as const;

export function AppNavigation({
  variant = "sidebar",
}: {
  className?: string;
  variant?: "sidebar" | "mobile";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = searchParams.get("period");
  return (
    <nav
      aria-label="Primary navigation"
      className={cn(variant === "mobile" ? "grid grid-cols-4" : "space-y-1")}
    >
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const ownQuery = active ? searchParams.toString() : "";
        const sharedPeriod = ownQuery
          ? `?${ownQuery}`
          : (href === "/dashboard" || href === "/activity") &&
              ["today", "week", "month", "year", "all-time"].includes(
                period ?? "",
              ) &&
              pathname !== "/reports"
            ? `?period=${encodeURIComponent(period!)}`
            : "";
        return (
          <Link
            key={href}
            href={`${href}${sharedPeriod}` as Route}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              variant === "mobile"
                ? "flex-col justify-center gap-1 px-1 py-2 text-[11px]"
                : "gap-3 px-3",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
