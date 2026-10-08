"use client";

import { useState } from "react";
import type { Category, TransactionType } from "@/lib/api";
import { categoryTypeProposal, type CategoryTypeProposal } from "@/lib/category-type";
import { CategoryTypeDialog } from "@/components/category-type-dialog";

type Apply = (categoryId: string, type: TransactionType) => void;

export function useCategoryTypeChoice(categories: Category[]) {
  const [pending, setPending] = useState<{ proposal: CategoryTypeProposal; apply: Apply } | null>(null);
  function choose(categoryId: string, type: TransactionType, apply: Apply) {
    const proposal = categoryTypeProposal(categories.find((item) => item.id === categoryId), type);
    if (proposal) setPending({ proposal, apply });
    else apply(categoryId, type);
  }
  function accept(type: TransactionType) {
    if (!pending) return;
    pending.apply(pending.proposal.categoryId, type);
    setPending(null);
  }
  return {
    choose,
    confirmation: pending ? <CategoryTypeDialog key={pending.proposal.categoryId} proposal={pending.proposal} onCancel={() => setPending(null)} onKeepType={() => accept(pending.proposal.currentType)} onChangeType={accept} /> : null
  };
}
