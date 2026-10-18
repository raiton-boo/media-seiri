import { ansi } from './live/theme.ts';

/** `seiri --help` と、`seiri <コマンド> --help` の説明。コマンドごとに、意味・オプション・例を持つ */

type Option = { flag: string; text: string };
type Example = { command: string; text: string };

type CommandHelp = {
  name: string;
  /** 一覧に出す、1 行の説明 */
  summary: string;
  /** 使い方の形 */
  usage: string;
  /** くわしい説明(段落ごと) */
  about: string[];
  options: Option[];
  examples: Example[];
};

const DATA_DIR: Option = {
  flag: '--data-dir <パス>',
  text: '作業用の領域(data/)の場所。環境変数 FILE_SEIRI_DATA_DIR でも指定できます',
};
const LIBRARY: Option = {
  flag: '--library <パス>',
  text: '対象のライブラリの根。登録が 1 つだけなら、省けます',
};

export const COMMAND_HELPS: readonly CommandHelp[] = [
  {
    name: 'library init',
    summary: 'ライブラリ(写真の置き場)を作る',
    usage: 'seiri library init <保存先のパス>',
    about: [
      '写真を整理して置く場所(ライブラリ)を作ります。目印・台帳・設定のファイルが、そこに作られます。',
      '最初に 1 回だけ、行います。',
    ],
    options: [DATA_DIR],
    examples: [
      {
        command: 'seiri library init /Volumes/Photos/Pictures',
        text: '外付けドライブに作る',
      },
    ],
  },
  {
    name: 'library list',
    summary: '登録済みのライブラリの一覧(接続中かどうかつき)',
    usage: 'seiri library list',
    about: [
      'この Mac に登録されたライブラリを、一覧にします。ドライブが接続中かどうかも出ます。',
      'ライブラリが複数あるとき、`status`・`viewer` などは、接続中のものが 1 つだけなら、それを自動で使います。複数なら、端末で選べます(端末でなければ、--library で指定)。',
    ],
    options: [DATA_DIR],
    examples: [{ command: 'seiri library list', text: '一覧を見る' }],
  },
  {
    name: 'library prune',
    summary: '古い登録(同じ場所に作り直したライブラリ)を、設定から外す',
    usage: 'seiri library prune [-y]',
    about: [
      '同じ場所で、ライブラリを作り直すと、前の登録が、設定に残ります(`library list` で「古い登録」と出ます)。',
      'それを、設定から外します。ライブラリのファイルも、この Mac の台帳(data/libraries/)も、消しません。',
    ],
    options: [{ flag: '-y, --yes', text: '確認を、省く' }, DATA_DIR],
    examples: [{ command: 'seiri library prune', text: '古い登録を、外す' }],
  },
  {
    name: 'ingest',
    summary: '写真・動画を、ライブラリに取り込む',
    usage: 'seiri ingest [<ソース...>] [--dest <ライブラリの根>] [オプション]',
    about: [
      '【選びながら進める】ソースや --dest を省いて、端末で実行すると、取り込み元(ドライブ・フォルダ)と保存先を、番号で選べます。最後に、同じことを自分で行うコマンドも、表示します。',
      '指定した場所(フォルダ・ZIP)の写真・動画を、撮影日ごとに整理して、ライブラリにコピーします。',
      '元のファイルは、変えません。コピーしたあと、中身が同じか、照合します。',
      '途中で止めても大丈夫です(q か Ctrl-C)。--resume で、続きから実行できます。',
      '端末で実行すると、進み具合の画面が出ます。キー: p 一時停止 / l ログ全画面 / q 安全に停止。',
    ],
    options: [
      {
        flag: '<ソース...>',
        text: '取り込む、フォルダや ZIP(いくつでも。省くと、選べます)',
      },
      {
        flag: '--dest <パス>',
        text: '保存先(ライブラリの根。省くと、選べます)',
      },
      {
        flag: '--dry-run',
        text: 'コピーせずに、結果と容量の見積りだけを見る',
      },
      { flag: '-y, --yes', text: 'コピー前の確認を、省く' },
      { flag: '--resume', text: '中断した実行を、続きから実行する' },
      {
        flag: '--plain',
        text: '進み具合の画面を使わず、ログの行だけを出す(端末でないときは、いつも、こう)',
      },
      {
        flag: '--rehash',
        text: 'ハッシュのキャッシュを使わず、計算し直す',
      },
      {
        flag: '--restore-snapshot',
        text: 'スナップショットのほうが新しいとき、置き換えてよい',
      },
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri ingest', text: '選びながら、進める(端末で)' },
      {
        command:
          'seiri ingest ~/Pictures/旅行 --dest /Volumes/Photos/Pictures --dry-run',
        text: 'まず、結果だけ見る',
      },
      {
        command:
          'seiri ingest /Volumes/SDCARD/DCIM --dest /Volumes/Photos/Pictures',
        text: 'SD カードから取り込む',
      },
      {
        command: 'seiri ingest takeout.zip --dest /Volumes/Photos/Pictures -y',
        text: 'ZIP を、確認なしで取り込む',
      },
    ],
  },
  {
    name: 'viewer',
    summary: '取り込んだ写真を、ブラウザで見る',
    usage: 'seiri viewer [--library <パス>] [--port <番号>] [--snapshot]',
    about: [
      'アルバム・カレンダー・地図・統計を、ブラウザで見られるようにします。見るだけで、ファイルは変えません。',
      'この Mac の 127.0.0.1 だけで配信するので、ほかの機器からは見えません。止めるときは、Ctrl-C。',
    ],
    options: [
      LIBRARY,
      {
        flag: '--port <番号>',
        text: '待ち受けるポート(既定 3939。0 なら、空いているもの)',
      },
      {
        flag: '--snapshot',
        text: 'この Mac の台帳ではなく、ライブラリのスナップショットを開く(家の PC と同じ見え方)',
      },
      DATA_DIR,
    ],
    examples: [
      {
        command: 'seiri viewer',
        text: 'ブラウザで見る(http://127.0.0.1:3939)',
      },
      { command: 'seiri viewer --port 8080', text: 'ポートを変える' },
    ],
  },
  {
    name: 'viewer-install',
    summary: '閲覧専用ビューアを、ドライブに置く(Windows でも見られる)',
    usage: 'seiri viewer-install [--library <パス>]',
    about: [
      'ライブラリの viewer/ フォルダに、閲覧専用ビューア(Windows・Mac 用の実行ファイル)を置きます。',
      'ドライブを Windows の PC につないで、その実行ファイルを開くと、ブラウザで、写真を見られます(見るだけ)。',
      '取り込みの最後に、自動でも置かれます(ビューアの実行ファイルの一式が、見つかるとき)。',
    ],
    options: [LIBRARY, DATA_DIR],
    examples: [
      { command: 'seiri viewer-install', text: 'ビューアを、ドライブに置く' },
    ],
  },
  {
    name: 'status',
    summary: '今の状況(ロック・直近の実行)を見る',
    usage: 'seiri status [--library <パス>]',
    about: [
      'ほかの実行が動いていないか(ロック)と、直近の実行の結果を、表示します。',
    ],
    options: [LIBRARY, DATA_DIR],
    examples: [{ command: 'seiri status', text: '状況を見る' }],
  },
  {
    name: 'logs',
    summary: '実行のログを見る',
    usage: 'seiri logs [--run <ID>] [--level <レベル>] [--tail <N>] [-f]',
    about: [
      '取り込みなどのログを表示します。既定は、直近の実行の、INFO 以上です。',
      '-f を付けると、動いている実行のログを、追いかけて表示します。',
    ],
    options: [
      { flag: '--run <ID>', text: '見る実行を選ぶ' },
      {
        flag: '--level <レベル>',
        text: 'DEBUG / INFO / WARN / ERROR のうち、この以上を出す',
      },
      { flag: '--tail <N>', text: '最後の N 行だけ出す' },
      { flag: '-f, --follow', text: '新しいログを、追いかける' },
      { flag: '--verbose / --quiet', text: 'くわしく / 少なく' },
      LIBRARY,
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri logs --level WARN', text: '警告とエラーだけ見る' },
      { command: 'seiri logs -f', text: '実行中のログを追いかける' },
    ],
  },
  {
    name: 'verify',
    summary: 'ライブラリのファイルが壊れていないか確かめる',
    usage: 'seiri verify [--library <パス>] [--sample <割合>]',
    about: [
      'ライブラリの全ファイルを読み直して、台帳の記録と照合します。見つけた問題は、表示するだけで、直したり消したりはしません。',
      '時間がかかるときは、--sample で、一部だけ確かめられます。',
    ],
    options: [
      { flag: '--sample <割合>', text: '抜き取りで行う(例: 0.1、10%)' },
      LIBRARY,
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri verify', text: 'すべて確かめる' },
      { command: 'seiri verify --sample 10%', text: '10% だけ確かめる' },
    ],
  },
  {
    name: 'thumbs',
    summary: 'サムネイルのない写真に、サムネイルを作る',
    usage: 'seiri thumbs [--library <パス>]',
    about: [
      'サムネイルがないファイルに、作ります。何度実行しても、大丈夫です。',
    ],
    options: [LIBRARY, DATA_DIR],
    examples: [{ command: 'seiri thumbs', text: '足りないサムネイルを作る' }],
  },
  {
    name: 'events',
    summary: 'アルバムの「できごと」を計算し直す',
    usage: 'seiri events [--library <パス>]',
    about: [
      '撮影の日時と場所から、旅行などの「できごと」を、計算し直します。',
      '取り込みの最後に、自動でも計算されます。',
    ],
    options: [LIBRARY, DATA_DIR],
    examples: [{ command: 'seiri events', text: '計算し直す' }],
  },
  {
    name: 'drives',
    summary: '接続中のドライブの一覧を見る',
    usage: 'seiri drives',
    about: [
      '名前・容量・空き・形式・種類・状態と、ライブラリがあるかを、一覧にします。',
    ],
    options: [DATA_DIR],
    examples: [{ command: 'seiri drives', text: '一覧を見る' }],
  },
];

const painter = (color: boolean) => ({
  title: (text: string) =>
    color ? ansi(text, { fg: 'yellow', bold: true }) : text,
  name: (text: string) => (color ? ansi(text, { bold: true }) : text),
  dim: (text: string) => (color ? ansi(text, { fg: 'subtle' }) : text),
  cmd: (text: string) => (color ? ansi(text, { fg: 'cyan' }) : text),
});

/** 左の列の幅をそろえる(全角は 2 つ分として数える) */
const width = (text: string): number =>
  [...text].reduce(
    (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1),
    0
  );
const pad = (text: string, size: number): string =>
  text + ' '.repeat(Math.max(0, size - width(text)));

export const findCommandHelp = (
  words: readonly string[]
): CommandHelp | undefined =>
  COMMAND_HELPS.find((help) => help.name === words.join(' ')) ??
  COMMAND_HELPS.find((help) => help.name.split(' ')[0] === words[0]);

/** コマンド名(「もしかして」の候補)。`library init` は、`library` */
export const COMMAND_NAMES: readonly string[] = [
  ...new Set(COMMAND_HELPS.map((help) => help.name.split(' ')[0] ?? help.name)),
  'help',
];

/** コマンドの一覧(`seiri --help`) */
export const renderOverview = (color: boolean): string => {
  const p = painter(color);
  const size = Math.max(...COMMAND_HELPS.map((help) => width(help.name))) + 2;
  const lines = [
    `${p.name('seiri')} ${p.dim('(file-seiri)')} — 写真・動画を、撮影日ごとに整理するツール`,
    '',
    p.title('使い方'),
    `  seiri                     選びながら進める(メニューが出ます)`,
    `  seiri <コマンド> [オプション]   直接、コマンドを指定する`,
    '',
    p.title('コマンド'),
    ...COMMAND_HELPS.map(
      (help) => `  ${p.cmd(pad(help.name, size))}${help.summary}`
    ),
    '',
    p.title('はじめての流れ'),
    `  ${p.cmd('seiri library init /Volumes/Photos/Pictures')}`,
    `  ${p.cmd('seiri ingest ~/Pictures/旅行 --dest /Volumes/Photos/Pictures')}`,
    `  ${p.cmd('seiri viewer')}`,
    '',
    p.title('ヘルプ'),
    `  ${p.cmd('seiri <コマンド> --help')}   そのコマンドの、くわしい説明と例を見る(例: seiri ingest --help)`,
    `  ${p.cmd('seiri -v, --version')}     バージョンを見る`,
    '',
    p.dim('元のファイルは、変えません。取り込みは、コピーです。'),
  ];
  return lines.join('\n');
};

/** コマンドごとの説明(`seiri ingest --help`) */
export const renderCommandHelp = (
  help: CommandHelp,
  color: boolean
): string => {
  const p = painter(color);
  const size =
    Math.max(...help.options.map((option) => width(option.flag))) + 2;
  return [
    `${p.name(`seiri ${help.name}`)} — ${help.summary}`,
    '',
    p.title('使い方'),
    `  ${help.usage}`,
    '',
    ...help.about,
    '',
    p.title('オプション'),
    ...help.options.map(
      (option) => `  ${p.cmd(pad(option.flag, size))}${option.text}`
    ),
    `  ${p.cmd(pad('-h, --help', size))}この説明を表示する`,
    '',
    p.title('例'),
    ...help.examples.flatMap((example) => [
      `  ${p.dim(`# ${example.text}`)}`,
      `  ${p.cmd(example.command)}`,
    ]),
  ].join('\n');
};
