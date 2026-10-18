import { AppShell } from './AppShell';

/** まだ作っていない画面の場所。上のナビは、すべての画面でつながっているため、行き先を用意しておく */
export function ComingSoon({
  kicker,
  title,
}: {
  kicker: string;
  title: string;
}) {
  return (
    <AppShell>
      <div className="page">
        <div>
          <div className="kicker">{kicker}</div>
          <h1 className="h1">{title}</h1>
        </div>
        <div className="note">
          この画面は、まだ作っていません(順に、作っています)。
        </div>
      </div>
    </AppShell>
  );
}
