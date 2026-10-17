import { Box, Text } from 'ink';
import { formatDuration, formatNumber, spinnerFrame } from '../format.ts';
import { STAGES } from '../simulate.ts';
import { type ColorName, paint } from '../theme.ts';
import { BANNER_LINES } from './banner.ts';
import { Badge, ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 100;
const PERCENT = 100;
const BAR_MARGIN = 38;
const MIN_BAR_WIDTH = 10;
const MAX_BAR_WIDTH = 48;

const LEVEL_BADGES: Record<
  string,
  { background: ColorName; foreground: ColorName }
> = {
  INFO: { background: 'paper', foreground: 'ink' },
  WARN: { background: 'orange', foreground: 'ink' },
  ERROR: { background: 'red', foreground: 'paper' },
};

/** 案 A: ネオブルータリズム(Web 画面と同じ配色・同じ世界観) */
export const NeoView = ({
  snapshot,
  logs,
  elapsed,
  remaining,
  isStopping,
  columns,
}: ViewProps) => {
  const { counters } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, columns - BAR_MARGIN)
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="bold"
      borderColor={paint('yellow')}
      paddingX={1}
      width={Math.min(columns, MAX_WIDTH)}
    >
      {BANNER_LINES.map((line) => (
        <Text key={line} color={paint('yellow')}>
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Badge label="ingest" background="yellow" />
        <Text> </Text>
        <Badge label="run #12" background="pink" />
        <Text bold> Backup-copy ➜ PhotoLib</Text>
        <Text dimColor>
          {'  '}経過 {formatDuration(elapsed)} 残り ~{formatDuration(remaining)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text bold>進捗 </Text>
        <ProgressBar ratio={ratio} width={barWidth} from="pink" to="yellow" />
        <Text bold> {Math.floor(ratio * PERCENT)}%</Text>
        <Text dimColor>
          {' '}
          {formatNumber(snapshot.processed)} / {formatNumber(snapshot.total)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Badge
          label={`採用 ${formatNumber(counters.adopted)}`}
          background="green"
        />
        <Text> </Text>
        <Badge
          label={`重複 ${formatNumber(counters.duplicate)}`}
          background="blue"
        />
        <Text> </Text>
        <Badge
          label={`フォールバック ${formatNumber(counters.fallback)}`}
          background="orange"
        />
        <Text> </Text>
        <Badge
          label={`エラー ${formatNumber(counters.error)}`}
          background="red"
          foreground="paper"
        />
      </Box>
      <Box marginTop={1}>
        <Text color={paint('yellow')}>{spinnerFrame(elapsed)} </Text>
        <Text>処理中 </Text>
        <Text bold color={paint('yellow')}>
          {snapshot.currentFile}
        </Text>
      </Box>
      <Text>
        {STAGES.map((stage, index) => (
          <Text
            key={stage}
            bold={stage === snapshot.stage}
            dimColor={stage !== snapshot.stage}
          >
            {index > 0 ? ' ─ ' : ''}
            {stage === snapshot.stage ? `▶ ${stage}` : stage}
          </Text>
        ))}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {logs.map((log) => {
          const badge = LEVEL_BADGES[log.level] ?? LEVEL_BADGES.INFO;
          return (
            <Box key={log.id}>
              <Text dimColor>{log.time} </Text>
              <Badge
                label={log.level.padEnd(5)}
                background={badge?.background ?? 'paper'}
                foreground={badge?.foreground ?? 'ink'}
              />
              <Text> {log.message}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {isStopping
            ? '停止しています…'
            : 'Ctrl-C: 安全に停止して終了(終了コード 130)'}
        </Text>
      </Box>
    </Box>
  );
};
