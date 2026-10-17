import { Box, Text } from 'ink';
import { formatDuration, formatLog, formatNumber } from '../format.ts';
import { paint } from '../theme.ts';
import { ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const PERCENT = 100;
const BAR_WIDTH = 24;
const SIMULATED_MEGABYTES_PER_FILE = 0.22;

/** 案 C: ミニマル(枠なし、控えめな色、数行) */
export const MinimalView = ({
  snapshot,
  alerts,
  history,
  elapsed,
  remaining,
  isStopping,
}: ViewProps) => {
  const { counters } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const currentRate = history[history.length - 1] ?? 0;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>file-seiri ingest</Text>
        <Text dimColor> · run #12 · Backup-copy ➜ PhotoLib</Text>
      </Text>
      <Text>
        <ProgressBar ratio={ratio} width={BAR_WIDTH} from="green" to="green" />
        <Text bold> {Math.floor(ratio * PERCENT)}%</Text>
        <Text dimColor>
          {' '}
          {formatNumber(snapshot.processed)} / {formatNumber(snapshot.total)} ·{' '}
          {(currentRate * SIMULATED_MEGABYTES_PER_FILE).toFixed(1)} MB/s ·{' '}
          {formatDuration(elapsed)} · 残り ~{formatDuration(remaining)}
        </Text>
      </Text>
      <Text>
        <Text color={paint('green')}>
          採用 {formatNumber(counters.adopted)}
        </Text>
        <Text dimColor> · </Text>
        <Text color={paint('blue')}>
          重複 {formatNumber(counters.duplicate)}
        </Text>
        <Text dimColor> · </Text>
        <Text color={paint('orange')}>
          フォールバック {formatNumber(counters.fallback)}
        </Text>
        <Text dimColor> · </Text>
        <Text color={paint('red')}>エラー {formatNumber(counters.error)}</Text>
      </Text>
      <Text dimColor>▸ {snapshot.currentFile}</Text>
      {alerts.slice(-2).map((log) => (
        <Text
          key={log.id}
          color={paint(log.level === 'ERROR' ? 'red' : 'orange')}
        >
          {formatLog(log)}
        </Text>
      ))}
      {isStopping ? <Text dimColor>停止しています…</Text> : null}
    </Box>
  );
};
