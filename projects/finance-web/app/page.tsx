import { getHealthStatus } from "@/lib/api";
import { DashboardWorkspace } from "@/components/dashboard-workspace";
import { Suspense } from "react";
import { LoadingState } from "@/components/loading-state";

async function Dashboard() {
  const health = await getHealthStatus();

  return <DashboardWorkspace health={health} />;
}

export default function HomePage() {
  return <Suspense fallback={<LoadingState label="Opening dashboard" />}><Dashboard /></Suspense>;
}
