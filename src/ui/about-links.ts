// The off-site destinations both gtfs.zone apps name in their About modal, and
// the blocks that render them. Each app supplies its own identity through
// `AboutApp` and keeps its own app-specific middle sections; everything here is
// shared so a URL cannot drift between the two modals.

import { t } from '../i18n/messages';

const SITE_URL = 'https://gtfs.zone';
const MANAGER_URL = 'https://manage.rt.gtfs.zone';
const GITHUB_URL = 'https://github.com/gtfs-zone';
const CONTACT_EMAIL = 'inquiry@gtfs.zone';

export interface AboutApp {
  /** Host name, used as the modal title and in prose. */
  name: string;
  /** Lead paragraphs saying what the app does, one <p> each. */
  blurb: string[];
  /** Optional bulleted list of what the app shows, under the paragraphs. */
  highlights?: string[];
  /** Optional closing paragraph, rendered after the bullets. */
  blurbFooter?: string;
  /** Subject line the contact link opens with. */
  contactSubject: string;
  /** Repo name under the gtfs-zone GitHub org. */
  repo: string;
  /** The other app, linked so each modal points at its sibling. */
  sibling: { name: string; href: string; note: string };
}

/** External anchor. Every off-site link in the modal goes through this. */
function link(href: string, label: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="link">${label}</a>`;
}

/** Exported for other prose that wants the same off-site anchor styling. */
export const renderExternalLink = link;

/** The TransitLand Atlas URL named in `renderResourcesSection()`. */
export const TRANSITLAND_URL = 'https://www.transit.land/';

function divider(label: string): string {
  return `<div class="divider text-sm font-semibold opacity-60">${label}</div>`;
}

function bullets(items: string[]): string {
  return `<ul class="list-disc list-inside space-y-1 text-sm">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

function list(items: string[]): string {
  return `<ul class="list-none space-y-1 text-sm">${items
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
}

/** A titled block of links, for an app's own sections next to the shared ones. */
export function renderSection(label: string, items: string[]): string {
  return divider(label) + list(items);
}

export function renderBlurb(app: AboutApp): string {
  // Lead paragraphs, then the bullets, then a closing line. Breaking the blurb
  // up this way is what keeps a long one from reading as a wall of prose.
  const parts = app.blurb.map((p) => `<p>${p}</p>`);
  if (app.highlights) {
    parts.push(bullets(app.highlights));
  }
  if (app.blurbFooter) {
    parts.push(`<p>${app.blurbFooter}</p>`);
  }
  return `<div class="space-y-2">${parts.join('')}</div>`;
}

export function renderVersionAndSource(app: AboutApp, version: string): string {
  const repo = `${GITHUB_URL}/${app.repo}`;
  return (
    divider(t('about.versionSource')) +
    list([
      t('about.version', {
        version: `<code class="font-mono">${version}</code>`,
      }),
      link(repo, t('about.sourceCode')),
      link(`${repo}/blob/main/CHANGELOG.md`, t('about.changelog')),
    ])
  );
}

export function renderProjectSection(app: AboutApp): string {
  return (
    divider(t('about.project')) +
    list([
      `${link(SITE_URL, 'gtfs.zone')}: ${t('about.siteNote')}`,
      `${link(app.sibling.href, app.sibling.name)}: ${app.sibling.note}`,
      `${link(MANAGER_URL, 'manage.rt.gtfs.zone')}: ${t('about.managerNote')}`,
    ])
  );
}

export function renderResourcesSection(): string {
  return (
    divider(t('about.resources')) +
    list([
      `${link('https://gtfs.org/reference/', t('about.specLabel'))}: ${t('about.specNote')}`,
      `${link('https://www.transit.land/', 'Transitland')}: ${t('about.transitlandNote')}`,
    ])
  );
}

/**
 * Where Load -> Feed catalogs comes from and whose data a loaded feed is. The
 * Transitland Atlas is CC BY 4.0 and asks for a link; the Mobility Database
 * catalog is CC0; the NTD GTFS weblinks are a US government work.
 */
export function renderDataSourcesSection(): string {
  return (
    divider(t('about.dataSources')) +
    list([
      `${link('https://list.gtfs.zone', 'list.gtfs.zone')}: ${t('about.feedListNote')}`,
      `${link('https://github.com/transitland/transitland-atlas', 'Transitland Atlas')}: ${t('about.atlasNote', { license: link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0') })}`,
      `${link('https://mobilitydatabase.org', 'Mobility Database')}: ${t('about.mobilityNote', { license: link('https://creativecommons.org/publicdomain/zero/1.0/', 'CC0') })}`,
      `${link('https://data.transportation.gov/d/2u7n-ub22', 'National Transit Database')}: ${t('about.ntdNote')}`,
      t('about.publisherLicense'),
    ])
  );
}

export function renderFeedbackSection(app: AboutApp): string {
  // The mailto is first: it works without a GitHub account.
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(app.contactSubject)}`;
  return (
    divider(t('about.feedback')) +
    list([
      `${link(mailto, CONTACT_EMAIL)}: ${t('about.contactNote')}`,
      `${link(`${GITHUB_URL}/${app.repo}/issues/new`, t('about.issueLabel'))}: ${t('about.issueNote')}`,
    ])
  );
}
