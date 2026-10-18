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
    name: 'doctor',
    summary: 'トラブルを診断して、直し方を案内する(--fix で、安全なものを直す)',
    usage: 'seiri doctor [--library <パス>] [--fix] [-y]',
    about: [
      '登録・ドライブの目印・この Mac の台帳・ロック・スナップショット・中断で残った一時ファイル・付属ファイル・外のコマンドを、調べます。',
      '調べるだけでは、何も書き換えません。見つかった問題には、対処の方法が出ます。',
      '--fix を付けると、安全に直せるもの(古い登録の削除・一時ファイルと付属ファイルの掃除)だけを直します。写真と台帳は、消しません。',
      '終了コード: 0 問題なし / 1 要対応あり',
    ],
    options: [
      LIBRARY,
      { flag: '--fix', text: '安全に直せるものを、直す(直す前に、確認します)' },
      {
        flag: '--deep',
        text: '深く調べる(台帳にある全ファイルの、存在・大きさ・サムネイル。時間がかかります。中身の照合は、seiri verify)',
      },
      { flag: '-y, --yes', text: '--fix の確認を、省く' },
      {
        flag: '--report <ファイル>',
        text: '共有できる診断の報告を、書き出す(.json なら JSON、それ以外は文章)。パス・ファイル名は、伏せます',
      },
      {
        flag: '--include-paths',
        text: '--report に、パス・ファイル名も、含める',
      },
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri doctor', text: '診断だけ' },
      {
        command: 'seiri doctor --report seiri-report.json',
        text: '問題を共有するための報告を、書き出す',
      },
      {
        command: 'seiri doctor --deep',
        text: 'ファイルの存在・大きさまで、深く調べる',
      },
      { command: 'seiri doctor --fix', text: '診断して、直せるものを直す' },
    ],
  },
  {
    name: 'library remove',
    summary: '空のライブラリ(間違えて作った目印)を、片づける',
    usage: 'seiri library remove <ID または場所> [-y]',
    about: [
      '間違えて作った、写真の入っていないライブラリを、片づけます。目印・管理用のフォルダ(.file-seiri)・設定の登録・この Mac の空の台帳を、消します。',
      '写真などが 1 つでも入っていれば、何も消さずに、断ります(設定から外すだけなら、library forget)。',
    ],
    options: [{ flag: '-y, --yes', text: '確認を、省く' }, DATA_DIR],
    examples: [
      {
        command: 'seiri library remove /Volumes/Photos/Pictures',
        text: '場所を指定して、片づける',
      },
    ],
  },
  {
    name: 'library forget',
    summary: 'ライブラリを、設定から外す(ファイルは、消さない)',
    usage: 'seiri library forget <ID または場所>',
    about: [
      'この Mac の設定から、登録を外すだけです。ライブラリのファイル・目印・この Mac の台帳は、そのままです。',
      'ID は、seiri library list の左の列(先頭 4 文字以上)で指定できます。',
    ],
    options: [DATA_DIR],
    examples: [
      { command: 'seiri library forget 35c0', text: 'ID の先頭で、指定する' },
    ],
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
        flag: '--no-spot-check',
        text: '取り込みの最後の、抜き取り照合(コピーした一部を、読み直す)を、行わない',
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
        flag: '--no-open',
        text: 'ブラウザを、自動で開かない(既定では、端末で動かすと、開きます)',
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
    summary: '今の状況(ロック・直近の実行)を見る。--watch で、取り込みを見張る',
    usage: 'seiri status [--library <パス>] [--watch [--interval <秒>]]',
    about: [
      'ほかの実行が動いていないか(ロック)と、直近の実行の結果を、表示します。',
      '--watch を付けると、別のウィンドウから、実行中の取り込みを、見張れます(進み具合・件数・直近のログを、更新して出します)。実行中のものがなければ、始まるまで待ち、見張っていた実行が終わると、自動で終わります。',
    ],
    options: [
      LIBRARY,
      { flag: '-w, --watch', text: '実行中の取り込みを、見張る' },
      { flag: '--interval <秒>', text: '--watch の更新の間隔(既定 1 秒)' },
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri status', text: '状況を見る' },
      {
        command: 'seiri status --watch',
        text: '別のウィンドウから、取り込みを見張る',
      },
    ],
  },
  {
    name: 'backup',
    summary: 'この Mac の台帳(data/)を、バックアップする',
    usage: 'seiri backup [--to <場所>] [--with-thumbs] [--list]',
    about: [
      'この Mac の設定と、ライブラリごとの台帳を、日時つきのフォルダへ、コピーします(取り込み中でも、壊れない形で)。',
      'あわせて、ドライブのスナップショットと、突き合わせます(どちらが新しいか)。ライブラリのドライブには、何も書きません。',
      '復元は、バックアップの中身を、data/ へ、コピーし直します。大事なデータは、別のドライブにも、置いてください(--to)。',
    ],
    options: [
      {
        flag: '--to <場所>',
        text: 'バックアップを置く場所(既定: data/backups/)',
      },
      {
        flag: '--with-thumbs',
        text: 'この Mac のサムネイルも、含める(大きくなります)',
      },
      { flag: '--list', text: '作らずに、バックアップの一覧を見る' },
      LIBRARY,
      DATA_DIR,
    ],
    examples: [
      { command: 'seiri backup', text: 'バックアップを作る' },
      {
        command: 'seiri backup --to /Volumes/Backup/seiri',
        text: '別のドライブへ',
      },
    ],
  },
  {
    name: 'sources',
    summary: '取り込み元(SD カード・ドライブ)ごとの履歴を見る',
    usage: 'seiri sources [--library <パス>]',
    about: [
      '取り込み元ごとに、これまでの取り込みの回数・取り込み済みのファイル数・最後の取り込み・dry-run の回数を、一覧にします。',
      '同じ取り込み元を、また取り込むと、取り込み済みのファイルは、スキップされます(取り込みの結果にも、履歴が出ます)。',
    ],
    options: [LIBRARY, DATA_DIR],
    examples: [{ command: 'seiri sources', text: '履歴を見る' }],
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
