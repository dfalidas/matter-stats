import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
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
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 lg:px-8">
          <header className="mb-8 rounded-3xl border border-white/70 bg-white/75 p-4 shadow-soft backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <Link href="/dashboard" className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-matter text-lg font-black text-white">
                  M
                </span>
                <div>
                  <p className="text-lg font-semibold tracking-tight text-ink">Matter Stats</p>
                  <p className="text-sm text-slate-500">Private reading analytics</p>
                </div>
              </Link>
              <nav aria-label="Primary navigation" className="flex flex-wrap gap-2">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-900 hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
