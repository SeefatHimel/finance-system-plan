/** A parser balance is evidence about its reporting account, not the transfer path. */
export function reviewReportedBalance(
  balance: string | null,
  reportingAccount: string,
  selectedAccount: string,
): string | null {
  if (
    !selectedAccount ||
    (reportingAccount && reportingAccount !== selectedAccount)
  )
    return null;
  // The first explicit account selection binds an otherwise unassigned parser value.
  return balance;
}

export function updateReviewBalanceContext<
  T extends { accountId: string; balanceAccountId: string },
>(draft: T, patch: Partial<T>): T {
  return {
    ...draft,
    ...patch,
    balanceAccountId:
      draft.balanceAccountId || draft.accountId || patch.accountId || "",
  };
}
