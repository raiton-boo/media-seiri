import { describe, expect, test } from 'bun:test';
import {
  findDuplicateLinkBySource,
  getOrCreateContent,
  getSourceFile,
  insertFileGroup,
  insertLibraryFile,
  insertSourceFile,
  listDuplicateLinksByAdopted,
  openLedger,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { ContentClaims, decideContent } from './claims.ts';
import { recordDuplicate } from './record.ts';

const NOW = new Date('2026-10-18T00:00:00Z');

const setup = () => {
  const ledger = openLedger(':memory:', { libraryId: 'abc' });
  const volume = upsertVolume(ledger.db, { volumeUuid: 'v', seenAt: NOW });
  const runId = startRun(ledger.db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  let counter = 0;
  const content = (): number => {
    counter += 1;
    return getOrCreateContent(ledger.db, {
      hash: String(counter).padStart(64, '0'),
      sizeBytes: 1,
    }).content.contentId;
  };
  const libraryFile = (contentId: number, relPath: string): number =>
    insertLibraryFile(ledger.db, {
      contentId,
      groupId: insertFileGroup(ledger.db, { stem: relPath, bucket: 'full' }),
      runId,
      relPath,
      bucket: 'full',
      createdAt: NOW,
    });
  const sourceFile = (relPath: string): number =>
    insertSourceFile(ledger.db, {
      runId,
      volumeId: volume.volumeId,
      relPath,
      sizeBytes: 1,
      mtimeMs: 0,
      kind: 'photo',
      ext: 'jpg',
    });
  return { ledger, runId, content, libraryFile, sourceFile };
};

describe('ContentClaims.decide', () => {
  test('ライブラリにも予約にもなければ、採用側になる', () => {
    const { ledger, content } = setup();
    const claims = new ContentClaims();
    const decision = claims.decide(ledger.db, content());
    expect(decision.kind).toBe('adopt');
    expect(claims.pendingCount).toBe(1);
  });

  test('ライブラリにすでにあれば、重複(過去の実行のものも)。採用側は、いちばん古いファイル', () => {
    const { ledger, content, libraryFile } = setup();
    const contentId = content();
    const first = libraryFile(contentId, 'a.jpg');
    libraryFile(contentId, 'b.jpg');
    expect(new ContentClaims().decide(ledger.db, contentId)).toEqual({
      kind: 'duplicate',
      adoptedLibraryFileId: first,
    });
  });

  test('採用側が決まっている最中は、2 件目は、待つ(pending)', () => {
    const { ledger, content } = setup();
    const claims = new ContentClaims();
    const contentId = content();
    expect(claims.decide(ledger.db, contentId).kind).toBe('adopt');
    expect(claims.decide(ledger.db, contentId).kind).toBe('pending');
    // 別の内容は、独立
    expect(claims.decide(ledger.db, content()).kind).toBe('adopt');
  });

  test('コピーが終わったら(commit)、予約は消え、ライブラリの記録に基づいて、重複になる', () => {
    const { ledger, content, libraryFile } = setup();
    const claims = new ContentClaims();
    const contentId = content();
    const decision = claims.decide(ledger.db, contentId);
    if (decision.kind !== 'adopt') throw new Error('採用側のはず');
    const id = libraryFile(contentId, 'a.jpg');
    decision.commit(id);
    expect(claims.pendingCount).toBe(0);
    expect(claims.decide(ledger.db, contentId)).toEqual({
      kind: 'duplicate',
      adoptedLibraryFileId: id,
    });
  });

  test('同じ予約を、2 度終えると、エラー', () => {
    const { ledger, content } = setup();
    const decision = new ContentClaims().decide(ledger.db, content());
    if (decision.kind !== 'adopt') throw new Error('採用側のはず');
    decision.abandon();
    expect(() => decision.abandon()).toThrow();
    expect(() => decision.commit(1)).toThrow();
  });
});

describe('decideContent(並行して、決める)', () => {
  test('同じ内容が 10 件、同時に来ても、採用側は、ちょうど 1 件', async () => {
    const { ledger, content, libraryFile } = setup();
    const claims = new ContentClaims();
    const contentId = content();
    const results = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const decision = await decideContent(ledger.db, claims, contentId);
        if (decision.kind === 'adopt') {
          // コピーに、少し時間がかかる
          await new Promise((resolve) => setTimeout(resolve, 10));
          const id = libraryFile(contentId, `adopted-${index}.jpg`);
          decision.commit(id);
          return { kind: 'adopt' as const, id };
        }
        return {
          kind: 'duplicate' as const,
          id: decision.adoptedLibraryFileId,
        };
      })
    );
    const adopters = results.filter((r) => r.kind === 'adopt');
    expect(adopters).toHaveLength(1);
    // 9 件は、すべて、その 1 件を採用側として指す
    const adoptedId = adopters[0]?.id;
    expect(
      results
        .filter((r) => r.kind === 'duplicate')
        .every((r) => r.id === adoptedId)
    ).toBe(true);
    expect(claims.pendingCount).toBe(0);
    expect(
      (
        ledger.db.query('SELECT count(*) AS n FROM library_files').get() as {
          n: number;
        }
      ).n
    ).toBe(1);
  });

  test('採用側が失敗(abandon)したら、待っていた 1 件が、次の採用側になる', async () => {
    const { ledger, content, libraryFile } = setup();
    const claims = new ContentClaims();
    const contentId = content();

    const first = await decideContent(ledger.db, claims, contentId);
    expect(first.kind).toBe('adopt');
    const second = decideContent(ledger.db, claims, contentId);
    const third = decideContent(ledger.db, claims, contentId);

    if (first.kind === 'adopt') first.abandon();
    const secondDecision = await Promise.race([second, third]);
    expect(secondDecision.kind).toBe('adopt');

    // 次の採用側が成功すれば、残りは、その重複になる
    let winnerId = 0;
    if (secondDecision.kind === 'adopt') {
      winnerId = libraryFile(contentId, 'winner.jpg');
      secondDecision.commit(winnerId);
    }
    const [a, b] = await Promise.all([second, third]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['adopt', 'duplicate']);
    const duplicate = [a, b].find((d) => d.kind === 'duplicate');
    expect(duplicate).toEqual({
      kind: 'duplicate',
      adoptedLibraryFileId: winnerId,
    });
  });

  test('すでにライブラリにあれば、待たずに、すぐ重複', async () => {
    const { ledger, content, libraryFile } = setup();
    const contentId = content();
    const id = libraryFile(contentId, 'a.jpg');
    expect(
      await decideContent(ledger.db, new ContentClaims(), contentId)
    ).toEqual({
      kind: 'duplicate',
      adoptedLibraryFileId: id,
    });
  });
});

describe('recordDuplicate', () => {
  test('ソースのファイルを duplicate にして、採用側との対応を記録する', () => {
    const { ledger, content, libraryFile, sourceFile } = setup();
    const adopted = libraryFile(content(), 'a.jpg');
    const skippedA = sourceFile('x/a.jpg');
    const skippedB = sourceFile('y/a.jpg');
    recordDuplicate(ledger.db, {
      skippedSourceFileId: skippedA,
      adoptedLibraryFileId: adopted,
      now: NOW,
    });
    recordDuplicate(ledger.db, {
      skippedSourceFileId: skippedB,
      adoptedLibraryFileId: adopted,
      now: NOW,
    });

    expect(getSourceFile(ledger.db, skippedA)?.state).toBe('duplicate');
    expect(findDuplicateLinkBySource(ledger.db, skippedA)).toMatchObject({
      adoptedLibraryFileId: adopted,
    });
    expect(
      listDuplicateLinksByAdopted(ledger.db, adopted).map(
        (l) => l.skippedSourceFileId
      )
    ).toEqual([skippedA, skippedB]);
  });

  test('途中で失敗したら、状態も、対応も、変わらない(1 つのトランザクション)', () => {
    const { ledger, sourceFile } = setup();
    const skipped = sourceFile('x/a.jpg');
    expect(() =>
      recordDuplicate(ledger.db, {
        skippedSourceFileId: skipped,
        adoptedLibraryFileId: 999,
        now: NOW,
      })
    ).toThrow();
    expect(getSourceFile(ledger.db, skipped)?.state).toBe('scanned');
    expect(findDuplicateLinkBySource(ledger.db, skipped)).toBeUndefined();
  });

  test('ないファイルは、エラー', () => {
    const { ledger, content, libraryFile } = setup();
    const adopted = libraryFile(content(), 'a.jpg');
    expect(() =>
      recordDuplicate(ledger.db, {
        skippedSourceFileId: 999,
        adoptedLibraryFileId: adopted,
        now: NOW,
      })
    ).toThrow();
  });
});
