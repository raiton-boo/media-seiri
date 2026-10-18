import { AppShell } from '../../components/AppShell';
import { RunsLoader } from '../../components/runs/RunsLoader';

export default function RunsPage() {
  return (
    <AppShell>
      <RunsLoader />
    </AppShell>
  );
}
