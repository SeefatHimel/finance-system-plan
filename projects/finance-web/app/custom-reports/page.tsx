import { redirect } from "next/navigation";
import { CustomReportLibrary } from "@/components/custom-report-library";
import { customReportPath } from "@/lib/report-navigation";

export default async function CustomReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (typeof params.saved_report === "string" && params.saved_report) redirect(customReportPath(params.saved_report));
  if (["start_date", "end_date", "month", "rules", "account", "currency"].some(key => typeof params[key] === "string")) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
    redirect(`/custom-reports/new?${query}`);
  }
  return <div className="page-shell"><main className="main"><CustomReportLibrary /></main></div>;
}
