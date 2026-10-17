import type { Database } from 'bun:sqlite';
import { listLibraryFilesByContent } from '@file-seiri/ledger';

/** 1 つの内容を、先に採用しようとしている 1 件 */
type Claim = {
  /** 採用側のコピーが終わったら、ライブラリのファイル ID。失敗したら、undefined */
  settled: Promise<number | undefined>;
  settle: (libraryFileId: number | undefined) => void;
};

/** 採用側になった。コピーが終わったら `commit`、失敗したら `abandon`(待っている重複が、次の採用側を決め直す) */
export type Adoption = {
  kind: 'adopt';
  commit(libraryFileId: number): void;
  abandon(): void;
};

/** すでにライブラリにある内容。重複としてスキップする */
export type Duplicate = { kind: 'duplicate'; adoptedLibraryFileId: number };

/**
 * 同じ実行の中で、同じ内容が重なったとき、最初に確定した 1 件だけを採用側にする(仕様書 §5)。
 * 並列に処理していても、`decide` は同期的に、確かめて、予約するため、2 件が採用側になることはない。
 */
export class ContentClaims {
  private readonly claims = new Map<number, Claim>();

  /**
   * 内容(`contents` の ID)の扱いを決める。
   * 1. ライブラリにすでにある(過去の実行・この実行で、コピー済み)→ 重複(採用側は、いちばん古いファイル)
   * 2. 別の 1 件が、採用しようとしている最中 → そのコピーが終わるのを待って、重複にする
   * 3. どちらでもない → 自分が採用側になる(予約する)
   */
  decide(
    db: Database,
    contentId: number
  ):
    | Adoption
    | Duplicate
    | { kind: 'pending'; outcome: Promise<number | undefined> } {
    const existing = listLibraryFilesByContent(db, contentId)[0];
    if (existing)
      return {
        kind: 'duplicate',
        adoptedLibraryFileId: existing.libraryFileId,
      };

    const pending = this.claims.get(contentId);
    if (pending) return { kind: 'pending', outcome: pending.settled };

    let settle: Claim['settle'] = () => {};
    const settled = new Promise<number | undefined>((resolve) => {
      settle = resolve;
    });
    const claim: Claim = { settled, settle };
    this.claims.set(contentId, claim);

    let isSettled = false;
    const finish = (libraryFileId: number | undefined): void => {
      if (isSettled) throw new Error('この予約は、すでに終わっています');
      isSettled = true;
      this.claims.delete(contentId);
      claim.settle(libraryFileId);
    };
    return {
      kind: 'adopt',
      commit: (libraryFileId) => finish(libraryFileId),
      abandon: () => finish(undefined),
    };
  }

  /** 予約中の内容の数(テスト・診断用) */
  get pendingCount(): number {
    return this.claims.size;
  }
}

/**
 * 内容の扱いを、最終的に決める。別の 1 件を待っているときは、その結果が出るまで待つ。
 * 待った相手が失敗(`abandon`)したら、決め直す(次の 1 件が、採用側になる)。
 */
export const decideContent = async (
  db: Database,
  claims: ContentClaims,
  contentId: number
): Promise<Adoption | Duplicate> => {
  for (;;) {
    const decision = claims.decide(db, contentId);
    if (decision.kind !== 'pending') return decision;
    const adoptedLibraryFileId = await decision.outcome;
    if (adoptedLibraryFileId !== undefined)
      return { kind: 'duplicate', adoptedLibraryFileId };
  }
};
