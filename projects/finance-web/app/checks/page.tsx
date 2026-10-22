"use client";

import { TransactionIssueAudit } from "@/components/transaction-issue-audit";
import { useTransactionRecovery } from "@/components/transaction-recovery";

export default function EvidenceChecksPage() {
  const { edit, revalidate } = useTransactionRecovery();

  return <main className="main evidence-checks-page">
    <section className="panel">
      <div className="panel__body">
        <h2 className="section-title">Evidence health</h2>
        <p className="section-subtitle">First update recoverable directions in older saved evidence. Then scan ledger entries for disagreements. Nothing changes a ledger entry until you review and apply a correction.</p>
        <TransactionIssueAudit
          onEdit={edit}
          onRevalidate={revalidate}
        />
      </div>
    </section>
  </main>;
}
