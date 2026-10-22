"use client";

import { useRouter } from "next/navigation";

import { TransactionIssueAudit } from "@/components/transaction-issue-audit";

export default function EvidenceChecksPage() {
  const router = useRouter();

  return <main className="main evidence-checks-page">
    <section className="panel">
      <div className="panel__body">
        <h2 className="section-title">Check saved evidence</h2>
        <p className="section-subtitle">Find direction, amount, balance and account disagreements between saved SMS, statement rows and ledger entries. A check never changes the ledger or original sources.</p>
        <TransactionIssueAudit
          onEdit={id => router.push(`/transactions?edit=${encodeURIComponent(id)}`)}
          onRevalidate={id => router.push(`/transactions?revalidate=${encodeURIComponent(id)}`)}
        />
      </div>
    </section>
  </main>;
}
