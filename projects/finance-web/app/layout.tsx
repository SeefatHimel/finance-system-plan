import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance System",
  description: "Personal finance dashboard for transactions, balances, and SMS review."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

