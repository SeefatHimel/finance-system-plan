import { StatementImportWorkspace } from "@/components/statement-import-workspace";

export default async function StatementsPage({ searchParams: pendingParams }: { searchParams: Promise<{ import?: string; row?: string }> }) {
  const searchParams = await pendingParams;
  return <main className="main"><StatementImportWorkspace initialImportId={searchParams.import} initialRowId={searchParams.row} /></main>;
}
