import { AppShell } from '../../components/AppShell';
import { ErrorsLoader } from '../../components/errors/ErrorsLoader';

export default function ErrorsPage() {
  return (
    <AppShell>
      <ErrorsLoader />
    </AppShell>
  );
}
