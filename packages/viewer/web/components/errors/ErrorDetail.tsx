'use client';

import type { RepairAttempt } from '@file-seiri/ledger';
import { thumbUrl, useErrorDetail } from '../../lib/api';
import { formatDateTimeSeconds } from '../../lib/format';
import { describeSource } from './ErrorsView';

const METHOD_LABELS: Record<RepairAttempt['method'], string> = {
  video_remux: '動画の再構築',
  metadata_rewrite: 'メタデータの再書込み',
  image_salvage: '切れた画像の救出',
};

/** エラー 1 件の詳細: サムネイル・場所・内容・試した修復の手順 */
export function ErrorDetail({ id }: { id: number }) {
  const { data, isPending, isError } = useErrorDetail(id);
  if (isError)
    return <div className="card note">詳細を読み込めませんでした。</div>;
  if (isPending)
    return (
      <div
        className="sk"
        style={{ height: 420 }}
        role="status"
        aria-label="読み込み中"
      />
    );
  const { error, attempts } = data;
  const fileName = error.source?.relPath.split('/').pop() ?? '';
  return (
    <div className="card y flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="h2">詳細</h2>
        <span className="chip r">{error.code}</span>
      </div>
      <div className="ph c3" style={{ aspectRatio: '16/9' }}>
        {error.source?.thumbRelPath ? (
          <img
            src={thumbUrl(error.source.thumbRelPath)}
            alt={fileName}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div className="lb">
            {fileName ? `${fileName} — サムネイルなし` : 'ファイルなし'}
          </div>
        )}
      </div>
      <div
        className="mono"
        style={{ fontSize: 13, lineHeight: 1.9, wordBreak: 'break-all' }}
      >
        場所 {describeSource(error.source)}
        {error.detail.split('\n').map((line, index) => (
          // 内容の行。並びは変わらないため、位置を key にしてよい
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定の行の並び
          <span key={index}>
            <br />
            {line}
          </span>
        ))}
        <br />
        実行 #{error.runId} / {formatDateTimeSeconds(error.occurredAt)}
      </div>
      {error.source ? (
        <>
          <hr className="hr" />
          <div className="kicker">REPAIR ATTEMPTS</div>
          {attempts.length === 0 ? (
            <div className="mono muted" style={{ fontSize: 13 }}>
              修復は、試していません
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {attempts.map((attempt, index) => (
                <div
                  key={attempt.attemptId}
                  className="card s flex items-center justify-between"
                >
                  <span className="mono" style={{ fontSize: 13 }}>
                    {index + 1} {METHOD_LABELS[attempt.method]}
                  </span>
                  <span className={attempt.isSuccess ? 'chip g' : 'chip r'}>
                    {attempt.isSuccess ? '成功' : '失敗'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
