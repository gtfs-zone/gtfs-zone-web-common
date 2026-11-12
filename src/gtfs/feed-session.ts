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

import { GTFSScheduled, type ScheduledOptions } from './scheduled';
import type { AlertRecord, TripUpdate, VehiclePosition } from './rt-types';
import { adoptFeedTimezone } from './feed-time';
import {
  downloadPercent,
  formatBytes,
  LoadCancelledError,
} from './feed-download';
import { feedProgressIndicator } from '../ui/progress-indicator';
import type { LoadProgress } from './store/store-client';

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

/**
 * Where a schedule zip comes from: a URL to fetch (`a.zip#inner.zip` names a
 * nested archive), or a file the user picked.
 */
export type ScheduleInput = { url: string } | { file: File };

/** The progress line for one load step. */
function progressText(label: string, p: LoadProgress): string {
  if (p.stage === 'index') {
    return `Indexing ${label}…`;
  }
  const file = p.table ? ` - ${p.table}.txt` : '';
  return p.total
    ? `Loading ${label}${file} - ${formatBytes(p.bytes)} of ${formatBytes(p.total)}`
    : `Loading ${label}${file} - ${formatBytes(p.bytes)}`;
}

/**
 * Events: `change` after every schedule load settles, `scheduleloaded`
 * (detail: the new `GTFSScheduled`) when one succeeds, and `scheduledata`
 * when the feed fetched data a page may be waiting for. Subclasses add their
 * own.
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

  /** How schedules are loaded; an app that only sees small feeds mirrors `all`. */
  protected scheduleOptions: ScheduledOptions = {};

  private controller: AbortController | null = null;
  /** Latest `withTrips` call per payload kind, so a slow lookup never wins. */
  private tripSeq = new Map<string, number>();

  /**
   * Download and parse a schedule zip, replacing the current one.
   *
   * The current schedule is released first, so two feeds are never in memory
   * together; a cancelled or failed load leaves no schedule. Sets
   * `scheduleError` and rethrows on failure; throws `LoadCancelledError` on a
   * cancel.
   */
  async loadSchedule(input: ScheduleInput, label: string): Promise<void> {
    this.cancelLoad();
    this.releaseSchedule();
    const controller = new AbortController();
    this.controller = controller;

    feedProgressIndicator.startLoading('scheduled-load', `Loading ${label}…`, {
      onCancel: () => controller.abort(),
    });
    try {
      const feed = await GTFSScheduled.load(input, this.scheduleOptions, {
        signal: controller.signal,
        onProgress: (p) => {
          feedProgressIndicator.updateProgress(
            'scheduled-load',
            p.stage === 'index'
              ? 100
              : (downloadPercent(p.bytes, p.total) ?? 0),
            progressText(label, p)
          );
        },
      });
      // A load superseded after the worker finished is dropped here.
      if (controller.signal.aborted) {
        feed.release();
        throw new LoadCancelledError();
      }
      this.scheduledFeed = feed;
      feed.addEventListener('dataloaded', () => {
        if (this.scheduledFeed === feed) {
          this.dispatchEvent(new Event('scheduledata'));
        }
      });
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
        feedProgressIndicator.finishLoading('scheduled-load');
      }
      this.emitChange();
    }
  }

  /** Abort the schedule load in flight, if any. */
  cancelLoad(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Drop the current schedule and terminate its worker. */
  protected releaseSchedule(): void {
    if (!this.scheduledFeed) {
      return;
    }
    this.scheduledFeed.release();
    this.scheduledFeed = null;
    this.scheduleLoadedAt = null;
    console.log('[FeedSession] schedule released');
  }

  /**
   * Fetch the scheduled trips a realtime payload names, then run `apply`.
   *
   * Pages and the realtime index read trips synchronously, so a payload is
   * applied only once its trips are here. Calls are sequenced per `kind`: an
   * older payload whose lookup finishes late is dropped. A failed lookup is
   * logged and the payload applied anyway, unmatched.
   */
  protected withTrips(
    kind: string,
    tripIds: Iterable<string | null | undefined>,
    apply: () => void
  ): void {
    const seq = (this.tripSeq.get(kind) ?? 0) + 1;
    this.tripSeq.set(kind, seq);
    const feed = this.scheduledFeed;
    const ids: string[] = [];
    for (const id of tripIds) {
      if (id) {
        ids.push(id);
      }
    }
    const ready = feed ? feed.loadTrips(ids) : Promise.resolve();
    ready
      .catch((err) => {
        if (feed === this.scheduledFeed) {
          console.error(
            `[FeedSession] scheduled trips for ${kind} failed`,
            err
          );
        }
      })
      .finally(() => {
        if (this.tripSeq.get(kind) === seq) {
          apply();
        }
      });
  }

  protected emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}
