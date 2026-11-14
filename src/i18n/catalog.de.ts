import type { Translation } from './index';
import type { en } from './catalog.en';

/** web-common's own UI strings, in German. */
export const de: Translation<typeof en> = {
  'common.cancel': 'Abbrechen',
  'common.clear': 'Leeren',
  'common.close': 'Schließen',
  'common.load': 'Laden',
  'common.today': 'Heute',
  'common.guide': 'Anleitung',

  'locale.label': 'Sprache',
  'nav.github': 'Quellcode auf GitHub',

  'shell.search': 'Suchen',
  'shell.logoAlt': 'Logo von {host}',
  'breadcrumb.label': 'Navigationspfad',

  'stopType.stop': 'Haltestelle',
  'stopType.station': 'Station',
  'stopType.entrance': 'Zugang',
  'stopType.node': 'Knoten',
  'stopType.boardingArea': 'Einstiegsbereich',

  'calendar.prevMonth': 'Vorheriger Monat',
  'calendar.nextMonth': 'Nächster Monat',
  'calendar.feedStart': 'Zum Beginn des Feeds',
  'calendar.feedEnd': 'Zum Ende des Feeds',
  'calendar.noFeedRange': 'Kein Zeitraum in feed_info',
  'calendar.notByMonth': '{tab} ist nicht nach Monaten gegliedert',

  'color.custom': 'Eigene…',
  'color.pick': 'Farbe wählen',

  'issue.showAll': 'Alle anzeigen ({count})',

  'progress.processing': 'Wird verarbeitet...',
  'progress.cancelling': 'Wird abgebrochen...',

  'search.failed': 'Suche fehlgeschlagen, siehe Konsole',
  'search.noFeedResults': 'Keine Treffer im Feed. Ortssuche nicht verfügbar',
  'search.noResults': 'Keine Treffer für „{query}“',
  'search.searchingPlaces': 'Orte werden gesucht...',
  'search.placesUnavailable': 'Ortssuche nicht verfügbar',
  'search.places': 'Orte',

  'shortcuts.failed': '{action} fehlgeschlagen: {error}',
  'shortcuts.key.ctrl': 'Strg',
  'shortcuts.key.shift': 'Umschalt',
  'shortcuts.key.enter': 'Eingabe',
  'shortcuts.key.space': 'Leertaste',
  'shortcuts.key.backspace': 'Rücktaste',
  'shortcuts.key.delete': 'Entf',

  'help.group.Getting Started': 'Erste Schritte',
  'help.group.Reference': 'Referenz',
  'help.about.label': 'Über',
  'help.about.title': 'Über {app}',
  'help.shortcuts.label': 'Tastenkürzel',
  'help.shortcuts.title': 'Tastenkürzel verwenden',
  'help.shortcuts.key': 'Taste',
  'help.shortcuts.action': 'Aktion',

  'about.versionSource': 'Version und Quellcode',
  'about.version': 'Version: {version}',
  'about.sourceCode': 'Quellcode',
  'about.changelog': 'Änderungsprotokoll',
  'about.project': 'Projekt',
  'about.siteNote': 'das Projekt, zu dem diese Werkzeuge gehören',
  'about.managerNote':
    'betreiben Sie Ihren eigenen Echtzeit-Feed (Konto erforderlich)',
  'about.resources': 'Ressourcen',
  'about.specLabel': 'GTFS-Spezifikation',
  'about.specNote': 'offizielle Referenz der Dateien und Felder',
  'about.transitlandNote':
    'reale GTFS-Feeds, einer der Kataloge hinter Laden -&gt; Feed-Kataloge',
  'about.dataSources': 'Datenquellen',
  'about.feedListNote':
    'die geprüfte Feed-Liste hinter Laden -&gt; Feed-Kataloge',
  'about.atlasNote': 'Feed-Katalog, {license}',
  'about.mobilityNote': 'Feed-Katalog von MobilityData, {license}',
  'about.ntdNote': 'an die FTA gemeldete GTFS-Links, gemeinfrei',
  'about.publisherLicense':
    'Ein geladener Feed gehört seinem Herausgeber und steht unter dessen Lizenz.',
  'about.feedback': 'Feedback',
  'about.contactNote': 'Fragen, Feed-Wünsche, alles andere',
  'about.issueLabel': 'Issue auf GitHub erstellen',
  'about.issueNote': 'Fehlerberichte und Funktionswünsche',

  'load.titleLoad': 'Feed laden',
  'load.titleOpen': 'Feed öffnen',
  'load.listHeading': 'Feed-Kataloge',
  'load.listCredit':
    'aus {atlas} ({license}), dem {mobility}, der {ntd} und {rt}',
  'load.updated': 'aktualisiert am {date}',
  'load.kb': '{size} KB',
  'load.mb': '{size} MB',
  'load.catalogUnavailable': 'Feed-Kataloge nicht verfügbar - {reason}',
  'load.urlScheduled': 'Fahrplan',
  'load.selected': 'ausgewählt',
  'load.customTitle': 'Eigene Feed-URLs',
  'load.customRealtime':
    'Geben Sie unten Ihre eigenen Fahrplan- und Echtzeit-URLs ein oder fügen Sie sie ein',
  'load.customScheduled':
    'Geben Sie unten Ihre eigene Feed-URL ein oder fügen Sie sie ein',
  'load.showAllTipRealtime':
    'Katalog-Feeds werden angezeigt, wenn ein Fahrplan und mindestens ein Echtzeit-Endpunkt bei der letzten täglichen Prüfung geantwortet haben. Alle anzeigen listet auch die übrigen; manche Server lehnen eine direkte Prüfung ab, antworten aber über den CORS-Proxy.',
  'load.showAllTipScheduled':
    'Katalog-Feeds werden angezeigt, wenn ein Fahrplan bei der letzten täglichen Prüfung geantwortet hat. Alle anzeigen listet auch die übrigen; manche Server lehnen eine direkte Prüfung ab, antworten aber über den CORS-Proxy.',
  'load.corsTip':
    'Leitet Anfragen über cors.gtfs.zone, wenn der Feed-Server keine CORS-Header sendet.',
  'load.corsProxy': 'CORS-Proxy',
  'load.routes_one': '{count} Linie',
  'load.routes_other': '{count} Linien',
  'load.stops_one': '{count} Haltestelle',
  'load.stops_other': '{count} Haltestellen',
  'load.trips_one': '{count} Fahrt',
  'load.trips_other': '{count} Fahrten',
  'load.edits_one': '{count} Änderung',
  'load.edits_other': '{count} Änderungen',
  'load.yourFeeds': 'Ihre Feeds',
  'load.lastOpened': 'geöffnet am {date}',
  'load.active': 'geöffnet',
  'load.newer': 'neuere Version',
  'load.update': 'Aktualisieren',
  'load.delete': 'Löschen',
  'load.deleteTitle': '{name} löschen?',
  'load.deleteBody': 'Der Feed wird aus diesem Browser entfernt.',
  'load.deleteBodyEdits_one':
    'Der Feed und seine {count} Änderung werden aus diesem Browser entfernt. Das kann nicht rückgängig gemacht werden.',
  'load.deleteBodyEdits_other':
    'Der Feed und seine {count} Änderungen werden aus diesem Browser entfernt. Das kann nicht rückgängig gemacht werden.',
  'load.deleteFailed': '{name} konnte nicht gelöscht werden - {reason}',
  'load.linked': 'Verlinkten Feed laden',
  'load.retryCors': 'Über CORS-Proxy erneut versuchen',
  'load.scheduledGtfs': 'GTFS-Fahrplan',
  'load.realtimeGtfs': 'GTFS-RT-Echtzeit',
  'load.customScheduledLabel': 'Eigener Fahrplan-Feed',
  'load.customRealtimeLabel': 'Eigener Echtzeit-Feed',
  'load.scheduledPlaceholder':
    'https://…/gtfs.zip  (#inner.zip anhängen für einen verschachtelten Feed)',
  'load.uploadZip': 'ZIP hochladen',
  'load.searchPlaceholder': 'Nach Verkehrsunternehmen, Ort oder URL suchen...',
  'load.showAll': 'Alle anzeigen',
  'load.loadingFeeds': 'Feeds werden geladen…',
  'load.loading': 'Wird geladen…',
  'load.noResults': 'Keine Treffer.',
};
