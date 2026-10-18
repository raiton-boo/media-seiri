import { AppShell } from '../../components/AppShell';
import { FallbackLoader } from '../../components/fallback/FallbackLoader';

export default function FallbackPage() {
  return (
    <AppShell>
      <FallbackLoader />
    </AppShell>
  );
}
