import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageShell({ title, eyebrow, description, children, className }: { title: string; eyebrow: string; description: string; children?: ReactNode; className?: string }) {
  return <section className={cn("mx-auto w-full max-w-6xl", className)}>
    <header className="mb-8 border-b pb-7"><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-primary">{eyebrow}</p><h1 className="text-4xl font-semibold tracking-[-.04em] text-foreground sm:text-5xl">{title}</h1><p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p></header>
    {children}
  </section>;
}
