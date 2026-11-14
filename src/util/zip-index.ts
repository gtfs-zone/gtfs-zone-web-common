/**
 * Reads a zip's central directory (names, CRC32, sizes) without inflating
 * anything, from the archive's tail. Handles zip64.
 */

export interface ZipEntryInfo {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 stored, 8 deflate. */
  method: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

/** Random access to an archive's bytes. */
export interface ZipByteReader {
  readonly size: number;
  read(at: number, length: number): Promise<Uint8Array>;
}

export function bytesReader(bytes: Uint8Array): ZipByteReader {
  return {
    size: bytes.length,
    read: async (at, length) => bytes.subarray(at, at + length),
  };
}

/** Reads only the slices asked for, so a File or OPFS file is never loaded whole. */
export function blobReader(blob: Blob): ZipByteReader {
  return {
    size: blob.size,
    read: async (at, length) =>
      new Uint8Array(await blob.slice(at, at + length).arrayBuffer()),
  };
}

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CDH_SIG = 0x02014b50;
const EOCD_MIN = 22;
const ZIP64_LOCATOR_SIZE = 20;
const MAX_COMMENT = 0xffff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const UTF8_FLAG = 0x800;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 64-bit little-endian as a number; exact below 2^53. */
function u64(dv: DataView, at: number): number {
  return dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 2 ** 32;
}

/** Same decoding as fflate's unzip: UTF-8 when flagged, else Latin-1. */
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  return new TextDecoder(utf8 ? 'utf-8' : 'latin1').decode(bytes);
}

interface Directory {
  offset: number;
  size: number;
  entries: number;
}

async function findDirectory(src: ZipByteReader): Promise<Directory> {
  const tailLength = Math.min(src.size, EOCD_MIN + MAX_COMMENT);
  const tailStart = src.size - tailLength;
  const tail = await src.read(tailStart, tailLength);
  const dv = view(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('[ZipIndex] no end of central directory record');
  }
  const dir: Directory = {
    entries: dv.getUint16(eocd + 10, true),
    size: dv.getUint32(eocd + 12, true),
    offset: dv.getUint32(eocd + 16, true),
  };
  const zip64 =
    dir.entries === U16_MAX || dir.size === U32_MAX || dir.offset === U32_MAX;
  const locator = eocd - ZIP64_LOCATOR_SIZE;
  if (
    !zip64 ||
    locator < 0 ||
    dv.getUint32(locator, true) !== ZIP64_LOCATOR_SIG
  ) {
    return dir;
  }
  const recordAt = u64(dv, locator + 8);
  const record = view(await src.read(recordAt, 56));
  if (record.getUint32(0, true) !== ZIP64_EOCD_SIG) {
    throw new Error('[ZipIndex] bad zip64 end of central directory record');
  }
  return {
    entries: u64(record, 32),
    size: u64(record, 40),
    offset: u64(record, 48),
  };
}

/** Every entry of the archive, in central directory order. */
export async function readZipIndex(
  source: ZipByteReader | Uint8Array | Blob
): Promise<ZipEntryInfo[]> {
  const src =
    source instanceof Uint8Array
      ? bytesReader(source)
      : source instanceof Blob
        ? blobReader(source)
        : source;
  const dir = await findDirectory(src);
  const bytes = await src.read(dir.offset, dir.size);
  if (bytes.length < dir.size) {
    throw new Error('[ZipIndex] central directory runs past the end');
  }
  const dv = view(bytes);
  const out: ZipEntryInfo[] = [];
  let at = 0;
  for (let n = 0; n < dir.entries; n++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== CDH_SIG) {
      throw new Error(`[ZipIndex] bad central directory header ${n}`);
    }
    const flags = dv.getUint16(at + 8, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    let compressedSize = dv.getUint32(at + 20, true);
    let uncompressedSize = dv.getUint32(at + 24, true);
    let localHeaderOffset = dv.getUint32(at + 42, true);
    const nameStart = at + 46;
    const name = decodeName(
      bytes.subarray(nameStart, nameStart + nameLength),
      (flags & UTF8_FLAG) !== 0
    );

    // The zip64 extra field holds, in this order, only the values whose
    // 32-bit slot is saturated.
    let extra = nameStart + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = dv.getUint16(extra, true);
      const length = dv.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (uncompressedSize === U32_MAX) {
          uncompressedSize = u64(dv, field);
          field += 8;
        }
        if (compressedSize === U32_MAX) {
          compressedSize = u64(dv, field);
          field += 8;
        }
        if (localHeaderOffset === U32_MAX) {
          localHeaderOffset = u64(dv, field);
        }
      }
      extra += 4 + length;
    }

    out.push({
      name,
      crc32: dv.getUint32(at + 16, true),
      compressedSize,
      uncompressedSize,
      method: dv.getUint16(at + 10, true),
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });
    at = extraEnd + commentLength;
  }
  return out;
}
