import { createInterface } from 'node:readline/promises';

/** 「はい / いいえ」を、標準入力で質問する。`y` / `yes` / `はい` だけを、はいとする(既定は、いいえ) */
export const askYesNo = async (question: string): Promise<boolean> => {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await readline.question(`${question} [y/N] `))
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes' || answer === 'はい';
  } finally {
    readline.close();
  }
};
