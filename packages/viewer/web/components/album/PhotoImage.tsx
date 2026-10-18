'use client';

import { useState } from 'react';
import { originalUrl, thumbUrl } from '../../lib/api';
import { viewKindOf } from '../../lib/photo';
import { NoThumb } from './NoThumb';

type Props = {
  photo: {
    libraryFileId: number;
    relPath: string;
    thumbRelPath: string | null;
  };
  alt: string;
  /** サムネイルがない・読めないとき、ブラウザで表示できる原本(画像)で、代わりに見せる。小さな札では、使わない(重いため) */
  allowOriginal?: boolean;
};

type Stage = 'thumb' | 'original' | 'none';

/**
 * 写真の表示。サムネイル → (読めなければ)原本 → (それも読めなければ)ファイル名の札、の順に、切り替える。
 * サムネイルのファイルがなくても、画面が空にならない(呼び出し側は、写真が変わるとき、`key` を変える)。
 */
export function PhotoImage({ photo, alt, allowOriginal = true }: Props) {
  const canOriginal = allowOriginal && viewKindOf(photo.relPath) === 'image';
  const [stage, setStage] = useState<Stage>(
    photo.thumbRelPath ? 'thumb' : canOriginal ? 'original' : 'none'
  );
  if (stage === 'thumb' && photo.thumbRelPath) {
    return (
      <img
        draggable={false}
        src={thumbUrl(photo.thumbRelPath)}
        alt={alt}
        onError={() => setStage(canOriginal ? 'original' : 'none')}
      />
    );
  }
  if (stage === 'original') {
    return (
      <img
        draggable={false}
        src={originalUrl(photo.libraryFileId)}
        alt={alt}
        onError={() => setStage('none')}
      />
    );
  }
  return <NoThumb relPath={photo.relPath} name={alt} />;
}
