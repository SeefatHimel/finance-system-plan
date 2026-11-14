"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type ReportDrill = (extra: Record<string, string>, label: string) => void;
export function ReportDrillLink({ href, extra = {}, label, onDrill, children, className }: { href: string; extra?: Record<string, string>; label: string; onDrill?: ReportDrill; children: ReactNode; className?: string }) {
  return <Link href={href} className={className} onClick={event => {
    if (!onDrill || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); onDrill(extra, label);
  }}>{children}</Link>;
}
