import type { ReactNode } from "react";

type PageShellProps = {
  title: string;
  eyebrow: string;
  description: string;
  children?: ReactNode;
};

export function PageShell({ title, eyebrow, description, children }: PageShellProps) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-soft backdrop-blur md:p-10">
      <p className="text-sm font-semibold uppercase tracking-[0.26em] text-matter">{eyebrow}</p>
      <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-ink md:text-6xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">{description}</p>
      {children ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}
