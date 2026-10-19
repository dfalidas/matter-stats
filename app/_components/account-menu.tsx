"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";

export function SettingsLink({ className }: { className: string }) {
  const pathname = usePathname();
  return (
    <Link
      href="/settings"
      aria-current={pathname === "/settings" ? "page" : undefined}
      className={`${className} aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary`}
    >
      <Settings className="h-5 w-5" aria-hidden />
      Settings
    </Link>
  );
}

export function AccountMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target) &&
        ref.current
      )
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border px-3 text-sm font-medium">
        Account
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-48 rounded-xl border bg-card p-2 shadow-sm">
        {children}
      </div>
    </details>
  );
}
