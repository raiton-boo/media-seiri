import cliPackage from '../../package.json' with { type: 'json' };
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { cleanupAppleDouble, usesAppleDouble } from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { chooseLibraryRoot } from '../library/choose.ts';
import { markerExists } from '../library/marker.ts';
import { showReport } from '../present/index.ts';
import { installViewerBundle } from '../viewer-bundle/install.ts';

/** `viewer-install [--library <パス>]`: 閲覧専用ビューア(Windows・Mac 用の実行ファイル)を、ライブラリの `viewer/` に置く */
export const viewerInstallCommand = (
  context: CommandContext,
  libraryOption: string | undefined
): ExitCode => {
  const root = chooseLibraryRoot(context, libraryOption);
  if (!markerExists(root)) {
    throw new CliError(
      `ライブラリではありません(ドライブが、接続されていますか): ${root}`
    );
  }
  if (!context.viewerBundleDir) {
    throw new CliError('ビューアの実行ファイルの置き場が、決まっていません。');
  }
  const result = installViewerBundle({
    bundleDir: context.viewerBundleDir,
    libraryRoot: root,
    version: cliPackage.version,
  });
  if (!result) {
    throw new CliError(
      `ビューアの実行ファイルが、見つかりません: ${context.viewerBundleDir}\n` +
        '`bun run build:viewers` で作る(dist/viewer/)か、環境変数 FILE_SEIRI_VIEWER_BUNDLE で、場所を指定してください。'
    );
  }
  // exFAT・FAT では、macOS が作る付属ファイル(`._名前`)を、消す
  const volume = context.resolveVolume(root);
  if (usesAppleDouble(volume.fsType)) cleanupAppleDouble(root);

  if (context.fancy) {
    showReport(context, {
      title: 'ビューアを置きました',
      badge: {
        label: result.missing.length > 0 ? '一部なし' : '完了',
        tone: result.missing.length > 0 ? 'warn' : 'ok',
      },
      sections: [
        {
          title: result.directory,
          tone: 'ok',
          rows: [
            {
              label: '置いた',
              value: String(result.installed.length),
              tone: 'ok',
            },
            { label: 'そのまま', value: String(result.unchanged.length) },
            {
              label: '一式にない',
              value: result.missing.join(' / ') || 'なし',
              tone: result.missing.length > 0 ? 'warn' : 'dim',
            },
          ],
        },
      ],
      hint: 'ドライブを Windows の PC につないで、viewer フォルダの実行ファイルを開くと、写真を見られます',
    });
  } else {
    context.stdout(`ビューアを置きました: ${result.directory}`);
    context.stdout(`  置いた: ${result.installed.join(', ') || 'なし'}`);
    context.stdout(`  そのまま: ${result.unchanged.join(', ') || 'なし'}`);
    if (result.missing.length > 0)
      context.stdout(`  一式にない: ${result.missing.join(', ')}`);
  }
  return result.missing.length > 0 && result.installed.length === 0
    ? EXIT_CODES.completedWithErrors
    : EXIT_CODES.ok;
};
