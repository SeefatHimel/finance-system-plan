import { getAccountStatements, getPeriodReport, getSavedReport, listAccounts, listCategories, listReportTransactions, listSavedReports, listTransactionPage, type TransactionFilters } from "./api";
import { readReport } from "./report-cache";

// Existing effects own their AbortController to ignore superseded results. The
// shared query owns the network signal so remounts can reuse an in-flight read.
export const reportAccounts: typeof listAccounts = token => readReport(["accounts"], signal => listAccounts(token, signal));
export const reportCategories: typeof listCategories = token => readReport(["categories"], signal => listCategories(token, signal));
export const savedReports: typeof listSavedReports = token => readReport(["library"], signal => listSavedReports(token, signal));
export const savedReport: typeof getSavedReport = (token, id) => readReport(["definition", id], signal => getSavedReport(token, id, signal));
export const periodReport: typeof getPeriodReport = (token, start, end, _signal, scope = {}) => readReport(["summary", start, end, scope], signal => getPeriodReport(token, start, end, signal, scope));
export const reportTransactions: typeof listReportTransactions = (token, id, scope, search, offset) => readReport(["membership", id, scope, search, offset], signal => listReportTransactions(token, id, scope, search, offset, signal));
export const accountStatements: typeof getAccountStatements = (token, id, account = "", offset = 0) => readReport(["statements", id, account, offset], signal => getAccountStatements(token, id, account, offset, signal));
export function reportDrillPage(token: string, filters: TransactionFilters, page: number) {
  return readReport(["drill", filters, page], signal => listTransactionPage(token, filters, page, 25, signal));
}
