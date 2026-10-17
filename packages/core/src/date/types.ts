/** 日付の精度(仕様書 §3-3) */
export type DatePrecision =
  | 'full'
  | 'date'
  | 'month'
  | 'year'
  | 'none'
  | 'invalid';

/** 日付の取得元(台帳の `date_source`)。exif・video が通常、それ以外がフォールバック */
export type DateSource = 'exif' | 'video' | 'json' | 'filename' | 'none';

/** 年から秒までの、日時の部品。後ろの部品が無いものは、その精度までの日時 */
export type DateParts = {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
};

/** ファイル本体のメタデータから読んだ日時。ExifTool の値を、呼び出し側が、この形にして渡す */
export type RawDateTime =
  | { kind: 'value'; parts: DateParts }
  // `0000:00:00 00:00:00` など、日時として解釈できなかった値
  | { kind: 'unparsable' };

/** 日付を決めるための、ファイルの情報 */
export type DateInput = {
  /** 元の名前(ZIP の中のファイルは、中の名前) */
  fileName: string;
  /** 写真・RAW の EXIF(優先順位 1)。DateTimeOriginal → DateTimeDigitized → CreateDate の順に試す */
  exif?: {
    dateTimeOriginal?: RawDateTime;
    dateTimeDigitized?: RawDateTime;
    createDate?: RawDateTime;
  };
  /** 動画の CreateDate(優先順位 2)。UTC で記録されている */
  videoCreateDateUtc?: RawDateTime;
  /** Takeout の json の撮影日時(UNIX 秒。優先順位 3) */
  takeoutPhotoTakenEpochSeconds?: number;
  /** ファイルの更新日。日付としては採用せず、参考として、結果に持ち回る */
  mtime?: Date;
};

export type DateOptions = {
  /** 「未来の日付」の判定に使う、現在の時刻 */
  now: Date;
  /** 本機のタイムゾーン(IANA の名前。例: Asia/Tokyo)。動画の UTC を、この時刻に変換する */
  timeZone: string;
};

/** 日付の決定の結果 */
export type DateResolution = {
  precision: DatePrecision;
  source: DateSource;
  /** 決めた日時。`none` と `invalid` のときは、undefined */
  parts: DateParts | undefined;
  /** フォールバックの理由(台帳の `date_reason`)。通常(exif・video)のときは、空 */
  reason: string;
  /** ファイル名から取れたときの、パターンの名前 */
  filenamePattern: string | undefined;
  /** 参考の更新日(日付としては採用しない) */
  referenceMtime: Date | undefined;
};
