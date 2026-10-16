import type { ReviewDraft } from "./review-fields";
import type { Account, Category, PaymentMethod } from "./api";
import {
  formatCalendarDate,
  formatClockTime,
} from "../../finance-contracts/presentation";
import { categoryTypes, transactionTypes } from "./transaction-draft";
export function reviewDraftError(
  draft: ReviewDraft,
  accounts: Account[],
  categories: Category[],
  methods: PaymentMethod[],
) {
  if (!["debit", "credit"].includes(draft.direction))
    return "Choose debit or credit.";
  if (!transactionTypes.includes(draft.transactionType))
    return "Choose a transaction type.";
  if (
    !accounts.some(
      (item) => item.id === draft.accountId && item.is_active !== false,
    )
  )
    return "Choose an active reporting account.";
  if (
    draft.transactionType === "transfer" &&
    (!draft.transferAccountId ||
      draft.transferAccountId === draft.accountId ||
      !accounts.some(
        (item) =>
          item.id === draft.transferAccountId && item.is_active !== false,
      ))
  )
    return "Choose a different active transfer account.";
  const amount = draft.amount.trim().replaceAll(",", "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || !/[1-9]/.test(amount))
    return "Enter a positive amount with up to two decimal places.";
  if (
    draft.balanceAfter.trim() &&
    !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(
      draft.balanceAfter.trim().replaceAll(",", ""),
    )
  )
    return "Enter a valid reported balance, or leave it blank.";
  if (formatCalendarDate(draft.date) === "Unknown date")
    return "Choose a valid transaction date.";
  if (draft.time && formatClockTime(draft.time) === "Not reported")
    return "Enter a valid time, or leave it blank if unknown.";
  const category = categories.find((item) => item.id === draft.categoryId);
  if (draft.categoryId && (!category || category.is_active === false))
    return "Choose an active category, or no category.";
  const allowed = categoryTypes(category?.kind);
  if (allowed && !allowed.includes(draft.transactionType))
    return "Choose a category that fits this transaction type.";
  if (
    draft.paymentMethodId &&
    !methods.some(
      (item) =>
        item.id === draft.paymentMethodId && item.account === draft.accountId,
    )
  )
    return "Choose a payment method for the reporting account, or none.";
  return "";
}
