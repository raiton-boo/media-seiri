// 単一の実行ファイルの入口。画面と ExifTool を埋め込んで(`scripts/build-binary.ts` が一覧を作る)から、通常の入口を動かす。
import { setEmbeddedWeb } from '@file-seiri/viewer';
import {
  exiftoolFiles,
  exiftoolVersion,
  webFiles,
} from './embedded/assets.generated.ts';
import { markStandalone, setEmbeddedExiftool } from './embedded/registry.ts';

markStandalone();
setEmbeddedWeb(webFiles);
setEmbeddedExiftool({ version: exiftoolVersion, files: exiftoolFiles });

await import('./main.ts');
