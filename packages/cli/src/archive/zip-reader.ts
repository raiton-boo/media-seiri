import {
  closeSync,
  createReadStream,
  createWriteStream,
  fstatSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 as zlibCrc32 } from 'node:zlib';
import { decodeEntryName } from './zip-names.ts';

/** 中央ディレクトリの、1 エントリ */
export type ZipEntry = {
  /** 文字コードを判定して、NFC にした名前(`/` 区切り。フォルダは、末尾が `/`) */
  name: string;
  isDirectory: boolean;
  /** 暗号化されている(開けない) */
  encrypted: boolean;
  /** 0 = 保存(無圧縮)、8 = Deflate。ほかは、対応しない */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /** 局所ヘッダの位置 */
  localOffset: number;
  /** 更新日(ミリ秒。整数)。ZIP に記録された、ローカル時刻(2 秒の粒度)か、拡張の UTC の時刻 */
  mtimeMs: number;
  /** 局所ヘッダの後ろに、データ記述子がある(サイズが、局所ヘッダにはない) */
  hasDataDescriptor: boolean;
};

/** ZIP を読めない(壊れている・対応しない形) */
export class ZipReadError extends Error {
  constructor(
    message: string,
    /** 途中まで読めたエントリ(壊れていても、読めた分は、処理するため) */
    readonly partial: ZipEntry[] = []
  ) {
    super(message);
    this.name = 'ZipReadError';
  }
}

/** エントリを取り出せない(暗号化・対応しない圧縮・CRC の不一致・上限超過など) */
export class ZipExtractError extends Error {
  constructor(
    readonly kind: 'encrypted' | 'unsupported' | 'corrupt' | 'too-large',
    message: string
  ) {
    super(message);
    this.name = 'ZipExtractError';
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** 末尾から、終端レコードを探す範囲(コメントは、最大 65535 バイト) */
const TAIL_BYTES = 65_535 + 22 + 20 + 56;

const readAt = (fd: number, position: number, length: number): Buffer => {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const read = readSync(fd, buffer, done, length - done, position + done);
    if (read === 0) break;
    done += read;
  }
  return done === length ? buffer : buffer.subarray(0, done);
};

const u64 = (buffer: Buffer, offset: number): number => {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ZipReadError('ZIP のサイズが大きすぎます');
  return Number(value);
};

/** DOS の日付・時刻(ローカル時刻)を、ミリ秒に */
const dosToMs = (date: number, time: number): number => {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  return new Date(
    year,
    Math.max(month - 1, 0),
    Math.max(day, 1),
    hour,
    minute,
    second
  ).getTime();
};

type Extra = { zip64?: Buffer; unixMtime?: number; unicodePath?: Buffer };

const parseExtra = (extra: Buffer): Extra => {
  const result: Extra = {};
  for (let offset = 0; offset + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const body = extra.subarray(offset + 4, offset + 4 + size);
    if (id === 0x0001) result.zip64 = body;
    else if (id === 0x5455 && body.length >= 5 && (body[0] ?? 0) & 1) {
      // 拡張の更新日(UTC の秒)
      result.unixMtime = body.readUInt32LE(1);
    } else if (id === 0x7075 && body.length > 5) {
      result.unicodePath = body.subarray(5);
    }
    offset += 4 + size;
  }
  return result;
};

/** 中央ディレクトリを読む。読めなければ、`ZipReadError` */
const readCentralDirectory = (fd: number, size: number): ZipEntry[] => {
  const tailLength = Math.min(size, TAIL_BYTES);
  const tail = readAt(fd, size - tailLength, tailLength);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === SIG_EOCD) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0)
    throw new ZipReadError(
      'ZIP の終端が見つかりません(壊れているか、ZIP ではありません)'
    );

  let total = tail.readUInt16LE(eocd + 10);
  let directorySize = tail.readUInt32LE(eocd + 12);
  let directoryOffset = tail.readUInt32LE(eocd + 16);
  if (
    total === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locator = eocd - 20;
    if (locator < 0 || tail.readUInt32LE(locator) !== SIG_LOCATOR64)
      throw new ZipReadError('ZIP64 の終端が見つかりません');
    const eocd64Offset = u64(tail, locator + 8);
    const eocd64 = readAt(fd, eocd64Offset, 56);
    if (eocd64.length < 56 || eocd64.readUInt32LE(0) !== SIG_EOCD64)
      throw new ZipReadError('ZIP64 の終端が壊れています');
    total = u64(eocd64, 32);
    directorySize = u64(eocd64, 40);
    directoryOffset = u64(eocd64, 48);
  }
  if (directoryOffset + directorySize > size)
    throw new ZipReadError(
      'ZIP の中央ディレクトリが、ファイルの範囲を超えています'
    );

  const directory = readAt(fd, directoryOffset, directorySize);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < total; index += 1) {
    if (
      offset + 46 > directory.length ||
      directory.readUInt32LE(offset) !== SIG_CENTRAL
    )
      throw new ZipReadError('中央ディレクトリが壊れています', entries);
    const flags = directory.readUInt16LE(offset + 8);
    const method = directory.readUInt16LE(offset + 10);
    const time = directory.readUInt16LE(offset + 12);
    const date = directory.readUInt16LE(offset + 14);
    const crc = directory.readUInt32LE(offset + 16);
    let compressedSize = directory.readUInt32LE(offset + 20);
    let uncompressedSize = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    let localOffset = directory.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > directory.length)
      throw new ZipReadError('中央ディレクトリが壊れています', entries);
    const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
    const extra = parseExtra(
      directory.subarray(
        offset + 46 + nameLength,
        offset + 46 + nameLength + extraLength
      )
    );
    if (extra.zip64) {
      let position = 0;
      if (uncompressedSize === 0xffffffff) {
        uncompressedSize = u64(extra.zip64, position);
        position += 8;
      }
      if (compressedSize === 0xffffffff) {
        compressedSize = u64(extra.zip64, position);
        position += 8;
      }
      if (localOffset === 0xffffffff) localOffset = u64(extra.zip64, position);
    }
    const name = decodeEntryName(
      extra.unicodePath ?? nameBytes,
      (flags & 0x800) !== 0 || extra.unicodePath !== undefined
    );
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      encrypted: (flags & 0x1) !== 0,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localOffset,
      mtimeMs:
        extra.unixMtime === undefined
          ? dosToMs(date, time)
          : extra.unixMtime * 1000,
      hasDataDescriptor: (flags & 0x8) !== 0,
    });
    offset = end;
  }
  return entries;
};

/**
 * 中央ディレクトリが壊れているときの、救い出し: 先頭から、局所ヘッダをたどって、読めるところまで、エントリにする。
 * サイズが局所ヘッダにない(データ記述子)エントリに当たったら、そこで止める(次の位置が、分からないため)。
 */
const salvageLocalHeaders = (fd: number, size: number): ZipEntry[] => {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= size) {
    const header = readAt(fd, offset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== SIG_LOCAL) break;
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const time = header.readUInt16LE(10);
    const date = header.readUInt16LE(12);
    const crc = header.readUInt32LE(14);
    const compressedSize = header.readUInt32LE(18);
    const uncompressedSize = header.readUInt32LE(22);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if ((flags & 0x8) !== 0 || compressedSize === 0xffffffff) break;
    const nameBytes = readAt(fd, offset + 30, nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    if (dataStart + compressedSize > size) break;
    const name = decodeEntryName(nameBytes, (flags & 0x800) !== 0);
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      encrypted: (flags & 0x1) !== 0,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localOffset: offset,
      mtimeMs: dosToMs(date, time),
      hasDataDescriptor: false,
    });
    offset = dataStart + compressedSize;
  }
  return entries;
};

/**
 * ZIP のエントリの一覧を読む。中央ディレクトリが読めなければ、局所ヘッダから、読める分を救い出し、`ZipReadError.partial` に入れる。
 * 救い出せる分が 1 つもなければ、`partial` は空。
 */
export const readZipEntries = (path: string): ZipEntry[] => {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    try {
      return readCentralDirectory(fd, size);
    } catch (error) {
      if (!(error instanceof ZipReadError)) throw error;
      const partial =
        error.partial.length > 0
          ? error.partial
          : salvageLocalHeaders(fd, size);
      throw new ZipReadError(error.message, partial);
    }
  } finally {
    closeSync(fd);
  }
};

export type ExtractOptions = {
  /** 1 エントリの、展開後の上限(バイト)。超えたら、止める(ZIP 爆弾の対策) */
  maxBytes: number;
};

/** CRC-32(`zlib.crc32` があれば、それを使う) */
const crc32Of = (data: Uint8Array, previous: number): number =>
  zlibCrc32(data, previous);

/**
 * エントリを 1 つ、ファイルに取り出す(全体は、展開しない)。
 * - 暗号化は、`encrypted`。保存・Deflate 以外の圧縮は、`unsupported`。
 * - 書いたバイト数が、宣言のサイズを超えたり、上限を超えたら、止める(`too-large`)。最後に、サイズと CRC-32 を確かめる(`corrupt`)。
 * 失敗したときは、書きかけのファイルを消す。
 */
export const extractZipEntry = async (
  zipPath: string,
  entry: ZipEntry,
  destinationPath: string,
  options: ExtractOptions
): Promise<void> => {
  if (entry.encrypted)
    throw new ZipExtractError('encrypted', `暗号化されています: ${entry.name}`);
  if (entry.method !== 0 && entry.method !== 8)
    throw new ZipExtractError(
      'unsupported',
      `対応しない圧縮方式です(方式 ${entry.method}): ${entry.name}`
    );
  if (entry.uncompressedSize > options.maxBytes)
    throw new ZipExtractError(
      'too-large',
      `展開後のサイズが上限を超えます(${entry.uncompressedSize} バイト): ${entry.name}`
    );

  const fd = openSync(zipPath, 'r');
  let dataStart: number;
  try {
    const header = readAt(fd, entry.localOffset, 30);
    if (header.length < 30 || header.readUInt32LE(0) !== SIG_LOCAL)
      throw new ZipExtractError(
        'corrupt',
        `局所ヘッダが壊れています: ${entry.name}`
      );
    dataStart =
      entry.localOffset +
      30 +
      header.readUInt16LE(26) +
      header.readUInt16LE(28);
  } finally {
    closeSync(fd);
  }

  let written = 0;
  let crc = 0;
  const limit = Math.min(options.maxBytes, entry.uncompressedSize);
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > limit) {
        callback(
          new ZipExtractError(
            'too-large',
            `宣言のサイズ、または、上限を超えて展開されました: ${entry.name}`
          )
        );
        return;
      }
      crc = crc32Of(chunk, crc);
      callback(null, chunk);
    },
  });
  const output = createWriteStream(destinationPath, { flags: 'wx' });
  try {
    if (entry.compressedSize === 0) {
      // 空(または、保存で、0 バイト)
      output.end();
      await new Promise<void>((resolve, reject) => {
        output.on('finish', resolve);
        output.on('error', reject);
      });
    } else {
      const source = createReadStream(zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
      if (entry.method === 8)
        await pipeline(source, createInflateRaw(), counter, output);
      else await pipeline(source, counter, output);
    }
    if (written !== entry.uncompressedSize)
      throw new ZipExtractError(
        'corrupt',
        `展開したサイズが、宣言と違います(${written} / ${entry.uncompressedSize}): ${entry.name}`
      );
    if (
      crc >>> 0 !== entry.crc32 >>> 0 &&
      !(entry.hasDataDescriptor && entry.crc32 === 0)
    )
      throw new ZipExtractError(
        'corrupt',
        `CRC-32 が一致しません: ${entry.name}`
      );
  } catch (error) {
    rmSync(destinationPath, { force: true });
    if (error instanceof ZipExtractError) throw error;
    // 圧縮データが壊れている(inflate の失敗)など
    throw new ZipExtractError(
      'corrupt',
      `展開できません: ${entry.name}(${error instanceof Error ? error.message : String(error)})`
    );
  }
};
