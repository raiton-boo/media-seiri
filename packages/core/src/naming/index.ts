export { avoidReservedName, cleanOriginalName } from './clean-name.ts';
export { isExcludedName } from './exclusion.ts';
export {
  classifyFile,
  EXTENSIONS_BY_KIND,
  extensionOf,
  type FileKind,
  stemOf,
} from './files.ts';
export {
  type Bucket,
  buildPlacement,
  type Placement,
  type PlacementTarget,
  targetFromResolution,
  type UnknownReason,
} from './placement.ts';
