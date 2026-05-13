"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { cn } from "@/lib/utils";

type PageShellProps = {
  title: string;
  eyebrow: string;
  description: string;
  children?: ReactNode;
  className?: string;
};

export function PageShell({ title, eyebrow, description, children, className }: PageShellProps) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}>
      <Card className={cn("overflow-hidden border-white/10 bg-card/80 shadow-soft backdrop-blur", className)}>
        <CardHeader className="p-6 md:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.26em] text-primary">{eyebrow}</p>
          <CardTitle className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-6xl">
            {title}
          </CardTitle>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">{description}</p>
        </CardHeader>
        {children ? <CardContent className="px-6 pb-6 md:px-10 md:pb-10">{children}</CardContent> : null}
      </Card>
    </motion.section>
  );
}
