import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeAttempts, repairFile } from './repair.ts';
import {
  type CheckResult,
  createRepairTools,
  type RepairTools,
  type StepResult,
} from './tools.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-repair-'));
  dirs.push(dir);
  return dir;
};

/** 手順ごとの結果を決められる、偽の道具。作る手順は、出力ファイルを書く */
const fakeTools = (
  steps: Partial<
    Record<'remux' | 'rewrite' | 'salvage', StepResult & { content?: string }>
  >,
  check: (path: string) => CheckResult = () => ({ status: 'ok' })
): RepairTools & { calls: string[] } => {
  const calls: string[] = [];
  const act = (
    name: 'remux' | 'rewrite' | 'salvage',
    dest: string
  ): StepResult => {
    calls.push(name);
    const step = steps[name] ?? { ok: false, detail: '何もしない' };
    if (step.ok) writeFileSync(dest, step.content ?? 'repaired');
    return step;
  };
  return {
    calls,
    check: async (path) => check(path),
    remuxVideo: async (_s, dest) => act('remux', dest),
    rewriteMetadata: async (_s, dest) => act('rewrite', dest),
    salvageImage: async (_s, dest) => act('salvage', dest),
    close: async () => {},
  };
};

const request = (
  tools: RepairTools,
  kind: 'photo' | 'video' | 'raw',
  source = 'x'.repeat(100)
) => {
  const dir = temp();
  const sourcePath = join(dir, 'src.bin');
  writeFileSync(sourcePath, source);
  return {
    tools,
    kind,
    ext: kind === 'video' ? 'mp4' : 'jpg',
    sourcePath,
    outputDir: dir,
    baseName: '7-a',
  };
};

describe('repairFile(手順の順序と、再検査)', () => {
  test('動画: 再構築で直れば、そこで終わる(再書込みは、試さない)', async () => {
    const tools = fakeTools({ remux: { ok: true, detail: '作り直した' } });
    const outcome = await repairFile(request(tools, 'video'));
    expect(outcome.verdict).toBe('repaired');
    expect(tools.calls).toEqual(['remux']);
    expect(outcome.attempts).toEqual([
      expect.objectContaining({ method: 'video_remux', success: true }),
    ]);
  });

  test('画像: 再書込みで直らなければ、救出へ。直らなかった手順の出力は、消す', async () => {
    const tools = fakeTools(
      {
        rewrite: { ok: true, detail: '書き直した' },
        salvage: { ok: true, detail: '救出した', content: 'ok-image' },
      },
      (path) =>
        readFileSync(path, 'utf8') === 'ok-image'
          ? { status: 'ok' }
          : { status: 'corrupt', detail: 'まだ壊れている' }
    );
    const req = request(tools, 'photo');
    const outcome = await repairFile(req);
    expect(tools.calls).toEqual(['rewrite', 'salvage']);
    expect(outcome.verdict).toBe('repaired');
    expect(outcome.attempts.map((a) => [a.method, a.success])).toEqual([
      ['metadata_rewrite', false],
      ['image_salvage', true],
    ]);
    expect(outcome.attempts[0]?.detail).toContain('まだ読み取れません');
    // 失敗した手順の出力は、ない。成功した 1 つだけが、残る
    expect(existsSync(join(req.outputDir, '7-a.metadata_rewrite.jpg'))).toBe(
      false
    );
    if (outcome.verdict === 'repaired') {
      expect(existsSync(outcome.outputPath)).toBe(true);
      // 元より小さい救出は、「一部のみ」
      expect(outcome.partial).toBe(true);
      expect(outcome.attempts[1]?.detail).toContain('一部のみ救出');
    }
  });

  test('全部失敗: failed。試した手順が、すべて残る。RAW は再書込みだけ', async () => {
    const tools = fakeTools({});
    const outcome = await repairFile(request(tools, 'raw'));
    expect(outcome.verdict).toBe('failed');
    expect(tools.calls).toEqual(['rewrite']);
    expect(describeAttempts(outcome.attempts)).toContain(
      'メタデータの再書込み: 失敗'
    );
  });

  test('ツールが使えず、1 つも試せなかった: not-attempted(スキップを記録)', async () => {
    const tools = fakeTools({
      remux: { ok: false, skipped: true, detail: 'ffmpeg が使えません' },
      rewrite: { ok: false, skipped: true, detail: 'ExifTool が使えません' },
    });
    const outcome = await repairFile(request(tools, 'video'));
    expect(outcome.verdict).toBe('not-attempted');
    expect(outcome.verdict === 'not-attempted' && outcome.skipped).toHaveLength(
      2
    );
  });

  test('一部だけスキップ: 残りを試して、直らなければ failed(CORRUPTED ではない)', async () => {
    const tools = fakeTools({
      remux: { ok: false, skipped: true, detail: 'ffmpeg が使えません' },
      rewrite: { ok: false, detail: '失敗' },
    });
    const outcome = await repairFile(request(tools, 'video'));
    expect(outcome.verdict).toBe('failed');
    expect(
      describeAttempts(
        outcome.attempts,
        outcome.verdict === 'failed' ? outcome.skipped : []
      )
    ).toContain('スキップ');
  });

  test('手順が例外を投げても、失敗として扱い、続ける', async () => {
    const tools: RepairTools = {
      ...fakeTools({ salvage: { ok: true, detail: '救出した' } }),
      rewriteMetadata: async () => {
        throw new Error('ExifTool が落ちた');
      },
    };
    const outcome = await repairFile(request(tools, 'photo'));
    expect(outcome.verdict).toBe('repaired');
    expect(outcome.attempts[0]).toMatchObject({
      method: 'metadata_rewrite',
      success: false,
      detail: 'ExifTool が落ちた',
    });
  });

  test('元のファイルは、変更しない', async () => {
    const tools = fakeTools({ remux: { ok: true, detail: '作り直した' } });
    const req = request(tools, 'video', 'ORIGINAL');
    await repairFile(req);
    expect(readFileSync(req.sourcePath, 'utf8')).toBe('ORIGINAL');
  });
});

const hasFfmpeg = Bun.which('ffmpeg') !== null;
const maybe = hasFfmpeg ? describe : describe.skip;

maybe('本物の ffmpeg で(切れた画像・動画)', () => {
  const makeMedia = async (dir: string) => {
    const run = async (args: string[]) => {
      const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-y', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;
    };
    await run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=800x600:rate=1',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      join(dir, 'ok.jpg'),
    ]);
    await run([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=10',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      join(dir, 'ok.mkv'),
    ]);
  };
  const truncate = (from: string, to: string, ratio: number) => {
    const bytes = readFileSync(from);
    writeFileSync(to, bytes.subarray(0, Math.floor(bytes.length * ratio)));
  };

  test('切れた JPEG: 検査で破損と分かり、救出で直る(元は、変わらない)', async () => {
    const dir = temp();
    await makeMedia(dir);
    const broken = join(dir, 'broken.jpg');
    truncate(join(dir, 'ok.jpg'), broken, 0.6);
    const before = readFileSync(broken);
    const tools = createRepairTools();
    try {
      expect(
        (await tools.check(join(dir, 'ok.jpg'), 'photo', 'jpg')).status
      ).toBe('ok');
      expect((await tools.check(broken, 'photo', 'jpg')).status).toBe(
        'corrupt'
      );
      const outcome = await repairFile({
        tools,
        kind: 'photo',
        ext: 'jpg',
        sourcePath: broken,
        outputDir: dir,
        baseName: '1-broken',
      });
      expect(outcome.verdict).toBe('repaired');
      if (outcome.verdict === 'repaired') {
        expect(outcome.attempts.at(-1)?.method).toBe('image_salvage');
        expect(
          (await tools.check(outcome.outputPath, 'photo', 'jpg')).status
        ).toBe('ok');
      }
      expect(readFileSync(broken).equals(before)).toBe(true);
    } finally {
      await tools.close();
    }
  });

  test('切れた MKV: 再構築で直る', async () => {
    const dir = temp();
    await makeMedia(dir);
    const broken = join(dir, 'broken.mkv');
    truncate(join(dir, 'ok.mkv'), broken, 0.7);
    const tools = createRepairTools();
    try {
      expect((await tools.check(broken, 'video', 'mkv')).status).toBe(
        'corrupt'
      );
      const outcome = await repairFile({
        tools,
        kind: 'video',
        ext: 'mkv',
        sourcePath: broken,
        outputDir: dir,
        baseName: '2-broken',
      });
      expect(outcome.verdict).toBe('repaired');
      expect(outcome.attempts[0]?.method).toBe('video_remux');
    } finally {
      await tools.close();
    }
  });

  test('moov のない MP4(先頭から読めない)は、直せない: failed', async () => {
    const dir = temp();
    const run = Bun.spawn([
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=10',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      join(dir, 'ok.mp4'),
    ]);
    await run.exited;
    const broken = join(dir, 'broken.mp4');
    truncate(join(dir, 'ok.mp4'), broken, 0.7);
    const tools = createRepairTools();
    try {
      const outcome = await repairFile({
        tools,
        kind: 'video',
        ext: 'mp4',
        sourcePath: broken,
        outputDir: dir,
        baseName: '3-broken',
      });
      expect(outcome.verdict).toBe('failed');
    } finally {
      await tools.close();
    }
  });
});
