import { getHealthStatus } from "@/lib/api";
import { DashboardWorkspace } from "@/components/dashboard-workspace";

export default async function HomePage() {
  const health = await getHealthStatus();

  return <DashboardWorkspace health={health} />;
}
