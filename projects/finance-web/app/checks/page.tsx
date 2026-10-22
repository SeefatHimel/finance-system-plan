"use client";

import { TransactionIssueAudit } from "@/components/transaction-issue-audit";
import { useTransactionRecovery } from "@/components/transaction-recovery";

export default function EvidenceChecksPage() {
  const { edit, revalidate } = useTransactionRecovery();

  return <main className="main evidence-checks-page">
    <section className="panel">
      <div className="panel__body">
        <h2 className="section-title">Check saved evidence</h2>
        <p className="section-subtitle">Find direction, amount, balance and account disagreements between saved SMS, statement rows and ledger entries. A check never changes the ledger or original sources.</p>
        <TransactionIssueAudit
          onEdit={edit}
          onRevalidate={revalidate}
        />
      </div>
    </section>
  </main>;
}
