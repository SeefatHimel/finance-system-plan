import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/toast-provider";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { BackendHeartbeat } from "@/components/backend-heartbeat";

import "./globals.css";

export const metadata: Metadata = {
  title: "Finance System",
  description: "Personal finance dashboard for transactions, balances, and SMS review."
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><BackendHeartbeat /><ToastProvider><AuthProvider><AppShell>{children}</AppShell></AuthProvider></ToastProvider></body>
    </html>
  );
}
