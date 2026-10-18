import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepairMethod } from '@file-seiri/ledger';
import type { RepairKind, RepairTools, StepResult } from './tools.ts';

/** 試した手順 1 つの記録(`repair_attempts` に残す) */
export type AttemptLog = {
  method: RepairMethod;
  success: boolean;
  /** 修復で作った、別ファイルのパス(成功したときだけ) */
  outputPath?: string;
  detail: string;
};

export type RepairOutcome =
  | {
      verdict: 'repaired';
      outputPath: string;
      attempts: AttemptLog[];
      /** 元より小さい(一部だけを救出した) */
      partial: boolean;
    }
  // 試して、直らなかった
  | { verdict: 'failed'; attempts: AttemptLog[]; skipped: string[] }
  // 1 つも試せなかった(ツールがない)
  | { verdict: 'not-attempted'; attempts: AttemptLog[]; skipped: string[] };

export type RepairRequest = {
  tools: RepairTools;
  kind: RepairKind;
  /** 小文字の拡張子(ドットなし) */
  ext: string;
  sourcePath: string;
  /** 修復で作る別ファイルを置くフォルダ(`repaired/`。あるものとする) */
  outputDir: string;
  /** 出力ファイル名の頭(`<source_file_id>-<元の名前>`)。手順ごとに、接尾辞を付ける */
  baseName: string;
};

/** 試す手順の順(`flows.md` 5 章): 動画は 再構築 → 再書込み。画像は 再書込み → 救出。RAW は 再書込みだけ */
const STEPS: Record<RepairKind, readonly RepairMethod[]> = {
  video: ['video_remux', 'metadata_rewrite'],
  photo: ['metadata_rewrite', 'image_salvage'],
  raw: ['metadata_rewrite'],
};

const STEP_LABELS: Record<RepairMethod, string> = {
  video_remux: '動画の再構築',
  metadata_rewrite: 'メタデータの再書込み',
  image_salvage: '切れた画像の救出',
};

/**
 * 修復を試みる。各手順のあと、出力を再検査し、読み取れたら、そこで終える。
 * 元のファイルには、触らない。出力は `outputDir` に作り、失敗した手順の出力は、消す(成功した 1 つだけを残す)。
 */
export const repairFile = async (
  request: RepairRequest
): Promise<RepairOutcome> => {
  const { tools, kind, ext, sourcePath, outputDir, baseName } = request;
  const attempts: AttemptLog[] = [];
  const skipped: string[] = [];
  const sourceSize = statSync(sourcePath).size;

  for (const method of STEPS[kind]) {
    const output = join(outputDir, `${baseName}.${method}.${ext}`);
    let result: StepResult;
    try {
      result =
        method === 'video_remux'
          ? await tools.remuxVideo(sourcePath, output)
          : method === 'metadata_rewrite'
            ? await tools.rewriteMetadata(sourcePath, output)
            : await tools.salvageImage(sourcePath, output, ext);
    } catch (error) {
      result = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (!result.ok && result.skipped) {
      skipped.push(`${STEP_LABELS[method]}: ${result.detail}`);
      continue;
    }
    if (!result.ok) {
      rmSync(output, { force: true });
      attempts.push({ method, success: false, detail: result.detail });
      continue;
    }
    const check = await tools.check(output, kind, ext);
    if (check.status === 'ok') {
      const outputSize = statSync(output).size;
      const partial = outputSize < sourceSize && method === 'image_salvage';
      attempts.push({
        method,
        success: true,
        outputPath: output,
        detail: partial
          ? `${result.detail}(一部のみ救出。元より小さい)`
          : result.detail,
      });
      return { verdict: 'repaired', outputPath: output, attempts, partial };
    }
    rmSync(output, { force: true });
    attempts.push({
      method,
      success: false,
      detail: `${result.detail}が、まだ読み取れません: ${check.detail}`,
    });
  }
  return attempts.length === 0
    ? { verdict: 'not-attempted', attempts, skipped }
    : { verdict: 'failed', attempts, skipped };
};

/** エラー一覧に残す、試した手順と理由の文(`REPAIR_FAILED` の詳細) */
export const describeAttempts = (
  attempts: readonly AttemptLog[],
  skipped: readonly string[] = []
): string =>
  [
    ...attempts.map(
      (attempt) =>
        `${STEP_LABELS[attempt.method]}: ${attempt.success ? '成功' : '失敗'}(${attempt.detail})`
    ),
    ...skipped.map((item) => `${item}(スキップ)`),
  ].join(' / ');
