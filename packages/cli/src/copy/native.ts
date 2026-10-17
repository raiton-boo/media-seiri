import { dlopen, ptr, read } from 'bun:ffi';
import { CliError } from '../cli-error.ts';

// macOS の定数(<sys/fcntl.h>・<sys/stdio.h>・<sys/errno.h>)
const F_NOCACHE = 48;
const RENAME_EXCL = 0x4;
export const ERRNO_EEXIST = 17;
export const ERRNO_EINVAL = 22;
export const ERRNO_ENOTSUP = 45;
const CALL_FAILED = -1;

type Native = {
  fcntl: (fd: number, command: number, argument: number) => number;
  renamex_np: (from: Buffer, to: Buffer, flags: number) => number;
  errno: () => number;
};

let native: Native | undefined;

/** libSystem を、使うときに初めて読む(macOS 以外では、使えない) */
const load = (): Native => {
  if (native) return native;
  if (process.platform !== 'darwin') {
    throw new CliError('コピーの検証は、macOS だけに対応しています(F_NOCACHE)');
  }
  const { symbols } = dlopen('libSystem.B.dylib', {
    fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
    renamex_np: { args: ['ptr', 'ptr', 'u32'], returns: 'i32' },
    __error: { args: [], returns: 'ptr' },
  });
  native = {
    fcntl: (fd, command, argument) => symbols.fcntl(fd, command, argument),
    renamex_np: (from, to, flags) =>
      symbols.renamex_np(ptr(from), ptr(to), flags),
    errno: () => {
      const location = symbols.__error();
      return location === null ? 0 : read.i32(location);
    },
  };
  return native;
};

const cString = (text: string): Buffer => Buffer.from(`${text}\0`);

/** ファイルに、OS のキャッシュを使わない指定をする(`F_NOCACHE`)。失敗したら、例外にする */
export const disableCache = (fileDescriptor: number): void => {
  if (load().fcntl(fileDescriptor, F_NOCACHE, 1) === CALL_FAILED) {
    throw new Error(`fcntl(F_NOCACHE) に失敗しました(errno ${load().errno()})`);
  }
};

export type RenameExclusiveResult =
  | { ok: true }
  // 同名がすでにある(大文字小文字だけが違う名前も含む)
  | { ok: false; reason: 'exists' }
  // このファイルシステムは、上書きしない名前の変更に対応していない
  | { ok: false; reason: 'unsupported' }
  | { ok: false; reason: 'error'; errno: number };

/** 既存のファイルを上書きしない、名前の変更(`renamex_np` の `RENAME_EXCL`)。失敗の理由を、値で返す */
export const renameExclusive = (
  from: string,
  to: string
): RenameExclusiveResult => {
  const api = load();
  if (api.renamex_np(cString(from), cString(to), RENAME_EXCL) !== CALL_FAILED) {
    return { ok: true };
  }
  const errno = api.errno();
  if (errno === ERRNO_EEXIST) return { ok: false, reason: 'exists' };
  if (errno === ERRNO_ENOTSUP || errno === ERRNO_EINVAL)
    return { ok: false, reason: 'unsupported' };
  return { ok: false, reason: 'error', errno };
};
