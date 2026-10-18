/** 一覧の画面の、読み込み中のスケルトン(斜めの縞) */
export function ListSkeleton() {
  return (
    <div
      className="page"
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
    >
      <div className="sk" style={{ height: 70 }} />
      <div className="sk" style={{ height: 90 }} />
      <div className="sk" style={{ height: 420 }} />
    </div>
  );
}
