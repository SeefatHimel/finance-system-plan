import { QuickAddShortcuts } from "@/components/quick-add";
import { getHealthStatus } from "@/lib/api";
import { DashboardWorkspace } from "@/components/dashboard-workspace";

export default async function HomePage() {
  const health = await getHealthStatus();

  return <div className="workspace-grid"><QuickAddShortcuts /><DashboardWorkspace health={health} /></div>;
}
