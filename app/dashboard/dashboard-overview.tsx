"use client";

import { format, subDays } from "date-fns";
import { Activity, Clock, Flame, Newspaper } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { SyncMatterButton } from "./sync-matter-button";

const metrics = [
  { label: "Articles read", value: "0", helper: "Awaiting your first import", icon: Newspaper },
  { label: "Reading time", value: "0h", helper: "Tracked across sessions", icon: Clock },
  { label: "Top source", value: "—", helper: "Ranked after sync", icon: Activity },
  { label: "Current streak", value: "0 days", helper: "Daily reading momentum", icon: Flame },
];

const readingTrend = Array.from({ length: 7 }, (_, index) => {
  const date = subDays(new Date(), 6 - index);

  return {
    date: format(date, "MMM d"),
    articles: 0,
    minutes: 0,
  };
});

const recentActivity = [
  { title: "Import Matter archive", source: "Setup", status: "Pending" },
  { title: "Connect Supabase", source: "Settings", status: "Ready" },
  { title: "Review reading trends", source: "Dashboard", status: "Waiting" },
];

export function DashboardOverview() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-background/45 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Manual Matter import</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetch the latest Matter library, reading sessions, tags, and annotations into Supabase.
          </p>
        </div>
        <SyncMatterButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <Card key={metric.label} className="border-white/10 bg-background/45">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{metric.label}</CardDescription>
                <Icon className="h-4 w-4 text-primary" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-foreground">{metric.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{metric.helper}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList>
            <TabsTrigger value="trend">Trend</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="loading">Loading state</TabsTrigger>
          </TabsList>
          <Input className="md:max-w-xs" placeholder="Filter articles after import..." aria-label="Filter articles" />
        </div>

        <TabsContent value="trend">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Reading trend</CardTitle>
                  <CardDescription>Grouped and formatted with date-fns for the latest seven-day window.</CardDescription>
                </div>
                <Badge variant="outline">Recharts</Badge>
              </div>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={readingTrend} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Area type="monotone" dataKey="articles" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.22)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Placeholder rows until Matter import data is available.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.map((activity) => (
                    <TableRow key={activity.title}>
                      <TableCell className="font-medium">{activity.title}</TableCell>
                      <TableCell>{activity.source}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{activity.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loading">
          <Card className="border-white/10 bg-background/45">
            <CardHeader>
              <CardTitle>Reusable skeletons</CardTitle>
              <CardDescription>Dark-mode loading primitives for future Supabase queries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-5 w-4/5" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
