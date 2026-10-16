import { PRODUCT_NAME } from "../../finance-contracts/presentation";
import type { Metadata, Viewport } from "next";

import { TransactionRecoveryProvider } from "@/components/transaction-recovery";
import { ToastProvider } from "@/components/toast-provider";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { BackendHeartbeat } from "@/components/backend-heartbeat";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: PRODUCT_NAME,
  title: PRODUCT_NAME,
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
      <body><BackendHeartbeat /><ToastProvider><AuthProvider><TransactionRecoveryProvider><AppShell>{children}</AppShell></TransactionRecoveryProvider></AuthProvider></ToastProvider></body>
    </html>
  );
}
