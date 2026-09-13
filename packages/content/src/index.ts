/**
 * @agorath/content — the pack format, read at runtime.
 *
 * The public half of the content layer (ADR-0007): the app needs to load and
 * validate a pack, and that is all this package does. Extraction, authoring
 * helpers and the build CLI stay private, with the books.
 */

export { readPack, readPackText } from './pack.ts';
export type {
  CatalogEntry,
  PackCatalog,
  PackMeta,
  PackReadResult,
  PackTier,
} from './pack.ts';
