import { notFound } from "next/navigation";
import { CustomReportBuilder } from "@/components/custom-report-builder";
import { customReportPath, isCustomReportPathname } from "@/lib/report-navigation";

export default async function EditCustomReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCustomReportPathname(customReportPath(id))) notFound();
  return <div className="page-shell"><main className="main"><CustomReportBuilder key={id} id={id} /></main></div>;
}
