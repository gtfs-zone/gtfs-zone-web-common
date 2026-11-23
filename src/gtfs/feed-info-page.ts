/** The Feed info page: feed_info.txt's fields as properties. */

import type { RenderContext } from './entity-render';
import {
  escHtml,
  externalLink,
  optionalProp,
  propList,
  renderRawFields,
} from './entity-render';
import { formatServiceDate } from './feed-time';
import type { TreeLocation } from './tree-location';
import type { TreePage } from './tree-page';
import { t } from '../i18n/messages';

export function feedInfoPage(ctx: RenderContext<TreeLocation>): TreePage {
  const info = ctx.session.scheduledFeed?.feedInfo[0];
  const label = t('crumb.feedInfo');
  if (!info) {
    return {
      eyebrow: label,
      title: label,
      sections: [
        {
          body: `<p class="text-sm opacity-60">${t('schedule.noFeedInfo', { file: '<span class="font-mono">feed_info.txt</span>' })}</p>`,
        },
      ],
    };
  }
  const raw = info.raw;
  const date = (value: string | undefined) =>
    value ? escHtml(formatServiceDate(value)) : '';
  return {
    eyebrow: label,
    title: info.publisher_name || label,
    sections: [
      {
        body: propList([
          optionalProp(t('feedInfo.publisher'), escHtml(info.publisher_name)),
          optionalProp(t('feedInfo.website'), externalLink(info.publisher_url)),
          optionalProp(t('feedInfo.language'), escHtml(info.lang)),
          optionalProp(
            t('feedInfo.defaultLanguage'),
            escHtml(raw.default_lang ?? '')
          ),
          optionalProp(t('feedInfo.start'), date(raw.feed_start_date)),
          optionalProp(t('feedInfo.end'), date(raw.feed_end_date)),
          optionalProp(t('feedInfo.version'), escHtml(info.version)),
          optionalProp(
            t('feedInfo.contactEmail'),
            raw.feed_contact_email
              ? externalLink(
                  `mailto:${raw.feed_contact_email}`,
                  raw.feed_contact_email
                )
              : ''
          ),
          optionalProp(
            t('feedInfo.contactUrl'),
            externalLink(raw.feed_contact_url)
          ),
        ]),
      },
      { body: renderRawFields('feed_info.txt', raw) },
    ],
  };
}
