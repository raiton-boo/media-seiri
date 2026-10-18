// 閲覧専用ビューアの実行ファイルの入口。画面を埋め込んで(`scripts/build-binary.ts --viewer` が一覧を作る)から、動かす。
import { setEmbeddedWeb } from '@file-seiri/viewer';
import { markStandalone } from './embedded/registry.ts';
import { webFiles } from './embedded/viewer-assets.generated.ts';

markStandalone();
setEmbeddedWeb(webFiles);

await import('./main-viewer.ts');
