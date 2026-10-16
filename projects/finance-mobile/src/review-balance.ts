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
  T extends {
    accountId: string;
    balanceAccountId: string;
    balanceAfter?: string;
    balanceNotice?: string;
  },
>(draft: T, patch: Partial<T>): T {
  const changed =
    patch.accountId !== undefined &&
    Boolean(draft.accountId) &&
    patch.accountId !== draft.accountId;
  const editing = "balanceAfter" in draft;
  return {
    ...draft,
    ...patch,
    balanceAccountId:
      editing && changed
        ? patch.accountId!
        : draft.balanceAccountId || draft.accountId || patch.accountId || "",
    ...(editing && changed
      ? {
          balanceAfter: "",
          balanceNotice: draft.balanceAfter
            ? "Reported balance cleared because the reporting account changed. Enter the new account's balance if known."
            : "",
        }
      : {}),
  };
}
