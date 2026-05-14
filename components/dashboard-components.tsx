"use client";

import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, ArrowRight, FileText, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type Accent = "red" | "violet" | "blue" | "green" | "amber";

const accentClasses: Record<Accent, { text: string; bg: string; border: string; fill: string }> = {
  red: {
    text: "text-accent-red",
    bg: "bg-accent-red/10",
    border: "border-accent-red/20",
    fill: "bg-accent-red",
  },
  violet: {
    text: "text-accent-violet",
    bg: "bg-accent-violet/10",
    border: "border-accent-violet/20",
    fill: "bg-accent-violet",
  },
  blue: {
    text: "text-accent-blue",
    bg: "bg-accent-blue/10",
    border: "border-accent-blue/20",
    fill: "bg-accent-blue",
  },
  green: {
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/20",
    fill: "bg-success",
  },
  amber: {
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/20",
    fill: "bg-warning",
  },
};

export type DashboardIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export type MetricCardProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  icon?: DashboardIcon;
  accent?: Accent;
  trend?: ReactNode;
};

export function MetricCard({ label, value, helper, icon: Icon, accent = "red", trend, className, ...props }: MetricCardProps) {
  const styles = accentClasses[accent];

  return (
    <Card className={cn("border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur", className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardDescription className="text-dashboard-muted">{label}</CardDescription>
        {Icon ? (
          <span className={cn("rounded-xl border p-2", styles.border, styles.bg)}>
            <Icon className={cn("h-4 w-4", styles.text)} aria-hidden />
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-3">
          <p className="text-3xl font-bold tracking-tight text-dashboard-text">{value}</p>
          {trend ? <div className="text-sm font-medium text-dashboard-muted">{trend}</div> : null}
        </div>
        {helper ? <p className="mt-2 text-sm text-dashboard-muted">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}

export type ChartCardProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
};

export function ChartCard({ title, description, badge, action, children, className, contentClassName, ...props }: ChartCardProps) {
  return (
    <Card className={cn("border-dashboard-border bg-dashboard-card/80 shadow-soft backdrop-blur", className)} {...props}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-dashboard-text">{title}</CardTitle>
            {description ? <CardDescription className="mt-1 text-dashboard-muted">{description}</CardDescription> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {badge ? <Badge variant="outline" className="border-dashboard-border text-dashboard-muted">{badge}</Badge> : null}
            {action}
          </div>
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export type RankingListItem = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  accent?: Accent;
};

export type RankingListProps = HTMLAttributes<HTMLDivElement> & {
  items: RankingListItem[];
  maxValue?: number;
};

export function RankingList({ items, maxValue, className, ...props }: RankingListProps) {
  const peak = maxValue ?? Math.max(...items.map((item) => Number(item.value) || 0), 1);

  return (
    <div className={cn("space-y-3", className)} {...props}>
      {items.map((item, index) => {
        const accent = accentClasses[item.accent ?? "violet"];
        const numericValue = Number(item.value) || 0;
        const width = `${Math.max(6, Math.min(100, (numericValue / peak) * 100))}%`;

        return (
          <div key={item.id} className="rounded-2xl border border-dashboard-border bg-background/35 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-dashboard-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-dashboard-text">{item.label}</p>
                  {item.helper ? <p className="truncate text-xs text-dashboard-muted">{item.helper}</p> : null}
                </div>
              </div>
              <span className={cn("text-sm font-semibold", accent.text)}>{item.value}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/70">
              <div className={cn("h-full rounded-full", accent.fill)} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type ArticleRowProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  source?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  tags?: ReactNode[];
  href?: string;
};

export function ArticleRow({ title, source, meta, status, tags = [], href, className, ...props }: ArticleRowProps) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-dashboard-text">{title}</h3>
          {status ? <Badge className="bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/15">{status}</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dashboard-muted">
          {source ? <span>{source}</span> : null}
          {source && meta ? <span aria-hidden>•</span> : null}
          {meta ? <span>{meta}</span> : null}
        </div>
        {tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag, index) => (
              <Badge key={index} variant="secondary" className="bg-muted/70 text-dashboard-muted">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {href ? <ArrowRight className="h-4 w-4 shrink-0 text-dashboard-muted" aria-hidden /> : null}
    </>
  );

  const classes = cn(
    "flex items-center gap-3 rounded-2xl border border-dashboard-border bg-background/35 p-4 transition-colors hover:bg-muted/35",
    className
  );

  if (href) {
    return (
      <a href={href} className={classes} {...(props as HTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  return (
    <div className={classes} {...props}>
      {content}
    </div>
  );
}

export type HeatmapGridItem = {
  id: string;
  label: string;
  value: number;
  ariaLabel?: string;
};

export type HeatmapGridProps = HTMLAttributes<HTMLDivElement> & {
  items: HeatmapGridItem[];
  maxValue?: number;
  accent?: Accent;
};

export function HeatmapGrid({ items, maxValue, accent = "red", className, ...props }: HeatmapGridProps) {
  const peak = maxValue ?? Math.max(...items.map((item) => item.value), 1);
  const accentVariable = {
    red: "var(--accent-red)",
    violet: "var(--accent-violet)",
    blue: "var(--accent-blue)",
    green: "var(--success)",
    amber: "var(--warning)",
  }[accent];

  return (
    <div className={cn("grid grid-cols-7 gap-2", className)} {...props}>
      {items.map((item) => {
        const intensity = item.value <= 0 ? 0.08 : Math.min(0.95, 0.18 + (item.value / peak) * 0.7);

        return (
          <div
            key={item.id}
            title={`${item.label}: ${item.value}`}
            aria-label={item.ariaLabel ?? `${item.label}: ${item.value}`}
            className="aspect-square rounded-lg border border-dashboard-border"
            style={{ backgroundColor: `hsl(${accentVariable} / ${intensity})` }}
          />
        );
      })}
    </div>
  );
}

export type PeriodOption = {
  value: string;
  label: ReactNode;
};

export type PeriodSelectorProps = {
  value: string;
  options: PeriodOption[];
  onValueChange?: (value: string) => void;
  className?: string;
  label?: string;
};

export function PeriodSelector({ value, options, onValueChange, className, label = "Select period" }: PeriodSelectorProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList aria-label={label} className="bg-muted/70">
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="data-[state=active]:bg-card">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export type SyncButtonProps = ButtonProps & {
  isSyncing?: boolean;
  syncingLabel?: ReactNode;
  idleLabel?: ReactNode;
};

export function SyncButton({ isSyncing = false, syncingLabel = "Syncing...", idleLabel = "Sync", disabled, children, ...props }: SyncButtonProps) {
  return (
    <Button disabled={disabled || isSyncing} {...props}>
      {isSyncing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {children ?? (isSyncing ? syncingLabel : idleLabel)}
    </Button>
  );
}

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: DashboardIcon;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon: Icon = FileText, action, className, ...props }: EmptyStateProps) {
  return (
    <div className={cn("rounded-3xl border border-dashed border-dashboard-border bg-dashboard-card/50 p-8 text-center", className)} {...props}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-dashboard-muted">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-4 text-base font-semibold text-dashboard-text">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm text-dashboard-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export type ErrorStateProps = EmptyStateProps & {
  message?: ReactNode;
};

export function ErrorState({ title, description, message, icon = AlertTriangle, className, ...props }: ErrorStateProps) {
  return (
    <EmptyState
      title={title}
      description={
        <>
          {description}
          {message ? (
            <>
              {description ? <br /> : null}
              <span className="text-destructive">{message}</span>
            </>
          ) : null}
        </>
      }
      icon={icon}
      className={cn("border-destructive/25 bg-destructive/5", className)}
      role="alert"
      {...props}
    />
  );
}

export type LoadingSkeletonProps = HTMLAttributes<HTMLDivElement> & {
  rows?: number;
  variant?: "card" | "chart" | "list";
};

export function LoadingSkeleton({ rows = 3, variant = "card", className, ...props }: LoadingSkeletonProps) {
  return (
    <div className={cn("rounded-3xl border border-dashboard-border bg-dashboard-card/70 p-5", className)} {...props}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-44" />
        </div>
        <Skeleton className="h-10 w-10 rounded-2xl" />
      </div>
      <Separator className="my-5 bg-dashboard-border" />
      {variant === "chart" ? <Skeleton className="h-48 w-full rounded-2xl" /> : null}
      <div className={cn("space-y-3", variant === "chart" ? "mt-4" : undefined)}>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              {variant === "list" ? <Skeleton className="h-3 w-2/3" /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
