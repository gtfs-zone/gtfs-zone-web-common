import { defineCatalog } from '../../i18n/index';
import { en } from './catalog.en';
import { fr } from './catalog.fr';
import { de } from './catalog.de';

/**
 * Translator for the field type validation messages alone, so a worker that
 * builds the schemas does not bundle the UI catalogs.
 */
export const t = defineCatalog(en, { fr, de });
