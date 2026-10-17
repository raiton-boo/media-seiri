import { Box, Text } from 'ink';
import {
  displayWidth,
  formatDuration,
  formatNumber,
  matrixRain,
  spinnerFrame,
} from '../format.ts';
import { paint } from '../theme.ts';
import { ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const MAX_WIDTH = 100;
const PERCENT = 100;
const BORDER_AND_PADDING = 4;
const BAR_WIDTH = 30;
const CURSOR_BLINK_MILLISECONDS = 500;
// 「> 」+ 項目名 + 空白 + 点 + 空白 + 「[ OK ]」の、項目名と点以外の幅
const BOOT_LINE_FIXED_WIDTH = 10;

type BootLineProps = {
  label: string;
  status: string;
  ok: boolean;
  width: number;
};

/** Linux の起動画面のような、点で埋めた行と [ OK ] */
const BootLine = ({ label, status, ok, width }: BootLineProps) => {
  const dots = '.'.repeat(
    Math.max(2, width - displayWidth(label) - BOOT_LINE_FIXED_WIDTH)
  );
  return (
    <Text>
      <Text color={paint('matrixDim')}>{'> '}</Text>
      <Text color={paint('matrix')}>{label} </Text>
      <Text color={paint('matrixDim')}>{dots} </Text>
      <Text color={paint(ok ? 'matrix' : 'orange')} bold>
        [ {status} ]
      </Text>
    </Text>
  );
};

const LEVEL_TAGS = { INFO: ' OK ', WARN: 'WARN', ERROR: 'FAIL' } as const;

/** 案 D: サイバー(ハッカー風。緑の文字、流れる文字、起動ログ) */
export const CyberView = ({
  snapshot,
  logs,
  elapsed,
  remaining,
  isStopping,
  columns,
}: ViewProps) => {
  const width = Math.min(columns, MAX_WIDTH);
  const inner = width - BORDER_AND_PADDING;
  const { counters } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const isCursorVisible =
    Math.floor(elapsed / CURSOR_BLINK_MILLISECONDS) % 2 === 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={paint('matrix')}
      paddingX={1}
      width={width}
    >
      <Text color={paint('matrixDim')}>{matrixRain(inner, elapsed)}</Text>
      <Text color={paint('matrix')} bold>
        {'█ FILE-SEIRI :: INGEST '}
        <Text color={paint('matrixDim')}>
          run#12 · {formatDuration(elapsed)} · ETA {formatDuration(remaining)}
        </Text>
      </Text>
      <Text color={paint('matrixDim')}>{'─'.repeat(inner)}</Text>
      <BootLine
        label="mount  Backup-copy ➜ PhotoLib"
        status="OK"
        ok
        width={inner}
      />
      <BootLine
        label={`scan   ${formatNumber(snapshot.total)} files`}
        status="OK"
        ok
        width={inner}
      />
      <Box>
        <Text color={paint('matrixDim')}>{'> '}</Text>
        <Text color={paint('matrix')}>hash+copy </Text>
        <ProgressBar
          ratio={ratio}
          width={BAR_WIDTH}
          from="matrixDim"
          to="matrix"
        />
        <Text color={paint('matrix')} bold>
          {' '}
          {Math.floor(ratio * PERCENT)}%
        </Text>
        <Text color={paint('matrixDim')}>
          {' '}
          {formatNumber(snapshot.processed)}/{formatNumber(snapshot.total)}
        </Text>
      </Box>
      <BootLine
        label={`verify (F_NOCACHE) ${snapshot.currentFile}`}
        status={`${spinnerFrame(elapsed)} `}
        ok={false}
        width={inner}
      />
      <Text color={paint('matrixDim')}>{'─'.repeat(inner)}</Text>
      <Text>
        <Text color={paint('matrix')}>
          ADOPT:{formatNumber(counters.adopted)}
        </Text>
        <Text color={paint('matrixDim')}> | </Text>
        <Text color={paint('cyan')}>
          DUP:{formatNumber(counters.duplicate)}
        </Text>
        <Text color={paint('matrixDim')}> | </Text>
        <Text color={paint('orange')}>
          FALLBACK:{formatNumber(counters.fallback)}
        </Text>
        <Text color={paint('matrixDim')}> | </Text>
        <Text color={paint('red')} bold>
          ERR:{formatNumber(counters.error)}
        </Text>
      </Text>
      <Text color={paint('matrixDim')}>
        root@file-seiri:~# tail -f ingest.log
      </Text>
      {logs.map((log) => (
        <Text key={log.id}>
          <Text color={paint('matrixDim')}>{log.time} </Text>
          <Text
            color={paint(
              log.level === 'ERROR'
                ? 'red'
                : log.level === 'WARN'
                  ? 'orange'
                  : 'matrix'
            )}
          >
            [{LEVEL_TAGS[log.level]}]
          </Text>
          <Text color={paint(log.level === 'INFO' ? 'matrixDim' : 'matrix')}>
            {' '}
            {log.message}
          </Text>
        </Text>
      ))}
      <Text color={paint('matrix')}>
        root@file-seiri:~# {isStopping ? 'SIGINT received. flushing…' : ''}
        {isCursorVisible ? '█' : ' '}
      </Text>
    </Box>
  );
};
