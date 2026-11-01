import {
  listAccounts, listCategories, listPaymentMethods, listTransactionPage, getTransactionTotals,
  type Account, type Category, type PaymentMethod, type Transaction, type TransactionFilters,
} from "./api";
import { transactionPage } from "./transaction-list";

export type TransactionData = {
  accounts: Account[]; categories: Category[]; paymentMethods: PaymentMethod[];
  transactions: Transaction[]; transactionCount: number;
  totals: Awaited<ReturnType<typeof getTransactionTotals>>;
  resultPage: number; resultSize: number; status: "ready";
};
export type TransactionLoadState = TransactionData | { status: "loading" } | { status: "error"; message: string };

const defaultApi = { listAccounts, listCategories, listPaymentMethods, listTransactionPage, getTransactionTotals };

/** One session-owned read; the caller owns cancellation and stale-result rejection. */
export async function loadTransactionData(
  token: string, filters: TransactionFilters, page: number, size: number,
  previous: TransactionData | null, refreshLookups: boolean, embedded: boolean,
  signal: AbortSignal, api = defaultApi,
): Promise<TransactionData> {
  async function loadPage() {
    let current = page;
    let result = await api.listTransactionPage(token, filters, current, size, signal);
    const bounded = transactionPage(result.count, current, size).current;
    if (current !== bounded) {
      current = bounded;
      result = await api.listTransactionPage(token, filters, current, size, signal);
    }
    return { transactions: result.results, transactionCount: result.count, resultPage: current, resultSize: size };
  }
  const [lookups, loadedPage, totals] = await Promise.all([
    previous && !refreshLookups ? Promise.resolve(previous) : Promise.all([
      api.listAccounts(token, signal), api.listCategories(token, signal), api.listPaymentMethods(token, signal),
    ]).then(([accounts, categories, paymentMethods]) => ({ accounts, categories, paymentMethods })),
    embedded ? Promise.resolve({transactions:[],transactionCount:0,resultPage:1,resultSize:size}) : loadPage(),
    embedded ? Promise.resolve([]) : api.getTransactionTotals(token, filters, signal),
  ]);
  return {...lookups, ...loadedPage, totals, status:"ready"};
}
