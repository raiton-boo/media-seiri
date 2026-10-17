import { Box, Text } from 'ink';
import { formatDuration, formatNumber } from '../format.ts';
import { paint } from '../theme.ts';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 90;
const PERCENT = 100;
const BAR_WIDTH = 44;

/** 案 H: レトロ(青い背景に白の二重線。昔の DOS のツール風) */
export const RetroView = ({
  snapshot,
  logs,
  elapsed,
  remaining,
  isStopping,
  columns,
}: ViewProps) => {
  const { counters } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const filled = Math.floor(ratio * BAR_WIDTH);
  const blue = paint('dosBlue');

  return (
    <Box flexDirection="column" width={Math.min(columns, MAX_WIDTH)}>
      <Box
        backgroundColor={paint('dosCyan')}
        justifyContent="space-between"
        paddingX={1}
      >
        <Text color={paint('ink')}>ファイル 取り込み 表示 ヘルプ</Text>
        <Text color={paint('ink')}>FILE-SEIRI 0.1</Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={paint('paper')}
        borderBackgroundColor={blue}
        backgroundColor={blue}
        paddingX={1}
      >
        <Box justifyContent="center">
          <Text backgroundColor={paint('paper')} color={paint('dosBlue')}>
            {' '}
            取り込み中 run #12{' '}
          </Text>
        </Box>
        <Text color={paint('yellow')} backgroundColor={blue}>
          Backup-copy ➜ PhotoLib
        </Text>
        <Text backgroundColor={blue}> </Text>
        <Text color={paint('paper')} backgroundColor={blue}>
          [<Text color={paint('yellow')}>{'■'.repeat(filled)}</Text>
          <Text color={paint('dosCyan')}>{'░'.repeat(BAR_WIDTH - filled)}</Text>
          ] {Math.floor(ratio * PERCENT)}%
        </Text>
        <Text color={paint('dosCyan')} backgroundColor={blue}>
          {formatNumber(snapshot.processed)} / {formatNumber(snapshot.total)} 件
          · 経過 {formatDuration(elapsed)} · 残り {formatDuration(remaining)}
        </Text>
        <Text backgroundColor={blue}> </Text>
        <Text color={paint('paper')} backgroundColor={blue}>
          採用 {formatNumber(counters.adopted)} 重複{' '}
          {formatNumber(counters.duplicate)} フォールバック{' '}
          {formatNumber(counters.fallback)} エラー{' '}
          {formatNumber(counters.error)}
        </Text>
        <Text color={paint('yellow')} backgroundColor={blue}>
          処理中: {snapshot.currentFile}
        </Text>
        <Text backgroundColor={blue}> </Text>
        {logs.slice(-4).map((log) => (
          <Text
            key={log.id}
            color={paint(log.level === 'INFO' ? 'dosCyan' : 'yellow')}
            backgroundColor={blue}
          >
            {log.time} {log.level.padEnd(5)} {log.message}
          </Text>
        ))}
      </Box>
      <Box>
        <Text backgroundColor={paint('dosCyan')} color={paint('ink')}>
          {isStopping ? ' 停止中… ' : ' Ctrl-C '}
        </Text>
        <Text color={paint('paper')}> 安全に停止して終了</Text>
      </Box>
    </Box>
  );
};
