import { AppShell } from '../../components/AppShell';
import { DupesLoader } from '../../components/dupes/DupesLoader';

export default function DupesPage() {
  return (
    <AppShell>
      <DupesLoader />
    </AppShell>
  );
}
