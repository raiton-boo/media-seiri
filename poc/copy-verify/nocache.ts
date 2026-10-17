import { closeSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHUNK_SIZE,
  disableCache,
  GIB,
  megabytesPerSecond,
  prepareTempDirectory,
  removeTempDirectory,
} from './shared.ts';

// 使い方: bun nocache.ts <ドライブのパス(例: /Volumes/PhotoLib)>
// 目的: F_NOCACHE を付けると、書き込み直後の読み出しが、OS のキャッシュではなくディスクから返るか確かめる
const TEST_FILE_SIZE = GIB;

type Measurement = { label: string; megabytesPerSecond: number };

const writeTestFile = (path: string, useNoCache: boolean): Measurement => {
  // 内容は圧縮されない乱数にする(ドライブ側の圧縮の影響を避けるため)
  const chunk = Buffer.alloc(CHUNK_SIZE);
  crypto.getRandomValues(chunk);
  const fileDescriptor = openSync(path, 'w');
  if (useNoCache) disableCache(fileDescriptor);
  const startedAt = performance.now();
  for (let written = 0; written < TEST_FILE_SIZE; written += CHUNK_SIZE) {
    writeSync(fileDescriptor, chunk);
  }
  // 書き込みが、ディスクに届くまで待つ(速度を、メモリへの書き込みで見積もらないため)
  fsyncSync(fileDescriptor);
  const seconds = (performance.now() - startedAt) / 1000;
  closeSync(fileDescriptor);
  return {
    label: `書き込み(${useNoCache ? 'F_NOCACHE あり' : '通常'})`,
    megabytesPerSecond: megabytesPerSecond(TEST_FILE_SIZE, seconds),
  };
};

const readTestFile = (
  path: string,
  useNoCache: boolean,
  label: string
): Measurement => {
  const buffer = Buffer.alloc(CHUNK_SIZE);
  const fileDescriptor = openSync(path, 'r');
  if (useNoCache) disableCache(fileDescriptor);
  const startedAt = performance.now();
  let totalRead = 0;
  while (true) {
    const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    totalRead += bytesRead;
  }
  const seconds = (performance.now() - startedAt) / 1000;
  closeSync(fileDescriptor);
  if (totalRead !== TEST_FILE_SIZE)
    throw new Error(`読めたサイズが違う: ${totalRead}`);
  return { label, megabytesPerSecond: megabytesPerSecond(totalRead, seconds) };
};

const main = () => {
  const mountPath = process.argv[2];
  if (!mountPath) {
    console.error('使い方: bun nocache.ts /Volumes/<ドライブ名>');
    process.exit(1);
  }
  const directory = prepareTempDirectory(mountPath);
  const results: Measurement[] = [];
  try {
    console.log(
      `テスト用ファイル: ${TEST_FILE_SIZE / GIB} GiB / 保存先: ${directory}\n`
    );

    // ケース 1: 通常に書いて、通常に読む(キャッシュが効く場合の基準)
    const case1 = join(directory, 'case1.bin');
    results.push(writeTestFile(case1, false));
    results.push(
      readTestFile(case1, false, '読み出し(通常)  ← 通常に書いた直後')
    );

    // ケース 2: 通常に書いて、F_NOCACHE で読む(読むときだけ付けて、効くか)
    const case2 = join(directory, 'case2.bin');
    results.push(writeTestFile(case2, false));
    results.push(
      readTestFile(case2, true, '読み出し(F_NOCACHE)  ← 通常に書いた直後')
    );

    // ケース 3: F_NOCACHE で書いて、F_NOCACHE で読む(書くときから、キャッシュに載せない)
    const case3 = join(directory, 'case3.bin');
    results.push(writeTestFile(case3, true));
    results.push(
      readTestFile(case3, true, '読み出し(F_NOCACHE)  ← F_NOCACHE で書いた直後')
    );

    // ケース 4: F_NOCACHE で書いて、通常に 2 回読む(1 回目はディスク、2 回目はキャッシュのはず)
    const case4 = join(directory, 'case4.bin');
    results.push(writeTestFile(case4, true));
    results.push(
      readTestFile(
        case4,
        false,
        '読み出し(通常 1 回目)  ← F_NOCACHE で書いた直後'
      )
    );
    results.push(readTestFile(case4, false, '読み出し(通常 2 回目)'));
  } finally {
    removeTempDirectory(directory);
    console.log('(実験用の一時フォルダを削除しました)\n');
  }

  for (const result of results) {
    console.log(
      `${result.megabytesPerSecond.toFixed(0).padStart(7)} MB/s  ${result.label}`
    );
  }
};

main();
