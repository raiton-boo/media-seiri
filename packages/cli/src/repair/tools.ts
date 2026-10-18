import { copyFileSync, rmSync, statSync } from 'node:fs';
import { ExifTool } from 'exiftool-vendored';

/** 検査・修復の対象の区分 */
export type RepairKind = 'photo' | 'raw' | 'video';

/** 検査の結果。`unavailable` は、検査できなかった(ツールがない・形式に対応しない)。破損とは、しない */
export type CheckResult =
  | { status: 'ok' }
  | { status: 'corrupt'; detail: string }
  | { status: 'unavailable'; detail: string };

/** 修復の 1 手順の結果。`skipped` は、試せなかった(ツールがない)こと */
export type StepResult =
  | { ok: true; detail: string }
  | { ok: false; detail: string; skipped?: boolean };

/**
 * 検査と修復に使う、外のコマンド(ffmpeg・sips・ExifTool)。テストでは、差し替える。
 * どれも、元のファイルには、書かない(出力は、`dest` に作る)。
 */
export type RepairTools = {
  /** 破損の検査(画像: デコード、動画: ストリームを最後まで、RAW: メタデータと埋め込みのプレビュー) */
  check: (path: string, kind: RepairKind, ext: string) => Promise<CheckResult>;
  /** 動画の再構築: コンテナを作り直す(再エンコードしない) */
  remuxVideo: (source: string, dest: string) => Promise<StepResult>;
  /** メタデータの再書込み: 壊れたメタデータを除いて、書き直す(読める日付・GPS は、写し直す) */
  rewriteMetadata: (source: string, dest: string) => Promise<StepResult>;
  /** 切れた画像の救出: 読み取れる範囲の画像データを、保存する */
  salvageImage: (
    source: string,
    dest: string,
    ext: string
  ) => Promise<StepResult>;
  /** 常駐のものを終える */
  close: () => Promise<void>;
};

/** 1 つのコマンドの、待つ時間の上限(ミリ秒)。壊れたファイルで、止まらないようにする */
const COMMAND_TIMEOUT_MS = 10 * 60_000;

type CommandResult = { code: number; stdout: string; stderr: string };

const run = async (command: readonly string[]): Promise<CommandResult> => {
  let process: ReturnType<typeof Bun.spawn>;
  try {
    process = Bun.spawn([...command], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    throw new CommandUnavailable(command[0] ?? '', error);
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout as ReadableStream).text(),
    new Response(process.stderr as ReadableStream).text(),
    process.exited,
  ]);
  return { code, stdout, stderr };
};

/** コマンドがない(使えない) */
class CommandUnavailable extends Error {
  constructor(command: string, cause: unknown) {
    super(`${command} を実行できません`, { cause });
    this.name = 'CommandUnavailable';
  }
}

const tail = (text: string): string =>
  text.trim().split('\n').slice(-2).join(' ').slice(0, 300);

/** ffmpeg でデコードできる画像の拡張子(ほかは、ffmpeg では、検査できない) */
const FFMPEG_IMAGES = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'png',
  'gif',
  'bmp',
  'webp',
  'tif',
  'tiff',
]);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 本物の道具。ffmpeg・sips は、使うときに、探す(なければ、`unavailable`・`skipped`)。ExifTool は、必要になったときに、起動する。
 * 破損の検査は、`ffmpeg -v error` で、**エラーが 1 行でも出たら、破損**とする(切れた JPEG は、終了コードが 0 のまま、`overread` を出すため)。
 */
export const createRepairTools = (): RepairTools => {
  let exiftool: ExifTool | undefined;
  const exif = (): ExifTool => {
    exiftool ??= new ExifTool({ maxProcs: 1 });
    return exiftool;
  };

  const ffmpegCheck = async (args: readonly string[]): Promise<CheckResult> => {
    try {
      const result = await run(['ffmpeg', '-v', 'error', ...args]);
      if (result.code === 0 && result.stderr.trim() === '')
        return { status: 'ok' };
      return {
        status: 'corrupt',
        detail: tail(result.stderr) || `ffmpeg の終了コード ${result.code}`,
      };
    } catch (error) {
      if (error instanceof CommandUnavailable)
        return { status: 'unavailable', detail: error.message };
      throw error;
    }
  };

  const checkRaw = async (path: string): Promise<CheckResult> => {
    const preview = `${path}.check-preview`;
    try {
      const tags = await exif().read(path);
      if (typeof tags.Error === 'string')
        return { status: 'corrupt', detail: tags.Error };
      try {
        await exif().extractPreview(path, preview);
      } catch (error) {
        try {
          await exif().extractThumbnail(path, preview);
        } catch {
          return {
            status: 'corrupt',
            detail: `埋め込みのプレビューを取り出せません(${messageOf(error)})`,
          };
        }
      }
      return { status: 'ok' };
    } catch (error) {
      return { status: 'corrupt', detail: messageOf(error) };
    } finally {
      rmSync(preview, { force: true });
    }
  };

  return {
    check: async (path, kind, ext) => {
      if (kind === 'raw') return checkRaw(path);
      if (kind === 'video')
        return ffmpegCheck([
          '-i',
          path,
          '-map',
          '0',
          '-c',
          'copy',
          '-f',
          'null',
          '-',
        ]);
      if (FFMPEG_IMAGES.has(ext))
        return ffmpegCheck(['-i', path, '-frames:v', '1', '-f', 'null', '-']);
      // HEIC など(ffmpeg では、読めない): sips で、JPEG にできるか
      try {
        const result = await run([
          'sips',
          '-s',
          'format',
          'jpeg',
          path,
          '--out',
          '/dev/null',
        ]);
        return result.code === 0
          ? { status: 'ok' }
          : { status: 'corrupt', detail: tail(result.stderr || result.stdout) };
      } catch (error) {
        if (error instanceof CommandUnavailable)
          return { status: 'unavailable', detail: error.message };
        throw error;
      }
    },

    remuxVideo: async (source, dest) => {
      try {
        const result = await run([
          'ffmpeg',
          '-v',
          'error',
          '-y',
          '-err_detect',
          'ignore_err',
          '-i',
          source,
          '-map',
          '0',
          '-c',
          'copy',
          dest,
        ]);
        return result.code === 0 &&
          statSync(dest, { throwIfNoEntry: false })?.size
          ? { ok: true, detail: 'コンテナを作り直しました(再エンコードなし)' }
          : {
              ok: false,
              detail:
                tail(result.stderr) || `ffmpeg の終了コード ${result.code}`,
            };
      } catch (error) {
        if (error instanceof CommandUnavailable)
          return { ok: false, skipped: true, detail: `ffmpeg が使えません` };
        return { ok: false, detail: messageOf(error) };
      }
    },

    rewriteMetadata: async (source, dest) => {
      try {
        // コピーを作り、メタデータを全部消してから、読める日付・GPS だけを、元から写し直す(写せなくても、続ける)
        copyFileSync(source, dest);
        await exif().write(
          dest,
          {},
          { writeArgs: ['-all=', '-m', '-overwrite_original'] }
        );
        try {
          await exif().write(
            dest,
            {},
            {
              writeArgs: [
                '-tagsFromFile',
                source,
                '-m',
                '-overwrite_original',
                '-DateTimeOriginal',
                '-CreateDate',
                '-ModifyDate',
                '-GPSLatitude',
                '-GPSLongitude',
                '-GPSAltitude',
                '-GPSLatitudeRef',
                '-GPSLongitudeRef',
              ],
            }
          );
        } catch {
          // 壊れたメタデータは、写せない。日付は、ファイル名などで決める
        }
        return { ok: true, detail: '壊れたメタデータを除いて、書き直しました' };
      } catch (error) {
        rmSync(dest, { force: true });
        return { ok: false, detail: messageOf(error) };
      }
    },

    salvageImage: async (source, dest, ext) => {
      try {
        const lossy = ext === 'jpg' || ext === 'jpeg' || ext === 'jpe';
        const result = await run([
          'ffmpeg',
          '-v',
          'error',
          '-y',
          '-err_detect',
          'ignore_err',
          '-i',
          source,
          '-frames:v',
          '1',
          ...(lossy ? ['-q:v', '2'] : []),
          dest,
        ]);
        return result.code === 0 &&
          statSync(dest, { throwIfNoEntry: false })?.size
          ? { ok: true, detail: '読み取れる範囲の画像を、保存しました' }
          : {
              ok: false,
              detail:
                tail(result.stderr) || `ffmpeg の終了コード ${result.code}`,
            };
      } catch (error) {
        if (error instanceof CommandUnavailable)
          return { ok: false, skipped: true, detail: 'ffmpeg が使えません' };
        return { ok: false, detail: messageOf(error) };
      }
    },

    close: async () => {
      await exiftool?.end();
    },
  };
};
