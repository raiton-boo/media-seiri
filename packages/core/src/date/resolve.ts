import { parseFilenameDate } from './filename.ts';
import { epochToLocalParts, utcPartsToLocalParts } from './timezone.ts';
import type {
  DateInput,
  DateOptions,
  DateParts,
  DateResolution,
  DateSource,
  RawDateTime,
} from './types.ts';
import { validatedPrecision } from './validate.ts';

const MILLISECONDS_PER_SECOND = 1000;

const REASON_NONE =
  '本体のメタデータ・Takeout の json・ファイル名の、どれからも日付が取れなかった';
const REASON_INVALID =
  '日付の値が、すべて無効だった(0000:00:00、存在しない日付、1970 年より前、未来 など)';
const PREFIX_MISSING = '本体のメタデータに撮影日時がなかったため、';
const PREFIX_INVALID = '本体の日時の値が無効だったため、';

type Candidate = {
  source: DateSource;
  /** 値が無い(undefined)、または解釈できなかった(unparsable)ことを、区別するために持つ */
  value: DateParts | 'unparsable';
  pattern?: string;
};

/** 優先順位の高い順に、試す候補を並べる(仕様書 §3-1) */
const buildCandidates = (
  input: DateInput,
  options: DateOptions
): Candidate[] => {
  const candidates: Candidate[] = [];
  const addRaw = (
    source: DateSource,
    raw: RawDateTime | undefined,
    convert?: (parts: DateParts) => DateParts
  ) => {
    if (!raw) return;
    if (raw.kind === 'unparsable')
      candidates.push({ source, value: 'unparsable' });
    else
      candidates.push({
        source,
        value: convert ? convert(raw.parts) : raw.parts,
      });
  };

  // 優先順位 1: 写真・RAW の EXIF。写真は、書かれている時刻を、そのまま使う
  addRaw('exif', input.exif?.dateTimeOriginal);
  addRaw('exif', input.exif?.dateTimeDigitized);
  addRaw('exif', input.exif?.createDate);
  // 優先順位 2: 動画の CreateDate。UTC なので、本機のタイムゾーンへ変換する
  addRaw('video', input.videoCreateDateUtc, (parts) =>
    utcPartsToLocalParts(parts, options.timeZone)
  );
  // 優先順位 3: Takeout の json
  if (input.takeoutPhotoTakenEpochSeconds !== undefined) {
    candidates.push({
      source: 'json',
      value: epochToLocalParts(
        input.takeoutPhotoTakenEpochSeconds * MILLISECONDS_PER_SECOND,
        options.timeZone
      ),
    });
  }
  // 優先順位 4: ファイル名
  const fromName = parseFilenameDate(input.fileName, options);
  if (fromName.kind === 'found') {
    candidates.push({
      source: 'filename',
      value: fromName.parts,
      pattern: fromName.pattern,
    });
  } else if (fromName.kind === 'invalid') {
    candidates.push({
      source: 'filename',
      value: 'unparsable',
      pattern: fromName.pattern,
    });
  }
  return candidates;
};

/**
 * 日付を決める(仕様書 §3)。
 * 優先順位の高い取得元から試し、最初に有効だった値を採用する。無効な値は、次の取得元へ進む。
 * ファイルの更新日(mtime)は、日付として採用しない。
 */
export const resolveDate = (
  input: DateInput,
  options: DateOptions
): DateResolution => {
  const base = {
    referenceMtime: input.mtime,
    filenamePattern: undefined as string | undefined,
  };
  let sawInvalid = false;
  let metadataWasInvalid = false;

  for (const candidate of buildCandidates(input, options)) {
    const precision =
      candidate.value === 'unparsable'
        ? undefined
        : validatedPrecision(candidate.value, options);
    if (candidate.value === 'unparsable' || precision === undefined) {
      sawInvalid = true;
      if (candidate.source === 'exif' || candidate.source === 'video')
        metadataWasInvalid = true;
      continue;
    }
    const parts = candidate.value;
    if (candidate.source === 'exif' || candidate.source === 'video') {
      return {
        ...base,
        precision,
        source: candidate.source,
        parts,
        reason: '',
      };
    }
    const prefix = metadataWasInvalid ? PREFIX_INVALID : PREFIX_MISSING;
    const origin =
      candidate.source === 'json'
        ? 'Takeout の json から取得'
        : `ファイル名(${candidate.pattern})から取得`;
    return {
      ...base,
      precision,
      source: candidate.source,
      parts,
      reason: `${prefix}${origin}`,
      filenamePattern: candidate.pattern,
    };
  }

  return sawInvalid
    ? {
        ...base,
        precision: 'invalid',
        source: 'none',
        parts: undefined,
        reason: REASON_INVALID,
      }
    : {
        ...base,
        precision: 'none',
        source: 'none',
        parts: undefined,
        reason: REASON_NONE,
      };
};
