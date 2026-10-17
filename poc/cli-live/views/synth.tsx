import { Box, Text } from 'ink';
import { formatDuration, formatNumber, sparkline } from '../format.ts';
import { paint } from '../theme.ts';
import { GradientText, ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 100;
const PERCENT = 100;
const SPARKLINE_WIDTH = 36;
const BAR_MARGIN = 40;
const MIN_BAR_WIDTH = 10;
const MAX_BAR_WIDTH = 44;
const SIMULATED_MEGABYTES_PER_FILE = 0.22;
const STRIP = '░▒▓█▓▒░';
const BORDER_AND_PADDING = 4;

/** 飾りの帯を、指定の幅ちょうどにする */
const stripOfWidth = (width: number): string =>
  STRIP.repeat(Math.ceil(width / STRIP.length)).slice(0, width);

/** 案 F: シンセ(サイバーパンクのネオン。マゼンタとシアンの二重線) */
export const SynthView = ({
  snapshot,
  logs,
  history,
  elapsed,
  remaining,
  isStopping,
  columns,
}: ViewProps) => {
  const { counters } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const currentRate = history[history.length - 1] ?? 0;
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, columns - BAR_MARGIN)
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={paint('magenta')}
      paddingX={1}
      width={Math.min(columns, MAX_WIDTH)}
    >
      <Box justifyContent="space-between">
        <GradientText
          text="◢◤ FILE-SEIRI ◥◣  // INGEST"
          from="magenta"
          to="cyan"
          bold
        />
        <Text color={paint('violet')}>
          RUN #12 · T+{formatDuration(elapsed)} · ETA{' '}
          {formatDuration(remaining)}
        </Text>
      </Box>
      <GradientText
        text={stripOfWidth(Math.min(columns, MAX_WIDTH) - BORDER_AND_PADDING)}
        from="magenta"
        to="cyan"
      />
      <Box marginTop={1}>
        <Text color={paint('cyan')} bold>
          SYNC{' '}
        </Text>
        <ProgressBar ratio={ratio} width={barWidth} from="magenta" to="cyan" />
        <Text color={paint('paper')} bold>
          {' '}
          {Math.floor(ratio * PERCENT)}%
        </Text>
        <Text color={paint('violet')}>
          {' '}
          {formatNumber(snapshot.processed)}/{formatNumber(snapshot.total)}
        </Text>
      </Box>
      <Box>
        <Text color={paint('cyan')} bold>
          FLOW{' '}
        </Text>
        <GradientText
          text={sparkline(history, SPARKLINE_WIDTH)}
          from="violet"
          to="cyan"
        />
        <Text color={paint('paper')} bold>
          {' '}
          {(currentRate * SIMULATED_MEGABYTES_PER_FILE).toFixed(1)} MB/s
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={paint('matrix')}>
          ▌ADOPT {formatNumber(counters.adopted)}{' '}
        </Text>
        <Text color={paint('cyan')}>
          ▌DUP {formatNumber(counters.duplicate)}{' '}
        </Text>
        <Text color={paint('orange')}>
          ▌FALLBACK {formatNumber(counters.fallback)}{' '}
        </Text>
        <Text color={paint('magenta')} bold>
          ▌ERR {formatNumber(counters.error)}
        </Text>
      </Box>
      <Box>
        <Text color={paint('violet')}>TARGET </Text>
        <Text color={paint('paper')}>{snapshot.currentFile}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {logs.map((log) => (
          <Text key={log.id}>
            <Text
              color={paint(
                log.level === 'ERROR'
                  ? 'magenta'
                  : log.level === 'WARN'
                    ? 'orange'
                    : 'cyan'
              )}
            >
              ▍
            </Text>
            <Text color={paint('grey')}>{log.time} </Text>
            <Text color={paint(log.level === 'INFO' ? 'violet' : 'paper')}>
              {log.message}
            </Text>
          </Text>
        ))}
      </Box>
      <GradientText
        text={stripOfWidth(Math.min(columns, MAX_WIDTH) - BORDER_AND_PADDING)}
        from="cyan"
        to="magenta"
      />
      <Text color={paint('grey')}>
        {isStopping ? '>> SAFE STOP…' : '>> Ctrl-C : SAFE STOP (exit 130)'}
      </Text>
    </Box>
  );
};
