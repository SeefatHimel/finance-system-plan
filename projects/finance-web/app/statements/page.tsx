import { StatementImportWorkspace } from "@/components/statement-import-workspace";

export default function StatementsPage({ searchParams }: { searchParams: { import?: string } }) {
  return <main className="main"><StatementImportWorkspace initialImportId={searchParams.import} /></main>;
}
