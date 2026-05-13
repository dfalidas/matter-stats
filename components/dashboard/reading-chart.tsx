"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/types/matter";

export function ReadingChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="minutes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f5635c" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#f5635c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#8d95a3", fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#8d95a3", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              background: "#111722",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16,
              color: "#f4efe4",
            }}
          />
          <Area type="monotone" dataKey="minutes" stroke="#f5635c" strokeWidth={3} fill="url(#minutes)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
