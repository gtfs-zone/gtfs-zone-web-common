import { defineCatalog } from './index';
import { en } from './catalog.en';
import { fr } from './catalog.fr';
import { de } from './catalog.de';

/** Translator for web-common's own UI strings. */
export const t = defineCatalog(en, { fr, de });
