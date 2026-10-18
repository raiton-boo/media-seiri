import { AppShell } from '../components/AppShell';
import { DashboardLoader } from '../components/dashboard/DashboardLoader';

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardLoader />
    </AppShell>
  );
}
