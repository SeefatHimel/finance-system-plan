import { notFound } from "next/navigation";
import { CustomReportDetail } from "@/components/custom-report-detail";
import { customReportPath, isCustomReportPathname } from "@/lib/report-navigation";

export default async function CustomReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCustomReportPathname(customReportPath(id))) notFound();
  return <div className="page-shell"><main className="main"><CustomReportDetail key={id} id={id} /></main></div>;
}
