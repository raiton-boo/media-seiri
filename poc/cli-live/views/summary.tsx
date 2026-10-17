import { Box, Text } from 'ink';
import { formatDuration, formatGigabytes, formatNumber } from '../format.ts';
import type { Snapshot } from '../simulate.ts';
import { paint } from '../theme.ts';
import { Badge, Panel } from './parts.tsx';

type SummaryProps = {
  snapshot: Snapshot;
  elapsed: number;
  interrupted: boolean;
  /** カードの幅(端末の幅) */
  width: number;
};

const PERCENT = 100;
const MILLISECONDS_PER_SECOND = 1000;
const MEGABYTE = 1024 * 1024;

/** 実行の最後に出す、結果のカード(`cli-logging.md` §10)。背景を塗り、透明な端末でも読めるようにする */
export const Summary = ({
  snapshot,
  elapsed,
  interrupted,
  width,
}: SummaryProps) => {
  const { counters, types, dateSources } = snapshot;
  const text = paint('text');
  const subtle = paint('subtle');
  const seconds = Math.max(elapsed / MILLISECONDS_PER_SECOND, 1);
  const averageSpeed = snapshot.bytesProcessed / MEGABYTE / seconds;
  const adopted = Math.max(counters.adopted, 1);

  return (
    <Panel
      title={`result · ${interrupted ? '中断' : '完了'}`}
      width={width}
      color={interrupted ? 'orange' : 'matrix'}
      background="panel"
    >
      <Box>
        <Badge
          label={interrupted ? '中断' : '完了'}
          background={interrupted ? 'orange' : 'green'}
        />
        <Text color={text} bold>
          {' '}
          {formatNumber(snapshot.processed)} / {formatNumber(snapshot.total)} 件
        </Text>
        <Text color={subtle}>
          {' '}
          所要時間 {formatDuration(elapsed)} ·{' '}
          {formatGigabytes(snapshot.bytesProcessed)} · 平均{' '}
          {averageSpeed.toFixed(1)} MB/s
        </Text>
      </Box>
      <Text>
        <Text color={paint('matrix')}>
          採用 {formatNumber(counters.adopted)}
        </Text>
        <Text color={subtle}> · </Text>
        <Text color={paint('blue')}>
          重複 {formatNumber(counters.duplicate)}
        </Text>
        <Text color={subtle}> · </Text>
        <Text color={paint('orange')}>
          フォールバック {formatNumber(counters.fallback)}
        </Text>
        <Text color={subtle}> · </Text>
        <Text color={paint(counters.error > 0 ? 'red' : 'matrix')} bold>
          エラー {formatNumber(counters.error)}
        </Text>
      </Text>
      <Text color={subtle}>
        写真 {formatNumber(types.photo)} · 動画 {formatNumber(types.video)} ·
        RAW {formatNumber(types.raw)} · ZIP {formatNumber(types.zip)} / 日付:
        メタデータ {((dateSources.metadata / adopted) * PERCENT).toFixed(0)}% ·
        ファイル名 {((dateSources.filename / adopted) * PERCENT).toFixed(0)}% ·
        なし {((dateSources.none / adopted) * PERCENT).toFixed(0)}%
      </Text>
      <Text color={text}>
        {interrupted
          ? '同じコマンドで、途中から再開できます。'
          : '次は、Web で結果を確認してください。'}
      </Text>
    </Panel>
  );
};
