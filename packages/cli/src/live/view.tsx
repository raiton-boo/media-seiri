import { Box, Text } from 'ink';
import { type LiveSnapshot, type LogLine, STAGES } from './feed.ts';
import {
  barGraph,
  conveyor,
  displayWidth,
  formatDuration,
  formatGigabytes,
  formatNumber,
  miniBar,
  padToWidth,
  partialDigest,
  spinnerFrame,
  truncateToWidth,
} from './format.ts';
import { Badge, Panel, ProgressBar } from './parts.tsx';
import { type ColorName, mixColor, paint } from './theme.ts';

/** 画面が読む、すべての情報(取り込みの状態と、画面の状態) */
export type ViewProps = {
  snapshot: LiveSnapshot;
  logs: LogLine[];
  logsAll: LogLine[];
  alerts: LogLine[];
  /** コピーの速さの履歴(バイト/秒。0.5 秒ごと) */
  speeds: number[];
  /** 経過時間(一時停止の間は、進めない。ミリ秒) */
  elapsed: number;
  isStopping: boolean;
  isPaused: boolean;
  logView: boolean;
  sleepGuard: boolean;
  /** キー操作の結果などの、一時的なお知らせ */
  notice: string;
  columns: number;
  rows: number;
  system: { cpuPercent: number; memoryMegabytes: number };
};

const PERCENT = 100;
const GRAPH_HEIGHT = 6;
const LEFT_RATIO = 0.46;
const PANEL_CHROME = 4;
// 端末の行数に応じて、表示するパネルを減らす(Ink は、端末の高さを超えると、画面が乱れるため)
const FULL_ROWS = 48;
const STANDARD_ROWS = 41;
const MIN_ROWS_WITH_LOGS = 28;
const LOG_VIEW_RESERVED_ROWS = 6;
const LANE_FIXED_WIDTH = 50;
const MIN_LANE_BAR_WIDTH = 20;
const MAX_LANE_BAR_WIDTH = 120;
const LANE_LABEL_WIDTH = 9;
const IN_FLIGHT_LABEL_WIDTH = 9;
const MINI_BAR_WIDTH = 8;
const BREAKDOWN_FIXED_WIDTH = 29;
const MIN_BREAKDOWN_BAR_WIDTH = 10;
const MAX_BREAKDOWN_BAR_WIDTH = 60;
const DIGEST_EDGE = 8;
const PIPELINE_BOX_WIDTH = 34;
const PIPELINE_ARROW_WIDTH = 9;
const CONVEYOR_SPACING = 5;
const FRAMES_PER_SECOND = 30;
const MS = 1000;
const MEGABYTE = 1024 * 1024;
const RECENT_SAMPLE_COUNT = 120;
const SPEED_MARGIN_COLUMNS = 8;
const GRAPH_SECONDS_PER_COLUMN = 0.5;

const STAGE_COLORS: ColorName[] = ['cyan', 'violet', 'yellow', 'matrix'];

const ratioOf = (value: number, total: number): number =>
  total > 0 ? Math.min(1, value / total) : 0;

const levelColor = (level: LogLine['level']): ColorName =>
  level === 'ERROR' ? 'red' : level === 'WARN' ? 'orange' : 'matrix';

type StackedBarProps = {
  shares: { color: ColorName; share: number }[];
  width: number;
};

/** 割合ごとに色を変えた、1 本の積み上げのバー */
const StackedBar = ({ shares, width }: StackedBarProps) => {
  let remainingWidth = width;
  const segments = shares.map((item, index) => {
    const isLast = index === shares.length - 1;
    const length = isLast
      ? remainingWidth
      : Math.min(remainingWidth, Math.round((item.share / PERCENT) * width));
    remainingWidth -= length;
    return { id: index, color: item.color, length };
  });
  return (
    <Text>
      {segments.map((segment) => (
        <Text key={segment.id} color={paint(segment.color)}>
          {'█'.repeat(segment.length)}
        </Text>
      ))}
    </Text>
  );
};

/** 取り込みのライブ表示(btop 風。パネルの中を濃い紺で塗り、背景が透明な端末でも読めるようにする) */
export const LiveView = ({
  snapshot,
  logs,
  logsAll,
  alerts,
  speeds,
  elapsed,
  isStopping,
  isPaused,
  logView,
  sleepGuard,
  notice,
  columns,
  rows,
  system,
}: ViewProps) => {
  const total = columns;
  const bg = 'panel';
  const text = paint('text');
  const subtle = paint('subtle');

  const footer = (
    <Box flexDirection="column">
      <Text>
        {isPaused ? (
          <Badge label="一時停止中 (p で再開)" background="yellow" />
        ) : null}
        {isStopping ? (
          <Badge label="停止しています…" background="orange" />
        ) : null}
        <Text color={subtle}>
          {' '}
          [p]一時停止 [l]ログ全画面 [w]Web [q]または Ctrl-C 安全に停止
        </Text>
      </Text>
      <Text color={paint('orange')}>
        {notice === '' ? ' ' : ` ${truncateToWidth(notice, total - 2)}`}
      </Text>
    </Box>
  );

  // ---- ログの全画面表示 ----
  if (logView) {
    const visibleCount = Math.max(3, rows - LOG_VIEW_RESERVED_ROWS);
    const shown = logsAll.slice(-visibleCount);
    return (
      <Box flexDirection="column" width={total}>
        <Panel
          title={`logs 全画面 ${shown.length}/${logsAll.length}`}
          width={total}
          color="violet"
          background={bg}
        >
          {shown.map((log) => (
            <Text key={log.id}>
              <Text color={subtle}>{log.time} </Text>
              <Text color={paint(levelColor(log.level))}>
                {log.level.padEnd(5)}{' '}
              </Text>
              <Text color={text}>
                {truncateToWidth(log.message, total - 20)}
              </Text>
            </Text>
          ))}
        </Panel>
        {footer}
      </Box>
    );
  }

  const leftWidth = Math.floor(total * LEFT_RATIO);
  const rightWidth = total - leftWidth;
  const innerTotal = total - PANEL_CHROME;
  const laneBarWidth = Math.min(
    MAX_LANE_BAR_WIDTH,
    Math.max(MIN_LANE_BAR_WIDTH, innerTotal - LANE_FIXED_WIDTH)
  );
  const breakdownBarWidth = Math.min(
    MAX_BREAKDOWN_BAR_WIDTH,
    Math.max(MIN_BREAKDOWN_BAR_WIDTH, rightWidth - BREAKDOWN_FIXED_WIDTH)
  );
  const { counts, bytes, counters, timing } = snapshot;

  // ---- 速さ・残り時間・完了予定 ----
  const currentSpeed = (speeds[speeds.length - 1] ?? 0) / MEGABYTE;
  const recent = speeds.slice(-RECENT_SAMPLE_COUNT);
  const recentBytesPerSecond =
    recent.length > 0
      ? recent.reduce((sum, value) => sum + value, 0) / recent.length
      : 0;
  const copyMs = timing.copy + timing.verify;
  const averageBytesPerSecond = copyMs > 0 ? bytes.copied / (copyMs / MS) : 0;
  const maxSpeed = Math.max(...speeds, 0) / MEGABYTE;
  const verifySpeed = snapshot.verifyBytesPerSecond / MEGABYTE;
  const inCopy = snapshot.phase === 'コピー' || snapshot.phase === '完了';
  // 進みの割合: コピーの段階は、バイトで。それまでは、解析の件数で
  const ratio = inCopy
    ? ratioOf(bytes.copied, bytes.copyTotal)
    : ratioOf(counts.analyzed, counts.analyzeTotal);
  const bytesLeft = Math.max(0, bytes.copyTotal - bytes.copied);
  const remainingRecent =
    inCopy && recentBytesPerSecond > 0
      ? (bytesLeft / recentBytesPerSecond) * MS
      : 0;
  const remainingAverage =
    inCopy && averageBytesPerSecond > 0
      ? (bytesLeft / averageBytesPerSecond) * MS
      : 0;
  const analyzeLeft = counts.analyzeTotal - counts.analyzed;
  const analyzeRemaining =
    !inCopy && counts.analyzed > 0
      ? (elapsed / counts.analyzed) * analyzeLeft
      : 0;
  const finishLabel = new Date(
    Date.now() + (inCopy ? remainingRecent : analyzeRemaining)
  )
    .toTimeString()
    .slice(0, 5);

  const graphWidth = rightWidth - PANEL_CHROME;
  const graphRows = barGraph(speeds, graphWidth, GRAPH_HEIGHT).map(
    (row, position) => ({ id: position, row })
  );
  const windowSeconds = Math.round(
    Math.min(speeds.length, graphWidth) * GRAPH_SECONDS_PER_COLUMN
  );
  const showStorage = rows >= FULL_ROWS;
  const showInFlight = rows >= STANDARD_ROWS;
  const showLogs = rows >= MIN_ROWS_WITH_LOGS;
  const visibleLogs = showInFlight ? logs.slice(-5) : logs.slice(-4);

  const lanes = [
    {
      stage: STAGES[0],
      done: counts.found,
      of: counts.found,
      detail: `${formatNumber(counts.found)} files`,
    },
    {
      stage: STAGES[1],
      done: counts.analyzed,
      of: counts.analyzeTotal,
      detail: 'メタデータ + SHA-256',
    },
    {
      stage: STAGES[2],
      done: counts.copied,
      of: counts.copyTotal,
      detail: `${currentSpeed.toFixed(1)} MB/s`,
    },
    {
      stage: STAGES[3],
      done: counts.verified,
      of: counts.copyTotal,
      detail: `${verifySpeed.toFixed(1)} MB/s F_NOCACHE`,
    },
  ];

  const arrowLength = Math.max(
    3,
    Math.floor((innerTotal - PIPELINE_BOX_WIDTH - PIPELINE_ARROW_WIDTH) / 3)
  );
  const pipeline = STAGES.flatMap((stage, index) => {
    const parts = [
      <Text
        key={`stage-${stage}`}
        color={paint(STAGE_COLORS[index] ?? 'cyan')}
        bold
      >
        {`[${stage}]`}
      </Text>,
    ];
    if (index < STAGES.length - 1) {
      parts.push(
        <Text
          key={`flow-${stage}`}
          color={paint(STAGE_COLORS[index + 1] ?? 'cyan')}
        >
          {` ${conveyor(arrowLength, isPaused ? 0 : elapsed, CONVEYOR_SPACING, index * 2)}▶ `}
        </Text>
      );
    }
    return parts;
  });

  const inFlightFileWidth =
    leftWidth - PANEL_CHROME - IN_FLIGHT_LABEL_WIDTH - MINI_BAR_WIDTH - 11;
  const digest = snapshot.digest;
  const zip = snapshot.zip;

  const typeTotal = Math.max(counts.found, 1);
  const breakdown: {
    label: string;
    value: number;
    of: number;
    color: ColorName;
  }[] = [
    {
      label: '写真',
      value: snapshot.types.photo,
      of: typeTotal,
      color: 'cyan',
    },
    {
      label: '動画',
      value: snapshot.types.video,
      of: typeTotal,
      color: 'violet',
    },
    { label: 'RAW', value: snapshot.types.raw, of: typeTotal, color: 'yellow' },
    {
      label: 'ZIP の中',
      value: snapshot.types.zip,
      of: typeTotal,
      color: 'orange',
    },
    {
      label: 'メタデータ',
      value: snapshot.dateSources.metadata,
      of: counts.copyTotal,
      color: 'matrix',
    },
    {
      label: 'ファイル名',
      value: snapshot.dateSources.filename,
      of: counts.copyTotal,
      color: 'orange',
    },
    {
      label: '日付なし',
      value: snapshot.dateSources.none,
      of: counts.copyTotal,
      color: 'red',
    },
  ];
  const timeTotal = Math.max(timing.analyze + timing.copy + timing.verify, 1);
  const shares: { label: string; color: ColorName; share: number }[] = [
    {
      label: 'analyze',
      color: 'cyan',
      share: (timing.analyze / timeTotal) * PERCENT,
    },
    {
      label: 'copy',
      color: 'yellow',
      share: (timing.copy / timeTotal) * PERCENT,
    },
    {
      label: 'verify',
      color: 'matrix',
      share: (timing.verify / timeTotal) * PERCENT,
    },
  ];
  const status = isPaused
    ? '一時停止'
    : isStopping
      ? '停止中'
      : snapshot.phase === '完了'
        ? '完了'
        : '実行中';
  const mainLine = inCopy
    ? `${formatNumber(counts.copied)}/${formatNumber(counts.copyTotal)} files · ${formatGigabytes(bytes.copied)}/${formatGigabytes(bytes.copyTotal)}`
    : `${snapshot.phase} ${formatNumber(counts.analyzed)}/${formatNumber(counts.analyzeTotal)} files`;

  return (
    <Box flexDirection="column" width={total}>
      <Box>
        <Panel
          title={`run #${snapshot.runId} · ${status}${snapshot.isDryRun ? ' · dry-run' : ''}${snapshot.sourceCount > 1 ? ` · ${snapshot.sourceIndex + 1}/${snapshot.sourceCount}` : ''}`}
          width={leftWidth}
          color="cyan"
          background={bg}
        >
          <Text color={text}>
            <Text color={paint('yellow')} bold>
              {truncateToWidth(
                snapshot.source,
                Math.floor((leftWidth - 12) / 2)
              )}
            </Text>{' '}
            ➜{' '}
            <Text bold>
              {truncateToWidth(
                snapshot.destination,
                Math.floor((leftWidth - 12) / 2)
              )}
            </Text>
          </Text>
          <Text>
            <ProgressBar
              ratio={ratio}
              width={leftWidth - 16}
              from="cyan"
              to="matrix"
            />
            <Text color={text} bold>
              {' '}
              {Math.floor(ratio * PERCENT)}%
            </Text>
          </Text>
          <Text color={text}>{mainLine}</Text>
          <Text>
            <Text color={subtle}>
              経過 {formatDuration(elapsed)} · 完了予定{' '}
            </Text>
            <Text color={paint('yellow')} bold>
              {finishLabel}
            </Text>
            <Text color={subtle}> ごろ</Text>
          </Text>
          <Text color={subtle}>
            残り {formatDuration(inCopy ? remainingRecent : analyzeRemaining)}{' '}
            (直近) /{' '}
            {formatDuration(inCopy ? remainingAverage : analyzeRemaining)}{' '}
            (平均)
          </Text>
          <Text>
            <Text color={paint('matrix')}>
              採用 {formatNumber(counters.adopted)}
            </Text>
            <Text color={subtle}> · </Text>
            <Text color={paint('blue')}>
              重複 {formatNumber(counters.duplicate)}
            </Text>
          </Text>
          <Text>
            <Text color={paint('orange')}>
              フォールバック {formatNumber(counters.fallback)}
            </Text>
            <Text color={subtle}> · </Text>
            <Text color={paint('red')} bold>
              エラー {formatNumber(counters.error)}
            </Text>
          </Text>
        </Panel>
        <Panel
          title={`throughput ${currentSpeed.toFixed(1)} MB/s · 直近 ${windowSeconds} 秒`}
          width={rightWidth}
          color="matrix"
          background={bg}
        >
          {graphRows.map(({ id, row }) => (
            <Text
              key={id}
              color={mixColor('matrix', 'cyan', id / (GRAPH_HEIGHT - 1))}
            >
              {row}
            </Text>
          ))}
          <Text color={subtle}>
            avg {(averageBytesPerSecond / MEGABYTE).toFixed(1)} · max{' '}
            {maxSpeed.toFixed(1)} · verify {verifySpeed.toFixed(1)} MB/s
          </Text>
        </Panel>
      </Box>

      <Panel
        title="pipeline  スキャン → 解析 → コピー → 検証"
        width={total}
        color="violet"
        background={bg}
      >
        <Text>{pipeline}</Text>
        {lanes.map((lane, index) => (
          <Text key={lane.stage}>
            <Text color={paint(STAGE_COLORS[index] ?? 'cyan')} bold>
              {isPaused ? '⏸' : spinnerFrame(elapsed + index * 80)}{' '}
              {padToWidth(lane.stage, LANE_LABEL_WIDTH)}
            </Text>
            <ProgressBar
              ratio={ratioOf(lane.done, lane.of)}
              width={laneBarWidth}
              from={STAGE_COLORS[index] ?? 'cyan'}
              to={STAGE_COLORS[index] ?? 'cyan'}
            />
            <Text color={text}>
              {' '}
              {padToWidth(
                `${Math.floor(ratioOf(lane.done, lane.of) * PERCENT)}%`,
                5
              )}
              {padToWidth(formatNumber(lane.done), 8)}
            </Text>
            <Text color={subtle}>{lane.detail}</Text>
          </Text>
        ))}
      </Panel>

      {showInFlight ? (
        <Box>
          <Panel
            title="in flight"
            width={leftWidth}
            color="yellow"
            background={bg}
          >
            {snapshot.inFlight.length === 0 ? (
              <Text color={subtle}>処理中のファイルなし</Text>
            ) : null}
            {snapshot.inFlight.map((item) => {
              const colorIndex = Math.max(0, STAGES.indexOf(item.stage));
              return (
                <Text key={item.stage}>
                  <Text color={paint(STAGE_COLORS[colorIndex] ?? 'cyan')} bold>
                    {padToWidth(item.stage, IN_FLIGHT_LABEL_WIDTH)}
                  </Text>
                  <Text color={text}>
                    {padToWidth(
                      truncateToWidth(item.file, inFlightFileWidth),
                      inFlightFileWidth
                    )}{' '}
                  </Text>
                  <Text color={paint(STAGE_COLORS[colorIndex] ?? 'cyan')}>
                    {miniBar(item.ratio, MINI_BAR_WIDTH)}
                  </Text>
                  <Text color={subtle}>
                    {' '}
                    {item.megabytes > 0 ? `${item.megabytes.toFixed(1)}MB` : ''}
                  </Text>
                </Text>
              );
            })}
            <Text>
              <Text color={paint('orange')} bold>
                {padToWidth('ZIP', IN_FLIGHT_LABEL_WIDTH)}
              </Text>
              {zip ? (
                <>
                  <Text color={text}>
                    {padToWidth(
                      truncateToWidth(zip.name, inFlightFileWidth),
                      inFlightFileWidth
                    )}{' '}
                  </Text>
                  <Text color={paint('orange')}>
                    {miniBar(ratioOf(zip.entry, zip.entries), MINI_BAR_WIDTH)}
                  </Text>
                  <Text color={subtle}>
                    {' '}
                    {zip.entry}/{zip.entries}
                  </Text>
                </>
              ) : (
                <Text color={subtle}>展開中の ZIP なし</Text>
              )}
            </Text>
            {showStorage ? (
              <>
                <Text color={text}>
                  空き{' '}
                  {snapshot.freeBytes === undefined
                    ? '—'
                    : formatGigabytes(snapshot.freeBytes)}
                </Text>
                <Text>
                  <Text color={paint('matrix')}>
                    検証 ✔ {formatNumber(counts.verified)}
                  </Text>
                  <Text color={subtle}> · </Text>
                  <Text
                    color={paint(counts.verifyFailed > 0 ? 'red' : 'matrix')}
                    bold
                  >
                    ✘ {formatNumber(counts.verifyFailed)}
                  </Text>
                </Text>
              </>
            ) : null}
          </Panel>
          <Panel
            title="breakdown"
            width={rightWidth}
            color="blue"
            background={bg}
          >
            {breakdown.map((item) => (
              <Text key={item.label}>
                <Text color={paint(item.color)}>
                  {padToWidth(item.label, 11)}
                </Text>
                <ProgressBar
                  ratio={ratioOf(item.value, item.of)}
                  width={breakdownBarWidth}
                  from={item.color}
                  to={item.color}
                />
                <Text color={text}>
                  {' '}
                  {padToWidth(formatNumber(item.value), 7)}
                </Text>
                <Text color={subtle}>
                  {item.of > 0
                    ? `${((item.value / item.of) * PERCENT).toFixed(0)}%`
                    : '-'}
                </Text>
              </Text>
            ))}
          </Panel>
        </Box>
      ) : null}

      {showStorage ? (
        <Box>
          <Panel
            title="integrity"
            width={leftWidth}
            color="magenta"
            background={bg}
          >
            <Text>
              <Text color={subtle}>source </Text>
              {digest ? (
                <>
                  <Text color={paint('magenta')} bold>
                    {digest.source.slice(0, DIGEST_EDGE)}
                  </Text>
                  <Text color={subtle}>
                    …{digest.source.slice(-DIGEST_EDGE)}
                  </Text>
                </>
              ) : (
                <Text color={subtle}>—</Text>
              )}
            </Text>
            <Text>
              <Text color={subtle}>verify </Text>
              {digest ? (
                <>
                  <Text color={paint('cyan')} bold>
                    {partialDigest(
                      digest.source.slice(0, DIGEST_EDGE),
                      digest.verifying ? 0.5 : 0
                    )}
                  </Text>
                  <Text color={subtle}>
                    …
                    {partialDigest(
                      digest.source.slice(-DIGEST_EDGE),
                      digest.verifying ? 0.5 : 0
                    )}{' '}
                  </Text>
                  <Text color={paint('matrix')}>
                    {digest.verifying ? spinnerFrame(elapsed) : '…'}
                  </Text>
                </>
              ) : (
                <Text color={subtle}>—</Text>
              )}
            </Text>
            <Text color={subtle}>F_NOCACHE · 4MiB chunks</Text>
            <Text>
              <Text color={subtle}>スリープ抑止 </Text>
              <Text color={paint(sleepGuard ? 'matrix' : 'orange')} bold>
                {sleepGuard ? 'ON' : 'OFF'}
              </Text>
              <Text color={subtle}>
                {sleepGuard ? ' (caffeinate -i)' : ' (使えません)'}
              </Text>
            </Text>
            <Text>
              <Text color={subtle}>外部通信 </Text>
              <Text color={paint('matrix')} bold>
                0 B
              </Text>
              <Text color={subtle}> (取り込み中は通信しない)</Text>
            </Text>
          </Panel>
          <Panel
            title="process (実測)"
            width={rightWidth}
            color="orange"
            background={bg}
          >
            <Text>
              <Text color={subtle}>CPU </Text>
              <ProgressBar
                ratio={Math.min(system.cpuPercent / PERCENT, 1)}
                width={16}
                from="matrix"
                to="orange"
              />
              <Text color={text}> {system.cpuPercent.toFixed(0)}%</Text>
            </Text>
            <Text>
              <Text color={subtle}>MEM </Text>
              <Text color={text}>{system.memoryMegabytes.toFixed(0)} MB</Text>
              <Text color={subtle}> · 描画 最大 {FRAMES_PER_SECOND}fps</Text>
            </Text>
            <Text color={subtle}>時間の内訳(実測)</Text>
            <StackedBar shares={shares} width={rightWidth - PANEL_CHROME} />
            <Text>
              {shares.map((item) => (
                <Text key={item.label} color={paint(item.color)}>
                  ■
                  <Text
                    color={subtle}
                  >{`${item.label} ${item.share.toFixed(0)}% `}</Text>
                </Text>
              ))}
            </Text>
          </Panel>
        </Box>
      ) : null}

      {showLogs ? (
        <Panel
          title="recent files"
          width={total}
          color="violet"
          background={bg}
        >
          <Text color={subtle}>
            time{'      '}level{'  '}file
          </Text>
          {visibleLogs.map((log) => (
            <Text key={log.id}>
              <Text color={subtle}>
                {log.time}
                {'  '}
              </Text>
              <Text color={paint(levelColor(log.level))}>
                {log.level.padEnd(5)}
                {'  '}
              </Text>
              <Text color={text}>
                {truncateToWidth(
                  log.message,
                  innerTotal - 16 - displayWidth('  ')
                )}
              </Text>
            </Text>
          ))}
        </Panel>
      ) : null}
      {showInFlight ? (
        <Panel
          title={`alerts (${alerts.length})`}
          width={total}
          color="orange"
          background={bg}
        >
          {alerts.length === 0 ? <Text color={subtle}>none</Text> : null}
          {alerts.slice(-2).map((log) => (
            <Text
              key={log.id}
              color={paint(log.level === 'ERROR' ? 'red' : 'orange')}
            >
              {log.time}{' '}
              {truncateToWidth(
                log.message,
                innerTotal - SPEED_MARGIN_COLUMNS - 2
              )}
            </Text>
          ))}
        </Panel>
      ) : null}
      {footer}
    </Box>
  );
};
