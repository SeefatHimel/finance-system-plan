"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { formatCurrency, formatCalendarDate } from "../../finance-contracts/presentation";

export type ReportChartRow = { label: string; current: number; previous?: number };
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export function BreakdownChart({ rows, currency }: { rows: ReportChartRow[]; currency: string }) {
  return <div className="report-chart" role="img" aria-label="Largest net spending amounts. Exact amounts and transaction links follow the chart.">
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 42 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 0 }} accessibilityLayer>
        <CartesianGrid horizontal={false} stroke="var(--panel-border)" />
        <XAxis type="number" tickFormatter={compact} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" width={100} tickFormatter={label => label.length > 15 ? `${label.slice(0, 14)}…` : label} tick={{ fill: "var(--foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip formatter={value => formatCurrency(Number(value), currency)} contentStyle={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 8, color: "var(--foreground)" }} cursor={{ fill: "var(--accent-soft)" }} />
        <Bar dataKey="current" name="Net spending" fill="var(--accent)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function ActivityChart({ rows, currency, cash, monthly }: { rows: ReportChartRow[]; currency: string; cash: boolean; monthly: boolean }) {
  const dateLabel = (value: string) => monthly ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`)) : formatCalendarDate(value).slice(0, 5);
  return <div className="report-chart" role="img" aria-label={`${cash ? "Money in and money out" : "Earned income and net spending"} ${monthly ? "by month" : "by day"}. Use the table view for exact values.`}>
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 16, bottom: 0, right: 6, left: -10 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--panel-border)" />
        <XAxis dataKey="label" tickFormatter={dateLabel} minTickGap={28} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compact} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
        <ReferenceLine y={0} stroke="var(--muted)" />
        <Tooltip labelFormatter={label => monthly ? dateLabel(String(label)) : formatCalendarDate(String(label))} formatter={value => formatCurrency(Number(value), currency)} contentStyle={{ background: "var(--panel)", border: "1px solid var(--panel-border)", borderRadius: 8, color: "var(--foreground)" }} cursor={{ fill: "var(--accent-soft)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="current" name={cash ? "Money in" : "Earned income"} fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="previous" name={cash ? "Money out" : "Net spending"} fill="var(--info)" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
