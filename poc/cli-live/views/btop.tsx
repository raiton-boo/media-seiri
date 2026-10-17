import { Box, Text } from 'ink';
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
  sampleDigest,
  spinnerFrame,
  truncateToWidth,
} from '../format.ts';
import { STAGES } from '../simulate.ts';
import { type ColorName, mixColor, paint } from '../theme.ts';
import { Badge, Panel, ProgressBar } from './parts.tsx';
import type { ViewProps } from './types.ts';

const PERCENT = 100;
const GRAPH_HEIGHT = 6;
const LEFT_RATIO = 0.46;
const PANEL_CHROME = 4;
// 端末の行数に応じて、表示するパネルを減らす(Ink は、端末の高さを超えると、画面が乱れるため)
const FULL_ROWS = 48;
const STANDARD_ROWS = 41;
// これより少ないと、ログのパネルも出せない(概要・速度・パイプラインだけにする)
const MIN_ROWS_WITH_LOGS = 28;
const LOG_VIEW_RESERVED_ROWS = 6;
const SIMULATED_MEGABYTES_PER_FILE = 0.22;
// PoC(PoC #1・#3)の実測値の比。検証の読み直しは、コピーより約 1.36 倍速い
const VERIFY_SPEED_RATIO = 1.36;
const SHA256_GIGABYTES_PER_SECOND = 3.3;
const DESTINATION_CAPACITY_BYTES = 1.8 * 1024 ** 4;
// 段階の行で、バー以外が使う幅(回転する印・名前・割合・件数・速さの説明)
const LANE_FIXED_WIDTH = 50;
const MIN_LANE_BAR_WIDTH = 20;
const MAX_LANE_BAR_WIDTH = 120;
const LANE_LABEL_WIDTH = 9;
const IN_FLIGHT_LABEL_WIDTH = 9;
const MINI_BAR_WIDTH = 8;
// 内訳の行で、バー以外が使う幅(名前・件数・割合)と、バーの幅の範囲
const BREAKDOWN_FIXED_WIDTH = 29;
const MIN_BREAKDOWN_BAR_WIDTH = 10;
const MAX_BREAKDOWN_BAR_WIDTH = 60;
const DIGEST_EDGE = 8;
const PIPELINE_BOX_WIDTH = 34;
const PIPELINE_ARROW_WIDTH = 9;
const CONVEYOR_SPACING = 5;
const FRAMES_PER_SECOND = 30;
const MILLISECONDS_PER_SECOND = 1000;
// 直近の速さは、約 1 分(0.5 秒ごとの測定 120 回)の平均で見る
const RECENT_SAMPLE_COUNT = 120;
const SPEED_MARGIN_COLUMNS = 8;
// 速度のグラフの 1 本あたりの時間(秒)。main.tsx の測定の間隔と同じ
const GRAPH_SECONDS_PER_COLUMN = 0.5;

const STAGE_COLORS: ColorName[] = ['cyan', 'violet', 'yellow', 'matrix'];

// 時間の内訳(模擬。PoC #3 の実測の傾向)。時間とともに、少し揺らす
const TIME_BASE_SHARES: { label: string; color: ColorName; share: number }[] = [
  { label: 'meta', color: 'cyan', share: 6 },
  { label: 'copy', color: 'yellow', share: 49 },
  { label: 'fsync', color: 'orange', share: 5 },
  { label: 'verify', color: 'matrix', share: 40 },
];
const SHARE_WOBBLE = 2;
const SHARE_WOBBLE_PERIOD_MILLISECONDS = 3000;

const timeShares = (elapsed: number) => {
  const raw = TIME_BASE_SHARES.map((item, index) => ({
    ...item,
    share:
      item.share +
      SHARE_WOBBLE *
        Math.sin(elapsed / SHARE_WOBBLE_PERIOD_MILLISECONDS + index * 2),
  }));
  const sum = raw.reduce((accumulated, item) => accumulated + item.share, 0);
  return raw.map((item) => ({ ...item, share: (item.share / sum) * PERCENT }));
};

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

type Lane = { stage: (typeof STAGES)[number]; count: number; detail: string };

/** 案 G: btop(複数のパネル。背景を塗って、透明な端末でも読めるようにする) */
export const BtopView = ({
  snapshot,
  logs,
  logsAll,
  alerts,
  history,
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
  // 端末の幅いっぱいに広げる。幅が変わっても、毎回の描画で、列の数を読み直す
  const total = columns;
  const bg = 'panel';
  const text = paint('text');
  const subtle = paint('subtle');

  // ---- キー操作の案内(どの画面でも、一番下に出す) ----
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
              <Text
                color={paint(
                  log.level === 'ERROR'
                    ? 'red'
                    : log.level === 'WARN'
                      ? 'orange'
                      : 'matrix'
                )}
              >
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
  const { counters, stageCounts } = snapshot;
  const ratio = snapshot.processed / snapshot.total;
  const currentRate = history[history.length - 1] ?? 0;
  const copySpeed = currentRate * SIMULATED_MEGABYTES_PER_FILE;
  const verifySpeed = copySpeed * VERIFY_SPEED_RATIO;
  const maxSpeed = Math.max(...history, 0) * SIMULATED_MEGABYTES_PER_FILE;

  // ---- 残り時間と完了予定の時刻(直近の速さと、全体の平均の 2 通り) ----
  const recentSamples = history.slice(-RECENT_SAMPLE_COUNT);
  const recentRate =
    recentSamples.length > 0
      ? recentSamples.reduce((sum, value) => sum + value, 0) /
        recentSamples.length
      : currentRate;
  const averageRate =
    elapsed > 0 ? snapshot.processed / (elapsed / MILLISECONDS_PER_SECOND) : 0;
  const filesLeft = snapshot.total - snapshot.processed;
  const remainingRecent =
    recentRate > 0 ? (filesLeft / recentRate) * MILLISECONDS_PER_SECOND : 0;
  const remainingAverage =
    averageRate > 0 ? (filesLeft / averageRate) * MILLISECONDS_PER_SECOND : 0;
  const finishLabel = new Date(Date.now() + remainingRecent)
    .toTimeString()
    .slice(0, 5);
  const averageSpeed = averageRate * SIMULATED_MEGABYTES_PER_FILE;

  const graphRows = barGraph(
    history,
    rightWidth - PANEL_CHROME,
    GRAPH_HEIGHT
  ).map((row, position) => ({
    id: position,
    row,
  }));
  const graphWidth = rightWidth - PANEL_CHROME;
  const windowSeconds = Math.round(
    Math.min(history.length, graphWidth) * GRAPH_SECONDS_PER_COLUMN
  );
  const showStorage = rows >= FULL_ROWS;
  const showInFlight = rows >= STANDARD_ROWS;
  const showLogs = rows >= MIN_ROWS_WITH_LOGS;
  const visibleLogs = showInFlight ? logs.slice(-5) : logs.slice(-4);

  const lanes: Lane[] = [
    {
      stage: 'スキャン',
      count: stageCounts.scan,
      detail: `${formatNumber(Math.round(currentRate * 1.3))} files/s`,
    },
    {
      stage: 'ハッシュ',
      count: stageCounts.hash,
      detail: `${SHA256_GIGABYTES_PER_SECOND} GB/s SHA-256`,
    },
    {
      stage: 'コピー',
      count: stageCounts.copy,
      detail: `${copySpeed.toFixed(1)} MB/s`,
    },
    {
      stage: '検証',
      count: stageCounts.verify,
      detail: `${verifySpeed.toFixed(1)} MB/s F_NOCACHE`,
    },
  ];

  // パイプライン: 段階の名前を、流れる印でつなぐ
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

  // 処理中のファイル: 大きなファイルほど、バーの進みが遅い
  const inFlightFileWidth =
    leftWidth - PANEL_CHROME - IN_FLIGHT_LABEL_WIDTH - MINI_BAR_WIDTH - 11;
  const verifyRatio = (elapsed % 1200) / 1200;
  const digest = sampleDigest(`${snapshot.currentFile}:${snapshot.processed}`);
  const zip = snapshot.zip;

  const breakdown: {
    label: string;
    value: number;
    of: number;
    color: ColorName;
  }[] = [
    {
      label: '写真',
      value: snapshot.types.photo,
      of: snapshot.processed,
      color: 'cyan',
    },
    {
      label: '動画',
      value: snapshot.types.video,
      of: snapshot.processed,
      color: 'violet',
    },
    {
      label: 'RAW',
      value: snapshot.types.raw,
      of: snapshot.processed,
      color: 'yellow',
    },
    {
      label: 'ZIP',
      value: snapshot.types.zip,
      of: snapshot.processed,
      color: 'orange',
    },
    {
      label: 'メタデータ',
      value: snapshot.dateSources.metadata,
      of: counters.adopted,
      color: 'matrix',
    },
    {
      label: 'ファイル名',
      value: snapshot.dateSources.filename,
      of: counters.adopted,
      color: 'orange',
    },
    {
      label: '日付なし',
      value: snapshot.dateSources.none,
      of: counters.adopted,
      color: 'red',
    },
  ];
  const shares = timeShares(elapsed);

  return (
    <Box flexDirection="column" width={total}>
      <Box>
        <Panel
          title={`run #12 · ${isPaused ? '一時停止' : isStopping ? '停止中' : '実行中'}`}
          width={leftWidth}
          color="cyan"
          background={bg}
        >
          <Text color={text}>
            <Text color={paint('yellow')} bold>
              Backup-copy
            </Text>{' '}
            ➜ <Text bold>PhotoLib</Text>
            <Text color={subtle}> (exFAT)</Text>
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
          <Text color={text}>
            {formatNumber(snapshot.processed)}/{formatNumber(snapshot.total)}{' '}
            files · {formatGigabytes(snapshot.bytesProcessed)}/
            {formatGigabytes(snapshot.bytesTotal)}
          </Text>
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
            残り {formatDuration(remainingRecent)} (直近) /{' '}
            {formatDuration(remainingAverage)} (平均)
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
          title={`throughput ${copySpeed.toFixed(1)} MB/s · 直近 ${windowSeconds} 秒`}
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
            avg {averageSpeed.toFixed(1)} · max {maxSpeed.toFixed(1)} · verify{' '}
            {verifySpeed.toFixed(1)} MB/s
          </Text>
        </Panel>
      </Box>

      <Panel
        title="pipeline  スキャン → ハッシュ → コピー → 検証"
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
              ratio={lane.count / snapshot.total}
              width={laneBarWidth}
              from={STAGE_COLORS[index] ?? 'cyan'}
              to={STAGE_COLORS[index] ?? 'cyan'}
            />
            <Text color={text}>
              {' '}
              {padToWidth(
                `${Math.floor((lane.count / snapshot.total) * PERCENT)}%`,
                4
              )}
              {padToWidth(formatNumber(lane.count), 8)}
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
            {snapshot.inFlight.map((item, index) => {
              const cycle = 500 + item.megabytes * 70;
              const progress = isPaused
                ? 0.5
                : ((elapsed + index * 330) % cycle) / cycle;
              return (
                <Text key={item.stage}>
                  <Text color={paint(STAGE_COLORS[index] ?? 'cyan')} bold>
                    {padToWidth(item.stage, IN_FLIGHT_LABEL_WIDTH)}
                  </Text>
                  <Text color={text}>
                    {padToWidth(
                      truncateToWidth(item.file, inFlightFileWidth),
                      inFlightFileWidth
                    )}{' '}
                  </Text>
                  <Text color={paint(STAGE_COLORS[index] ?? 'cyan')}>
                    {miniBar(progress, MINI_BAR_WIDTH)}
                  </Text>
                  <Text color={subtle}> {item.megabytes.toFixed(1)}MB</Text>
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
                    {miniBar(zip.entry / zip.entries, MINI_BAR_WIDTH)}
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
                  PhotoLib 空き{' '}
                  {formatGigabytes(
                    DESTINATION_CAPACITY_BYTES - snapshot.bytesProcessed
                  )}{' '}
                  · .part 1 · ._ 削除 {formatNumber(stageCounts.copy)}
                </Text>
                <Text>
                  <Text color={paint('matrix')}>
                    検証 ✔ {formatNumber(stageCounts.verify - counters.error)}
                  </Text>
                  <Text color={subtle}> · </Text>
                  <Text
                    color={paint(counters.error > 0 ? 'red' : 'matrix')}
                    bold
                  >
                    ✘ {formatNumber(counters.error)}
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
                  ratio={item.of > 0 ? item.value / item.of : 0}
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
              <Text color={paint('magenta')} bold>
                {digest.slice(0, DIGEST_EDGE)}
              </Text>
              <Text color={subtle}>…{digest.slice(-DIGEST_EDGE)}</Text>
            </Text>
            <Text>
              <Text color={subtle}>verify </Text>
              <Text color={paint('cyan')} bold>
                {partialDigest(digest.slice(0, DIGEST_EDGE), verifyRatio)}
              </Text>
              <Text color={subtle}>
                …{partialDigest(digest.slice(-DIGEST_EDGE), verifyRatio)}{' '}
              </Text>
              <Text color={paint('matrix')}>
                {verifyRatio > 0.9 ? '✔' : spinnerFrame(elapsed)}
              </Text>
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
            <Text color={subtle}>時間の内訳</Text>
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
              <Text
                color={paint(
                  log.level === 'ERROR'
                    ? 'red'
                    : log.level === 'WARN'
                      ? 'orange'
                      : 'matrix'
                )}
              >
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
