/**
 * A live session: the parsed schedule plus the realtime payloads read off it.
 *
 * `FeedSession` is the read-only view the realtime modules here need. Same
 * idea as `route-source.ts`: define the narrow surface the shared engine reads
 * and let each app satisfy it from its own storage. rt-viewer's session owns a
 * GTFS-RT poller and fills these from decoded `.pb` payloads; rt-manager's
 * fills them from an API and an SSE channel.
 *
 * Read-only on purpose: nothing in this package writes to a session, and the
 * covariance of `ReadonlyMap` is what lets an app pass a map of its own
 * extended `VehiclePosition`.
 *
 * `FeedSessionBase` is the half both apps' sessions share: the four members,
 * and downloading and parsing the schedule behind the progress bar. Each app
 * extends it with how its realtime half arrives.
 */

import { GTFSScheduled } from './scheduled';
import type { LoadHooks } from './scheduled';
import type { AlertRecord, TripUpdate, VehiclePosition } from './rt-types';
import { adoptFeedTimezone } from './feed-time';
import {
  downloadPercent,
  formatBytes,
  LoadCancelledError,
} from './feed-download';
import { feedProgressIndicator } from '../ui/progress-indicator';

/**
 * `V` is the app's own vehicle shape, which may carry more than this package
 * reads; rt-manager's names the tracker a vehicle reports under. It is a
 * parameter rather than a widening so `rt-index.ts` can hand the app's own
 * vehicles back out of its indexes.
 */
export interface FeedSession<V extends VehiclePosition = VehiclePosition> {
  /** The parsed schedule, or null before one has loaded. */
  scheduledFeed: GTFSScheduled | null;
  /** Live vehicles by `VehiclePosition.key`. */
  vehicles: ReadonlyMap<string, V>;
  /** Live alerts by `AlertRecord.id`. */
  alerts: ReadonlyMap<string, AlertRecord>;
  /** The latest trip updates, as the producer sent them. */
  tripUpdates: readonly TripUpdate[];
}

/** Where a schedule zip comes from: a URL to fetch, or a file the user picked. */
export type ScheduleInput = { url: string } | { file: File };

/**
 * Events: `change` after every schedule load settles, and `scheduleloaded`
 * (detail: the new `GTFSScheduled`) when one succeeds. Subclasses add their own.
 */
export class FeedSessionBase<V extends VehiclePosition = VehiclePosition>
  extends EventTarget
  implements FeedSession<V>
{
  scheduledFeed: GTFSScheduled | null = null;
  /** Why the last schedule load failed, or null. A cancel is not a failure. */
  scheduleError: string | null = null;
  /** When the current schedule finished parsing, in epoch milliseconds. */
  scheduleLoadedAt: number | null = null;

  vehicles = new Map<string, V>();
  alerts = new Map<string, AlertRecord>();
  tripUpdates: TripUpdate[] = [];

  private controller: AbortController | null = null;

  /**
   * Download and parse a schedule zip, replacing the current one on success.
   *
   * Cancels any load still in flight. Sets `scheduleError` and rethrows on
   * failure; throws `LoadCancelledError` on a cancel, leaving the previous
   * schedule live. A file has no fetch to abort, so it gets no Cancel button.
   */
  async loadSchedule(input: ScheduleInput, label: string): Promise<void> {
    this.cancelLoad();
    const controller = new AbortController();
    this.controller = controller;
    const feed = new GTFSScheduled();

    // Download and parse are separate operations so the bar shows real byte
    // progress first, then per-file parse progress.
    let parsing = false;
    const hooks: LoadHooks = {
      onDownload: (loaded, total) => {
        feedProgressIndicator.updateProgress(
          'scheduled-download',
          downloadPercent(loaded, total) ?? 0,
          total
            ? `Downloading ${label} - ${formatBytes(loaded)} of ${formatBytes(total)}`
            : `Downloading ${label} - ${formatBytes(loaded)}`
        );
      },
      onParse: (fileName, done, total) => {
        if (!parsing) {
          parsing = true;
          feedProgressIndicator.finishLoading('scheduled-download');
          feedProgressIndicator.startLoading(
            'scheduled-parse',
            `Parsing ${label}…`
          );
        }
        feedProgressIndicator.updateProgress(
          'scheduled-parse',
          Math.round((done / total) * 100),
          `Parsing ${label} - ${fileName}`
        );
      },
    };

    feedProgressIndicator.startLoading(
      'scheduled-download',
      `Downloading ${label}…`,
      'url' in input ? { onCancel: () => controller.abort() } : {}
    );
    try {
      if ('url' in input) {
        await feed.loadFromUrl(input.url, {
          ...hooks,
          signal: controller.signal,
        });
      } else {
        await feed.loadFromFile(input.file, hooks);
      }
      // The signal only aborts the download, so a load superseded mid-parse
      // finishes here and is dropped rather than replacing the newer one.
      if (controller.signal.aborted) {
        throw new LoadCancelledError();
      }
      this.scheduledFeed = feed;
      // Every transit time rendered from here on is anchored to this feed's zone.
      adoptFeedTimezone(feed);
      this.scheduleError = null;
      this.scheduleLoadedAt = Date.now();
      // Separate from `change` because the map reloads its sources on this
      // and on nothing else.
      this.dispatchEvent(
        new CustomEvent<GTFSScheduled>('scheduleloaded', { detail: feed })
      );
    } catch (err) {
      if (!(err instanceof LoadCancelledError)) {
        this.scheduleError = err instanceof Error ? err.message : String(err);
      }
      throw err;
    } finally {
      // A superseded load leaves the newer load's progress bar alone.
      if (this.controller === controller) {
        this.controller = null;
        feedProgressIndicator.finishLoading('scheduled-download');
        feedProgressIndicator.finishLoading('scheduled-parse');
      }
      this.emitChange();
    }
  }

  /** Abort the schedule load in flight, if any. */
  cancelLoad(): void {
    this.controller?.abort();
    this.controller = null;
  }

  protected emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
