import { rmSync } from 'node:fs';
import { ExifTool } from 'exiftool-vendored';

/** サムネイルにするファイルの区分 */
export type ThumbnailKind = 'photo' | 'raw' | 'video';

export type ThumbnailRequest = {
  kind: ThumbnailKind;
  sourcePath: string;
  /** 書き出す JPEG のパス(拡張子は `.jpg`)。親フォルダは、あるものとする */
  outputPath: string;
};

/**
 * サムネイルを 1 枚作る。作れなければ、理由つきの例外を投げる(呼び出し側が、WARN にして、続ける)。
 * 外のコマンド(sips・ffmpeg・ExifTool)を使うため、テストでは、差し替える。
 */
export type ThumbnailMaker = {
  make: (request: ThumbnailRequest) => Promise<void>;
  /** 常駐のものを終える。使い終わったら、必ず呼ぶ */
  close: () => Promise<void>;
};

/** 一覧用の 1 サイズ。長辺(ピクセル)。元より大きくは、しない */
export const THUMBNAIL_MAX_EDGE = 400;
/** JPEG の品質(sips: 0〜100) */
const JPEG_QUALITY = 80;
/** 動画の代表の 1 コマは、長さの、この割合の位置(最初の 1 コマは、黒いことが多いため) */
const VIDEO_FRAME_POSITION = 0.1;
/** 1 つのコマンドの、待つ時間の上限(ミリ秒)。壊れたファイルで、止まらないようにする */
const COMMAND_TIMEOUT_MS = 60_000;

const tail = (text: string): string =>
  text.trim().split('\n').slice(-2).join(' ');

type CommandResult = { ok: boolean; stdout: string; stderr: string };

const runCommand = async (
  command: readonly string[]
): Promise<CommandResult> => {
  let process: ReturnType<typeof Bun.spawn>;
  try {
    process = Bun.spawn([...command], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    // コマンドがない(ENOENT)など
    throw new Error(
      `${command[0]} を実行できませんでした: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout as ReadableStream).text(),
    new Response(process.stderr as ReadableStream).text(),
    process.exited,
  ]);
  return { ok: exitCode === 0, stdout, stderr };
};

/** 画像の長辺(ピクセル)。`sips` で読む。読めなければ、undefined */
const longEdgeOf = async (path: string): Promise<number | undefined> => {
  const result = await runCommand([
    'sips',
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    path,
  ]);
  if (!result.ok) return undefined;
  const sizes = [
    ...result.stdout.matchAll(/pixel(?:Width|Height): (\d+)/g),
  ].map((match) => Number(match[1]));
  return sizes.length === 2 ? Math.max(...sizes) : undefined;
};

/**
 * 写真(HEIC を含む)を、`sips` で、JPEG にする。長辺が大きいときだけ、縮小する
 * (`sips -Z` は、小さい画像を拡大してしまうため)。EXIF の向きは、タグのまま残る(表示側が、従う)。
 */
const makeFromImage = async (source: string, output: string): Promise<void> => {
  const longEdge = await longEdgeOf(source);
  const resize =
    longEdge !== undefined && longEdge <= THUMBNAIL_MAX_EDGE
      ? []
      : ['-Z', String(THUMBNAIL_MAX_EDGE)];
  const result = await runCommand([
    'sips',
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    String(JPEG_QUALITY),
    ...resize,
    source,
    '--out',
    output,
  ]);
  if (!result.ok) {
    throw new Error(
      `sips が失敗しました: ${tail(result.stderr || result.stdout)}`
    );
  }
};

/** 動画の長さ(秒)。分からなければ、undefined */
const videoDuration = async (source: string): Promise<number | undefined> => {
  const result = await runCommand([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    source,
  ]);
  const seconds = Number(result.stdout.trim());
  return result.ok && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : undefined;
};

const extractFrame = async (
  source: string,
  output: string,
  position: number
): Promise<boolean> => {
  const result = await runCommand([
    'ffmpeg',
    '-v',
    'error',
    '-y',
    '-ss',
    position.toFixed(3),
    '-i',
    source,
    '-frames:v',
    '1',
    // 元より大きくせず、JPEG(フル レンジ)にできる形式にそろえる
    '-vf',
    `scale='min(${THUMBNAIL_MAX_EDGE},iw)':-2,format=yuvj420p`,
    '-q:v',
    '4',
    output,
  ]);
  return result.ok;
};

/** 動画の代表の 1 コマ(長さの 10% の位置)を、ffmpeg で取り出す。位置が合わず、取れなければ、最初の 1 コマ */
const makeFromVideo = async (source: string, output: string): Promise<void> => {
  const duration = await videoDuration(source);
  const position = duration === undefined ? 0 : duration * VIDEO_FRAME_POSITION;
  if (position > 0 && (await extractFrame(source, output, position))) return;
  if (await extractFrame(source, output, 0)) return;
  throw new Error('ffmpeg で、動画のコマを取り出せませんでした');
};

/** 本物のメーカー。ExifTool は、RAW が出てきたときに、はじめて起動する */
export const createThumbnailMaker = (): ThumbnailMaker => {
  let exiftool: ExifTool | undefined;
  const exifTool = (): ExifTool => {
    exiftool ??= new ExifTool({ maxProcs: 1 });
    return exiftool;
  };

  /** RAW は、埋め込みのプレビュー(JPEG)を取り出し、sips で縮小する */
  const makeFromRaw = async (source: string, output: string): Promise<void> => {
    const preview = `${output}.preview`;
    try {
      const tool = exifTool();
      try {
        await tool.extractPreview(source, preview);
      } catch {
        // 大きなプレビューがなければ、小さなサムネイルで代える
        await tool.extractThumbnail(source, preview);
      }
      await makeFromImage(preview, output);
    } finally {
      rmSync(preview, { force: true });
    }
  };

  return {
    make: async ({ kind, sourcePath, outputPath }) => {
      if (kind === 'photo') return makeFromImage(sourcePath, outputPath);
      if (kind === 'video') return makeFromVideo(sourcePath, outputPath);
      return makeFromRaw(sourcePath, outputPath);
    },
    close: async () => {
      await exiftool?.end();
    },
  };
};
