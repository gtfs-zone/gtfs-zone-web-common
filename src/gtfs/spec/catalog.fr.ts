import type { Translation } from '../../i18n/index';
import type { en } from './catalog.en';

/** Field type validation messages, in French. */
export const fr: Translation<typeof en> = {
  'value.month': 'Le mois doit être compris entre 01 et 12',
  'value.day': 'Le jour doit être compris entre 01 et 31',
  'value.minutes': 'Les minutes doivent être comprises entre 00 et 59',
  'value.seconds': 'Les secondes doivent être comprises entre 00 et 59',
  'value.integerNoDecimals': 'Doit être un entier (sans décimales)',
  'value.languageCode': 'Doit être un code de langue IETF BCP 47 valide',
  'value.currencyCode': 'Doit être un code de devise ISO 4217 à 3 lettres',
  'value.decimalAmount': 'Doit être un montant décimal valide',
  'value.hexColor': 'Doit être une couleur hexadécimale à 6 chiffres',
  'value.dateFormat': 'Doit être au format AAAAMMJJ',
  'value.timeFormat': 'Doit être au format HH:MM:SS',
  'value.url': 'Doit être une URL complète commençant par http:// ou https://',
  'value.email': 'Doit être une adresse e-mail valide',
  'value.nonNegative': 'Doit être supérieur ou égal à 0',
  'value.positive': 'Doit être supérieur à 0',
  'value.notZero': 'Ne doit pas valoir 0',
  'value.unknownType': 'Type de champ inconnu : {type}',
  'value.invalidFormat': 'Format invalide pour {type}. {description}',
  'value.min': 'La valeur doit être >= {min}',
  'value.max': 'La valeur doit être <= {max}',
};
