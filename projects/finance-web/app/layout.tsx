import { PRODUCT_NAME } from "../../finance-contracts/presentation";
import type { Metadata, Viewport } from "next";

import { TransactionRecoveryProvider } from "@/components/transaction-recovery";
import { ToastProvider } from "@/components/toast-provider";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { BackendHeartbeat } from "@/components/backend-heartbeat";
import { ThemeProvider } from "@/components/theme-provider";

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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{var p=localStorage.getItem('finance.theme.v1');var t=p==='light'||p==='dark'?p:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}" }} /></head>
      <body><ThemeProvider><BackendHeartbeat /><ToastProvider><AuthProvider><TransactionRecoveryProvider><AppShell>{children}</AppShell></TransactionRecoveryProvider></AuthProvider></ToastProvider></ThemeProvider></body>
    </html>
  );
}
