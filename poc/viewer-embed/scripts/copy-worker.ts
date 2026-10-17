import { cpSync, mkdirSync } from 'node:fs';

// MapLibre の Worker は、ライブラリが自分の位置を基準に探すが、Next.js のビルドでは、その位置が使えない。
// そのため、固定の場所(public/)にコピーして、setWorkerUrl で指定する。
// ライブラリとのバージョンのずれを避けるため、毎回 node_modules からコピーする。
const SOURCE = 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs';
const DESTINATION_DIRECTORY = 'public';

mkdirSync(DESTINATION_DIRECTORY, { recursive: true });
cpSync(SOURCE, `${DESTINATION_DIRECTORY}/maplibre-gl-worker.mjs`);
console.log('copied maplibre-gl-worker.mjs');
