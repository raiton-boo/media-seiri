import type { Database } from 'bun:sqlite';
import { insertDuplicateLink, setSourceFileState } from '@file-seiri/ledger';

/** 重複のスキップを記録する: ソースのファイルを `duplicate` にして、採用側との対応を残す(1 つのトランザクションで) */
export const recordDuplicate = (
  db: Database,
  input: {
    skippedSourceFileId: number;
    adoptedLibraryFileId: number;
    now: Date;
  }
): void => {
  db.transaction(() => {
    setSourceFileState(db, input.skippedSourceFileId, 'duplicate');
    insertDuplicateLink(db, {
      skippedSourceFileId: input.skippedSourceFileId,
      adoptedLibraryFileId: input.adoptedLibraryFileId,
      createdAt: input.now,
    });
  })();
};
