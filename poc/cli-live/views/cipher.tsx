import { Box, Text } from 'ink';
import {
  formatDuration,
  formatNumber,
  sampleDigest,
  withLeaders,
} from '../format.ts';
import { paint } from '../theme.ts';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 100;
const LABEL_WIDTH = 17;
const HEADER_TITLE = 'file-seiri v0.1 · integrity engine';
// 「┏━ 」と、タイトルの後ろの空白の幅
const HEADER_FIXED_WIDTH = 4;
const PERCENT = 100;
const SIMULATED_MEGABYTES_PER_FILE = 0.22;
const DIGEST_EDGE_LENGTH = 10;

type RowProps = { label: string; children: React.ReactNode };

/** hashcat の状態の画面のような、「項目名.......: 値」の行 */
const Row = ({ label, children }: RowProps) => (
  <Text>
    <Text color={paint('cyan')}>{withLeaders(label, LABEL_WIDTH)}</Text>
    <Text color={paint('grey')}>: </Text>
    {children}
  </Text>
);

const formatRatio = (value: number, total: number): string =>
  `${formatNumber(value)}/${formatNumber(total)} (${((value / total) * PERCENT).toFixed(2)}%)`;

/** 案 E: サイファー(セキュリティ・解析ツール風。hashcat の状態の画面を参考) */
export const CipherView = ({
  snapshot,
  logs,
  history,
  elapsed,
  remaining,
  isStopping,
  columns,
}: ViewProps) => {
  const { counters, processed, total } = snapshot;
  const currentRate = history[history.length - 1] ?? 0;
  const digest = sampleDigest(`${snapshot.currentFile}:${processed}`);

  return (
    <Box flexDirection="column" width={Math.min(columns, MAX_WIDTH)}>
      <Text color={paint('violet')} bold>
        {`┏━ ${HEADER_TITLE} ${'━'.repeat(Math.max(0, Math.min(columns, MAX_WIDTH) - HEADER_TITLE.length - HEADER_FIXED_WIDTH))}`}
      </Text>
      <Row label="Session">
        <Text color={paint('paper')}>ingest-run12</Text>
      </Row>
      <Row label="Status">
        <Text color={paint(isStopping ? 'orange' : 'matrix')} bold>
          {isStopping ? 'Stopping' : 'Running'}
        </Text>
      </Row>
      <Row label="Hash.Mode">
        <Text color={paint('paper')}>SHA-256 + verify (F_NOCACHE)</Text>
      </Row>
      <Row label="Hash.Target">
        <Text color={paint('paper')}>Backup-copy ➜ PhotoLib</Text>
      </Row>
      <Row label="Time.Started">
        <Text color={paint('paper')}>{formatDuration(elapsed)} elapsed</Text>
      </Row>
      <Row label="Time.Estimated">
        <Text color={paint('paper')}>
          {formatDuration(remaining)} remaining
        </Text>
      </Row>
      <Row label="Speed.#1">
        <Text color={paint('yellow')} bold>
          {(currentRate * SIMULATED_MEGABYTES_PER_FILE).toFixed(1)} MB/s
        </Text>
        <Text color={paint('grey')}>
          {' '}
          ({formatNumber(Math.round(currentRate))} files/s)
        </Text>
      </Row>
      <Row label="Progress">
        <Text color={paint('paper')}>{formatRatio(processed, total)}</Text>
      </Row>
      <Row label="Adopted">
        <Text color={paint('matrix')}>
          {formatRatio(counters.adopted, Math.max(processed, 1))}
        </Text>
      </Row>
      <Row label="Rejected">
        <Text color={paint('blue')}>
          {formatNumber(counters.duplicate)} duplicates
        </Text>
        <Text color={paint('grey')}> · </Text>
        <Text color={paint('orange')}>
          {formatNumber(counters.fallback)} fallback
        </Text>
      </Row>
      <Row label="Verify.Failed">
        <Text color={paint(counters.error > 0 ? 'red' : 'matrix')} bold>
          {formatNumber(counters.error)}
        </Text>
      </Row>
      <Row label="Candidate.#1">
        <Text color={paint('paper')}>{snapshot.currentFile}</Text>
      </Row>
      <Row label="Digest">
        <Text color={paint('magenta')} bold>
          {digest.slice(0, DIGEST_EDGE_LENGTH)}
        </Text>
        <Text color={paint('grey')}>…</Text>
        <Text color={paint('magenta')} bold>
          {digest.slice(-DIGEST_EDGE_LENGTH)}
        </Text>
      </Row>
      <Text color={paint('grey')}>
        {'─'.repeat(Math.min(columns, MAX_WIDTH))}
      </Text>
      {logs.slice(-4).map((log) => (
        <Text key={log.id}>
          <Text color={paint('grey')}>[{log.time}] </Text>
          <Text
            color={paint(
              log.level === 'ERROR'
                ? 'red'
                : log.level === 'WARN'
                  ? 'orange'
                  : 'cyan'
            )}
          >
            {log.level.padEnd(5)}
          </Text>
          <Text color={paint('paper')}> {log.message}</Text>
        </Text>
      ))}
      <Text color={paint('grey')}>[c]heckpoint · Ctrl-C to stop safely</Text>
    </Box>
  );
};
