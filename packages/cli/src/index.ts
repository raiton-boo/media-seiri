import { describePackage } from '@file-seiri/core';

/** このパッケージの説明。core の関数を呼べること(ワークスペースのつながり)を確かめるための、最小の例 */
export const describeSelf = (): string => describePackage('cli');
