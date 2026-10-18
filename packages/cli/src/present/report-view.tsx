import { Box, renderToString, Text } from 'ink';
import { displayWidth, padToWidth } from '../live/format.ts';
import { Badge, GradientText, Panel, ProgressBar } from '../live/parts.tsx';
import { type ColorName, paint } from '../live/theme.ts';
import type { Report, Row, Section, Tone } from './report.ts';

const MAX_WIDTH = 100;
const MIN_WIDTH = 40;
const MAX_LABEL = 18;
const BAR_WIDTH = 16;
const PANEL_CHROME_WIDTH = 4;

const TONE_COLOR: Record<Tone, ColorName> = {
  ok: 'green',
  warn: 'orange',
  error: 'red',
  info: 'blue',
  dim: 'subtle',
};

const toneOf = (tone: Tone | undefined): string | undefined =>
  paint(tone ? TONE_COLOR[tone] : 'text');

const RowView = ({ row, labelWidth }: { row: Row; labelWidth: number }) => (
  <Box>
    <Box width={labelWidth + 2} flexShrink={0}>
      <Text color={paint('subtle')}>{row.label}</Text>
    </Box>
    {row.ratio === undefined ? null : (
      <Box marginRight={1} flexShrink={0}>
        <ProgressBar
          ratio={Math.min(1, Math.max(0, row.ratio))}
          width={BAR_WIDTH}
          from={row.tone ? TONE_COLOR[row.tone] : 'blue'}
          to={row.tone ? TONE_COLOR[row.tone] : 'purple'}
        />
      </Box>
    )}
    <Box flexGrow={1}>
      <Text color={toneOf(row.tone)} bold={row.tone === 'error'}>
        {row.value}
      </Text>
    </Box>
  </Box>
);

const TableView = ({
  table,
  width,
}: {
  table: NonNullable<Section['table']>;
  width: number;
}) => {
  const widths = table.header.map((title, column) =>
    Math.max(
      displayWidth(title),
      ...table.rows.map((row) => displayWidth(row[column] ?? ''))
    )
  );
  const cells = (row: readonly string[]): string =>
    row
      .map((cell, column) =>
        column === row.length - 1
          ? cell
          : padToWidth(cell, (widths[column] ?? 0) + 2)
      )
      .join('');
  const rows = table.rows.map((row, id) => ({ id, row }));
  return (
    <Box flexDirection="column" width={width - PANEL_CHROME_WIDTH}>
      <Text color={paint('yellow')} bold>
        {cells(table.header)}
      </Text>
      {rows.map(({ id, row }) => (
        <Text key={id} color={paint('text')}>
          {cells(row)}
        </Text>
      ))}
    </Box>
  );
};

const SectionView = ({
  section,
  width,
}: {
  section: Section;
  width: number;
}) => {
  const labelWidth = Math.min(
    MAX_LABEL,
    Math.max(0, ...(section.rows ?? []).map((row) => displayWidth(row.label)))
  );
  const rows = (section.rows ?? []).map((row, id) => ({ id, row }));
  const lines = (section.lines ?? []).map((text, id) => ({ id, text }));
  return (
    <Panel
      title={section.title}
      width={width}
      color={section.tone ? TONE_COLOR[section.tone] : 'blue'}
    >
      {rows.map(({ id, row }) => (
        <RowView key={id} row={row} labelWidth={labelWidth} />
      ))}
      {section.table ? <TableView table={section.table} width={width} /> : null}
      {lines.map(({ id, text }) => (
        <Text key={id} color={paint('text')}>
          {text}
        </Text>
      ))}
    </Panel>
  );
};

/** 結果の画面(見出し・枠つきの区画・ひと言) */
export const ReportView = ({
  report,
  columns,
}: {
  report: Report;
  columns: number;
}) => {
  const width = Math.max(MIN_WIDTH, Math.min(columns, MAX_WIDTH));
  const sections = report.sections.map((section, id) => ({ id, section }));
  return (
    <Box flexDirection="column">
      <Box>
        <GradientText text="seiri" from="yellow" to="pink" bold />
        <Text color={paint('subtle')}> ▸ </Text>
        <Text bold>{report.title}</Text>
        {report.badge ? (
          <Text>
            {' '}
            <Badge
              label={report.badge.label}
              background={TONE_COLOR[report.badge.tone]}
            />
          </Text>
        ) : null}
      </Box>
      {sections.map(({ id, section }) => (
        <SectionView key={id} section={section} width={width} />
      ))}
      {report.hint ? (
        <Text color={paint('yellow')}>{`  ➜ ${report.hint}`}</Text>
      ) : null}
    </Box>
  );
};

/** 結果を、色つきの文字列にする(最後の改行は、付けない) */
export const renderReport = (report: Report, columns: number): string =>
  renderToString(<ReportView report={report} columns={columns} />, {
    columns,
  }).replace(/\n+$/, '');
