import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/toast-provider";
import { AppShell } from "@/components/app-shell";

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
      <body><ToastProvider><AppShell>{children}</AppShell></ToastProvider></body>
    </html>
  );
}
