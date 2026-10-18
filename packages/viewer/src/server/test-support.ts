import { afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IN_MEMORY, openLedger } from '@file-seiri/ledger';
import type { createViewerApp } from './app.ts';
import type { ViewerSource } from './source.ts';

export const NOW = new Date('2026-10-18T00:00:00.000Z');
export const HASH = 'ab'.repeat(32);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-viewer-'));
  dirs.push(dir);
  return dir;
};

export const makeSource = (
  overrides: Partial<ViewerSource> = {}
): ViewerSource & { thumbsDir: string } => {
  const thumbsDir = join(tempDir(), 'thumbs');
  mkdirSync(join(thumbsDir, HASH.slice(0, 2)), { recursive: true });
  writeFileSync(join(thumbsDir, HASH.slice(0, 2), `${HASH}.jpg`), 'jpeg-bytes');
  return {
    library: {
      id: 'lib-1',
      name: 'PhotoLib',
      fsType: 'exfat',
      mediaKind: 'hdd',
    },
    source: 'snapshot',
    ledger: openLedger(IN_MEMORY, { libraryId: 'lib-1' }),
    thumbsDir,
    asOf: () => NOW,
    disk: () => ({ totalBytes: 2000, freeBytes: 500 }),
    now: () => NOW,
    ...overrides,
  };
};

export const get = (
  app: ReturnType<typeof createViewerApp>,
  path: string,
  init: RequestInit & { host?: string } = {}
): Promise<Response> =>
  Promise.resolve(
    app.request(`http://127.0.0.1${path}`, {
      ...init,
      headers: { host: init.host ?? '127.0.0.1:3939', ...init.headers },
    })
  );
