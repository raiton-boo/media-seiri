export { avoidReservedName, cleanOriginalName } from './clean-name.ts';
export { isExcludedName } from './exclusion.ts';
export { classifyFile, extensionOf, type FileKind, stemOf } from './files.ts';
export {
  type Bucket,
  buildPlacement,
  type Placement,
  type PlacementTarget,
  targetFromResolution,
  type UnknownReason,
} from './placement.ts';
