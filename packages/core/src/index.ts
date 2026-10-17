/** プロジェクトの名前。cli と viewer が、同じ名前を使うための、共通の定義 */
export const PROJECT_NAME = 'file-seiri';

/** どのパッケージから呼ばれたかを含む、短い説明の文字列を返す */
export const describePackage = (packageName: string): string =>
  `${PROJECT_NAME}/${packageName}`;

export * from './date/index.ts';
export * from './naming/index.ts';
