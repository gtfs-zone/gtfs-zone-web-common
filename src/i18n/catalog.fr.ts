import type { Translation } from './index';
import type { en } from './catalog.en';

/** web-common's own UI strings, in French. */
export const fr: Translation<typeof en> = {
  'common.cancel': 'Annuler',
  'common.clear': 'Effacer',
  'common.close': 'Fermer',
  'common.load': 'Charger',
  'common.today': "Aujourd'hui",
  'common.guide': 'Guide',

  'locale.switchTo': 'English',

  'shell.search': 'Rechercher',
  'shell.logoAlt': 'Logo {host}',
  'breadcrumb.label': "Fil d'Ariane",

  'stopType.stop': 'Arrêt',
  'stopType.station': 'Station',
  'stopType.entrance': 'Accès',
  'stopType.node': 'Nœud',
  'stopType.boardingArea': "Zone d'embarquement",

  'calendar.prevMonth': 'Mois précédent',
  'calendar.nextMonth': 'Mois suivant',
  'calendar.feedStart': 'Aller au début du flux',
  'calendar.feedEnd': 'Aller à la fin du flux',
  'calendar.noFeedRange': 'Aucune période feed_info',
  'calendar.notByMonth': "{tab} n'est pas organisé par mois",

  'color.custom': 'Personnalisée…',
  'color.pick': 'Choisir une couleur',

  'issue.showAll': 'Tout afficher ({count})',

  'progress.processing': 'Traitement...',
  'progress.cancelling': 'Annulation...',

  'search.failed': 'La recherche a échoué, voir la console',
  'search.noFeedResults':
    'Aucun résultat dans le flux. Recherche de lieux indisponible',
  'search.noResults': 'Aucun résultat pour « {query} »',
  'search.searchingPlaces': 'Recherche de lieux...',
  'search.placesUnavailable': 'Recherche de lieux indisponible',
  'search.places': 'Lieux',

  'shortcuts.failed': '{action} : échec ({error})',
  'shortcuts.key.shift': 'Maj',
  'shortcuts.key.escape': 'Échap',
  'shortcuts.key.enter': 'Entrée',
  'shortcuts.key.space': 'Espace',
  'shortcuts.key.backspace': 'Retour arrière',
  'shortcuts.key.delete': 'Suppr',

  'help.group.Getting Started': 'Premiers pas',
  'help.group.Reference': 'Référence',
  'help.about.label': 'À propos',
  'help.about.title': 'À propos de {app}',
  'help.shortcuts.label': 'Raccourcis clavier',
  'help.shortcuts.title': 'Utiliser les raccourcis clavier',
  'help.shortcuts.key': 'Touche',
  'help.shortcuts.action': 'Action',

  'about.versionSource': 'Version et sources',
  'about.version': 'Version : {version}',
  'about.sourceCode': 'Code source',
  'about.changelog': 'Journal des modifications',
  'about.project': 'Projet',
  'about.siteNote': 'le projet dont font partie ces outils',
  'about.managerNote':
    'publiez votre propre flux temps réel (compte nécessaire)',
  'about.resources': 'Ressources',
  'about.specLabel': 'Référence de la spécification GTFS',
  'about.specNote': 'référence officielle des fichiers et des champs',
  'about.transitlandNote':
    'des flux GTFS réels, un des catalogues derrière Charger -&gt; Catalogues de flux',
  'about.dataSources': 'Sources de données',
  'about.feedListNote':
    'la liste de flux vérifiés derrière Charger -&gt; Catalogues de flux',
  'about.atlasNote': 'catalogue de flux, {license}',
  'about.mobilityNote': 'catalogue de flux de MobilityData, {license}',
  'about.ntdNote': 'liens GTFS déclarés à la FTA, domaine public',
  'about.publisherLicense':
    "Un flux chargé appartient à son éditeur et reste sous la licence de l'éditeur.",
  'about.feedback': 'Contact',
  'about.contactNote': 'questions, demandes de flux, tout le reste',
  'about.issueLabel': 'Ouvrir un ticket sur GitHub',
  'about.issueNote': 'signalements de bugs et demandes de fonctionnalités',

  'load.titleLoad': 'Charger un flux',
  'load.titleOpen': 'Ouvrir un flux',
  'load.listHeading': 'Catalogues de flux',
  'load.listCredit':
    'issus de {atlas} ({license}), de la {mobility}, de la {ntd} et de {rt}',
  'load.updated': 'mis à jour le {date}',
  'load.kb': '{size} Ko',
  'load.mb': '{size} Mo',
  'load.catalogUnavailable': 'Catalogues de flux indisponibles - {reason}',
  'load.urlScheduled': 'théorique',
  'load.inUse': 'utilisé',
  'load.customTitle': 'URL de flux personnalisées',
  'load.customRealtime':
    'Saisissez ou collez vos propres URL théoriques et temps réel ci-dessous',
  'load.customScheduled':
    'Saisissez ou collez votre propre URL de flux ci-dessous',
  'load.showAllTipRealtime':
    "Les flux du catalogue sont listés quand un horaire théorique et au moins un point d'accès temps réel ont répondu au dernier contrôle quotidien. Tout afficher liste aussi les autres ; certains hôtes refusent un contrôle direct mais répondent via le proxy CORS.",
  'load.showAllTipScheduled':
    'Les flux du catalogue sont listés quand un horaire théorique a répondu au dernier contrôle quotidien. Tout afficher liste aussi les autres ; certains hôtes refusent un contrôle direct mais répondent via le proxy CORS.',
  'load.corsTip':
    "Fait passer les requêtes par cors.kcfam.us quand le serveur du flux n'envoie pas d'en-têtes CORS.",
  'load.corsProxy': 'Proxy CORS',
  'load.routes_one': '{count} ligne',
  'load.routes_other': '{count} lignes',
  'load.stops_one': '{count} arrêt',
  'load.stops_other': '{count} arrêts',
  'load.trips_one': '{count} course',
  'load.trips_other': '{count} courses',
  'load.edits_one': '{count} modification',
  'load.edits_other': '{count} modifications',
  'load.continueWith': 'Continuer avec {name}',
  'load.linked': 'Charger le flux du lien',
  'load.retryCors': 'Réessayer via le proxy CORS',
  'load.scheduledGtfs': 'GTFS théorique',
  'load.realtimeGtfs': 'GTFS-RT temps réel',
  'load.customScheduledLabel': 'Flux théorique personnalisé',
  'load.customRealtimeLabel': 'Flux temps réel personnalisé',
  'load.scheduledPlaceholder':
    'https://…/gtfs.zip  (ajoutez #inner.zip pour un flux imbriqué)',
  'load.uploadZip': 'Importer un ZIP',
  'load.searchPlaceholder': 'Rechercher par réseau, lieu ou URL...',
  'load.showAll': 'Tout afficher',
  'load.loadingFeeds': 'Chargement des flux…',
  'load.loading': 'Chargement…',
  'load.noResults': 'Aucun résultat.',
};
