import type { Translation } from '../../i18n/index';
import type { en } from './catalog.en';

/** Field type validation messages, in German. */
export const de: Translation<typeof en> = {
  'value.month': 'Der Monat muss zwischen 01 und 12 liegen',
  'value.day': 'Der Tag muss zwischen 01 und 31 liegen',
  'value.minutes': 'Die Minuten müssen zwischen 00 und 59 liegen',
  'value.seconds': 'Die Sekunden müssen zwischen 00 und 59 liegen',
  'value.integerNoDecimals':
    'Muss eine ganze Zahl sein (ohne Nachkommastellen)',
  'value.languageCode': 'Muss ein gültiger Sprachcode nach IETF BCP 47 sein',
  'value.currencyCode':
    'Muss ein dreistelliger Währungscode nach ISO 4217 sein',
  'value.decimalAmount': 'Muss ein gültiger Dezimalbetrag sein',
  'value.hexColor': 'Muss eine sechsstellige Hexadezimalfarbe sein',
  'value.dateFormat': 'Muss im Format JJJJMMTT sein',
  'value.timeFormat': 'Muss im Format HH:MM:SS sein',
  'value.url':
    'Muss eine vollständige URL sein, die mit http:// oder https:// beginnt',
  'value.email': 'Muss eine gültige E-Mail-Adresse sein',
  'value.nonNegative': 'Muss 0 oder größer sein',
  'value.positive': 'Muss größer als 0 sein',
  'value.notZero': 'Darf nicht 0 sein',
  'value.unknownType': 'Unbekannter Feldtyp: {type}',
  'value.invalidFormat': 'Ungültiges Format für {type}. {description}',
  'value.min': 'Der Wert muss >= {min} sein',
  'value.max': 'Der Wert muss <= {max} sein',
};
