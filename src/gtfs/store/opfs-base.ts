/**
 * Feed base files in OPFS, under one directory.
 *
 * Writing and reading use a sync access handle, so they run only in a
 * worker. Listing and deleting use the async API and run on any thread.
 * A file is never overwritten: each base gets a new name, and the caller
 * commits that name elsewhere once the write has returned.
 */

import { readBase, writeBase } from './base-file';
import type { FeedStore } from './feed-store';
import type { StreamResult } from './csv-stream';

const DIR = 'feed-bases';

/** The worker-only parts of OPFS, missing from the DOM lib types. */
interface SyncAccessHandle {
  read(into: Uint8Array, opts: { at: number }): number;
  write(bytes: Uint8Array, opts: { at: number }): number;
  getSize(): number;
  flush(): void;
  close(): void;
}

function syncHandle(fh: FileSystemFileHandle): Promise<SyncAccessHandle> {
  return (
    fh as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }
  ).createSyncAccessHandle();
}

function fileEntries(
  dir: FileSystemDirectoryHandle
): AsyncIterable<[string, FileSystemHandle]> {
  return (
    dir as unknown as {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    }
  ).entries();
}

/** The OPFS directory holding base files; throws when OPFS is unavailable. */
async function baseDir(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error(
      'This browser does not provide the Origin Private File System, which is needed to store feeds'
    );
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

async function exists(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return false;
    }
    throw err;
  }
}

/** Write the store's base to a new file `name`. Returns its size in bytes. */
export async function saveBaseFile(
  store: FeedStore,
  stream: StreamResult,
  name: string
): Promise<number> {
  const dir = await baseDir();
  if (await exists(dir, name)) {
    throw new Error(`[OpfsBase] ${name} already exists`);
  }
  const t0 = performance.now();
  const fh = await dir.getFileHandle(name, { create: true });
  const h = await syncHandle(fh);
  let size: number;
  try {
    size = writeBase(store, stream, {
      write(bytes, at) {
        const n = h.write(bytes, { at });
        // Chromium reports a full quota as a count above the request (a
        // negative file error read as unsigned) instead of throwing.
        if (n > bytes.length) {
          throw new DOMException(
            `[OpfsBase] no space left to write ${name}`,
            'QuotaExceededError'
          );
        }
        if (n !== bytes.length) {
          throw new Error(
            `[OpfsBase] short write: ${n} of ${bytes.length} bytes at ${at}`
          );
        }
      },
    });
    h.flush();
  } catch (err) {
    h.close();
    await dir
      .removeEntry(name)
      .catch((e: unknown) =>
        console.warn(`[OpfsBase] could not remove partial ${name}`, e)
      );
    throw err;
  }
  h.close();
  console.log(
    `[OpfsBase] saved ${name}: ${size} bytes in ${Math.round(performance.now() - t0)}ms`
  );
  return size;
}

/** Read the base file `name` into a store. */
export async function loadBaseFile(
  name: string
): Promise<{ store: FeedStore; stream: StreamResult }> {
  const dir = await baseDir();
  const t0 = performance.now();
  const fh = await dir.getFileHandle(name);
  const h = await syncHandle(fh);
  try {
    const out = readBase({
      size: h.getSize(),
      read(into, at) {
        const n = h.read(into, { at });
        if (n !== into.length) {
          throw new Error(
            `[OpfsBase] short read: ${n} of ${into.length} bytes at ${at}`
          );
        }
      },
    });
    console.log(
      `[OpfsBase] loaded ${name} in ${Math.round(performance.now() - t0)}ms`
    );
    return out;
  } finally {
    h.close();
  }
}

/** Names and sizes of every stored base file. */
export async function listBaseFiles(): Promise<
  { name: string; size: number }[]
> {
  const dir = await baseDir();
  const out: { name: string; size: number }[] = [];
  for await (const [name, handle] of fileEntries(dir)) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ name, size: file.size });
    }
  }
  return out;
}

/** Delete one base file. A missing file is not an error. */
export async function deleteBaseFile(name: string): Promise<void> {
  const dir = await baseDir();
  try {
    await dir.removeEntry(name);
    console.log(`[OpfsBase] deleted ${name}`);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return;
    }
    throw err;
  }
}

/** Delete every base file not in `keep`. Returns the names deleted. */
export async function sweepBaseFiles(keep: string[]): Promise<string[]> {
  const keepSet = new Set(keep);
  const gone: string[] = [];
  for (const { name } of await listBaseFiles()) {
    if (!keepSet.has(name)) {
      await deleteBaseFile(name);
      gone.push(name);
    }
  }
  return gone;
}

/** Delete the whole base directory (Settings -> Reset). */
export async function clearBaseFiles(): Promise<void> {
  if (!navigator.storage?.getDirectory) {
    return;
  }
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(DIR, { recursive: true });
    console.log('[OpfsBase] cleared all base files');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return;
    }
    throw err;
  }
}
