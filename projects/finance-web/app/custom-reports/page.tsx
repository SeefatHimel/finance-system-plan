import { redirect } from "next/navigation";
import { CustomReportLibrary } from "@/components/custom-report-library";
import { customReportPath } from "@/lib/report-navigation";

export default async function CustomReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (typeof params.saved_report === "string" && params.saved_report) redirect(customReportPath(params.saved_report));
  return <div className="page-shell"><main className="main"><CustomReportLibrary /></main></div>;
}
