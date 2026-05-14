import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { AppShell } from "./_components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matter Stats",
  description: "A private single-user reading analytics dashboard for Matter.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <TooltipProvider delayDuration={150}>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
