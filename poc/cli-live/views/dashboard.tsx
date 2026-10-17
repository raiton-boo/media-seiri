import { Box, Text } from 'ink';
import {
  formatDuration,
  formatLog,
  formatNumber,
  sparkline,
  spinnerFrame,
} from '../format.ts';
import { STAGES } from '../simulate.ts';
import { paint } from '../theme.ts';
import { Badge, ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 100;
const PERCENT = 100;
const BAR_MARGIN = 34;
const MIN_BAR_WIDTH = 10;
const MAX_BAR_WIDTH = 50;
const SPARKLINE_WIDTH = 40;
// 模擬の表示用。1 ファイルあたりの大きさ(MB)を、仮に 0.22 として、速さ(MB/s)を計算する
const SIMULATED_MEGABYTES_PER_FILE = 0.22;

/** 案 B: ダッシュボード(速度のグラフと、要注意の欄) */
export const DashboardView = ({
  snapshot,
  logs,
  alerts,
  history,
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
  const currentRate = history[history.length - 1] ?? 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={paint('blue')}
      paddingX={1}
      width={Math.min(columns, MAX_WIDTH)}
    >
      <Box justifyContent="space-between">
        <Text bold>
          <Text color={paint('blue')}>{spinnerFrame(elapsed)}</Text> file-seiri
          ingest <Text color={paint('pink')}>run #12</Text>
          <Text dimColor> Backup-copy ➜ PhotoLib</Text>
        </Text>
        <Text dimColor>
          経過 {formatDuration(elapsed)} / 残り ~{formatDuration(remaining)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <ProgressBar ratio={ratio} width={barWidth} from="blue" to="green" />
        <Text bold> {Math.floor(ratio * PERCENT)}%</Text>
        <Text dimColor>
          {' '}
          {formatNumber(snapshot.processed)} / {formatNumber(snapshot.total)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>速度 </Text>
        <Text color={paint('green')}>
          {sparkline(history, SPARKLINE_WIDTH)}
        </Text>
        <Text bold>
          {' '}
          {formatNumber(Math.round(currentRate))} ファイル/秒{' '}
          {(currentRate * SIMULATED_MEGABYTES_PER_FILE).toFixed(1)} MB/s
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={paint('green')}>
          採用 {formatNumber(counters.adopted)}
        </Text>
        <Text dimColor> │ </Text>
        <Text color={paint('blue')}>
          重複 {formatNumber(counters.duplicate)}
        </Text>
        <Text dimColor> │ </Text>
        <Text color={paint('orange')}>
          フォールバック {formatNumber(counters.fallback)}
        </Text>
        <Text dimColor> │ </Text>
        <Text color={paint('red')} bold>
          エラー {formatNumber(counters.error)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>処理中 </Text>
        <Text color={paint('yellow')}>{snapshot.currentFile}</Text>
      </Box>
      <Text>
        {STAGES.map((stage, index) => {
          const isCurrent = stage === snapshot.stage;
          return (
            <Text
              key={stage}
              bold={isCurrent}
              dimColor={!isCurrent}
              color={isCurrent ? paint('yellow') : undefined}
            >
              {index > 0 ? ' → ' : ''}
              {isCurrent ? `[${stage}]` : stage}
            </Text>
          );
        })}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={paint('orange')}>
          要注意(WARN・ERROR)
        </Text>
        {alerts.length === 0 ? <Text dimColor>なし</Text> : null}
        {alerts.map((log) => (
          <Text
            key={log.id}
            color={paint(log.level === 'ERROR' ? 'red' : 'orange')}
          >
            {formatLog(log)}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>
          最新のログ
        </Text>
        {logs.slice(-3).map((log) => (
          <Text key={log.id} dimColor>
            {formatLog(log)}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Badge
          label={isStopping ? '停止中' : 'Ctrl-C で、安全に停止'}
          background="yellow"
        />
      </Box>
    </Box>
  );
};
