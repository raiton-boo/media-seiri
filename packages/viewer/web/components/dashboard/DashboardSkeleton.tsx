/** 読み込み中(Suspense)のスケルトン。斜めの縞(`.sk`)で、画面の形を先に見せる */
export function DashboardSkeleton() {
  return (
    <div
      className="page"
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
    >
      <div className="sk" style={{ height: 150 }} />
      <div className="grid grid-cols-4 gap-6">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="sk" style={{ height: 150 }} />
        ))}
      </div>
      <div className="sk" style={{ height: 320 }} />
    </div>
  );
}
