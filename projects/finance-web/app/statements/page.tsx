import { StatementImportWorkspace } from "@/components/statement-import-workspace";

export default function StatementsPage({ searchParams }: { searchParams: { import?: string; row?: string } }) {
  return <main className="main"><StatementImportWorkspace initialImportId={searchParams.import} initialRowId={searchParams.row} /></main>;
}
