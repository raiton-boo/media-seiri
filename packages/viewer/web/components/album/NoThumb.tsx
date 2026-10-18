/** 修復できず、読み取れなかったファイルの置き場(取り込みが、原本を、ここへ移す) */
const UNREADABLE_DIRECTORY = '_unknown/読み取り不可/';

/** 読み取り不可(破損)として、置かれたファイルか */
export const isUnreadable = (relPath: string): boolean =>
  relPath.startsWith(UNREADABLE_DIRECTORY);

/**
 * サムネイルのないファイルの、代わりの表示。
 * 壊れていて、読めなかったもの(修復もできなかった)は、「!」と理由を出す。それ以外は、名前と、サムネイルがないこと。
 */
export function NoThumb({ relPath, name }: { relPath: string; name: string }) {
  if (isUnreadable(relPath)) {
    return (
      <div
        className="broken"
        role="img"
        aria-label={`${name} は、壊れていて、読めませんでした`}
      >
        <span className="broken-mark" aria-hidden>
          !
        </span>
        <span className="broken-text">壊れていて、読めませんでした</span>
        <div className="lb">{name}</div>
      </div>
    );
  }
  return <div className="lb">{name} — サムネイルなし</div>;
}
