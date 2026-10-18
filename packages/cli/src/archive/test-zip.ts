import { crc32, deflateRawSync } from 'node:zlib';

export type TestEntry = {
  /** 文字列(UTF-8 にする)か、そのままのバイト列(cp932 などの、試験用) */
  name: string | Uint8Array;
  data?: Uint8Array | string;
  method?: 'store' | 'deflate';
  /** 一般目的ビット 11(UTF-8)を立てる。既定は、名前が文字列のとき true */
  utf8?: boolean;
  /** 暗号化の印(ビット 0)を立てる(中身は、普通のまま。開けないことの試験用) */
  encrypted?: boolean;
  /** CRC-32 を、わざと、壊す */
  badCrc?: boolean;
  /** 更新日(ローカル時刻) */
  mtime?: Date;
};

const dos = (date: Date): { time: number; date: number } => ({
  time:
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2),
  date:
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate(),
});

/** 試験用の、最小の ZIP の書き手(ZIP64・データ記述子は、なし)。`centralDirectory: false` で、中央ディレクトリを付けない(壊れた ZIP) */
export const buildZip = (
  entries: readonly TestEntry[],
  options: { centralDirectory?: boolean } = {}
): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes =
      typeof entry.name === 'string'
        ? Buffer.from(entry.name, 'utf8')
        : Buffer.from(entry.name);
    const raw = Buffer.from(entry.data ?? '');
    const method = entry.method === 'deflate' ? 8 : 0;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = entry.badCrc ? (crc32(raw) ^ 0xdeadbeef) >>> 0 : crc32(raw);
    const flags =
      ((entry.utf8 ?? typeof entry.name === 'string') ? 0x800 : 0) |
      (entry.encrypted ? 0x1 : 0);
    const stamp = dos(entry.mtime ?? new Date(2014, 3, 6, 15, 32, 4));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const localPart = Buffer.concat(locals);
  if (options.centralDirectory === false) return localPart;
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
};

/** cp932 の「あいう」(0x82A0・0x82A2・0x82A4) */
export const CP932_AIU = Uint8Array.from([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4]);
