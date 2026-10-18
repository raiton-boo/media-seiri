const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 40;

/** 端末の幅。分からない(未設定・0)ときは、既定(100) */
export const terminalColumns = (fallback: number = DEFAULT_COLUMNS): number => {
  const columns = process.stdout.columns;
  return columns && columns > 0 ? columns : fallback;
};

/** 端末の高さ。分からない(未設定・0)ときは、既定 */
export const terminalRows = (fallback: number = DEFAULT_ROWS): number => {
  const rows = process.stdout.rows;
  return rows && rows > 0 ? rows : fallback;
};
