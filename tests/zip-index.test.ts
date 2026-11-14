import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';

import { readZipIndex } from '../src/util/zip-index';

const STOPS = 'stop_id,stop_name\n1,Gare\n';

// Python zipfile with force_zip64: stops.txt deflated (zip64 sizes), dir/
// (zip64 offset), trips.txt stored (zip64 sizes and offset), plus a zip64
// end of central directory record and locator.
const ZIP64 = Buffer.from(
  'UEsDBC0AAAAIAAAAIQAsqPyZ//////////8JABQAc3RvcHMudHh0AQAQABkAAAAAAAAAGAAAAAAAAAArLskviM9M0SkG0XmJualchjruiUWpXABQSwMELQAAAAAAAAAhAAAAAAD//////////wQAFABkaXIvAQAQAAAAAAAAAAAAAAAAAAAAAABQSwMELQAAAAAAAAAhAFK7SQf//////////wkAFAB0cmlwcy50eHQBABAACwAAAAAAAAALAAAAAAAAAHRyaXBfaWQKdDEKUEsBAi0DLQAAAAgAAAAhACyo/Jn//////////wkAFAAAAAAAAAAAAIABAAAAAHN0b3BzLnR4dAEAEAAZAAAAAAAAABgAAAAAAAAAUEsBAi0DLQAAAAAAAAAhAAAAAAAAAAAAAAAAAAQADAAAAAAAAAAAAIAB/////2Rpci8BAAgAUwAAAAAAAABQSwECLQMtAAAAAAAAACEAUrtJB///////////CQAcAAAAAAAAAAAAgAH/////dHJpcHMudHh0AQAYAAsAAAAAAAAACwAAAAAAAACJAAAAAAAAAFBLBgYsAAAAAAAAAC0ALQAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAADcAAAAAAAAAM8AAAAAAAAAUEsGBwAAAACrAQAAAAAAAAEAAABQSwUGAAAAAAMAAwDcAAAAzwAAAAAA',
  'base64'
);

const ZIP64_ENTRIES = [
  ['stops.txt', 0x99fca82c, 24, 25, 8, 0, false],
  ['dir/', 0, 0, 0, 0, 0x53, true],
  ['trips.txt', 0x0749bb52, 11, 11, 0, 0x89, false],
] as const;

function plain(entries: Awaited<ReturnType<typeof readZipIndex>>) {
  return entries.map((e) => [
    e.name,
    e.crc32,
    e.compressedSize,
    e.uncompressedSize,
    e.method,
    e.localHeaderOffset,
    e.isDirectory,
  ]);
}

describe('readZipIndex', () => {
  it('reads names, CRC32 and sizes of an fflate zip', async () => {
    const bytes = zipSync({
      'stops.txt': strToU8(STOPS),
      'routes.txt': [strToU8(''), { level: 0 }],
    });
    const entries = await readZipIndex(bytes);
    assert.deepEqual(
      entries.map((e) => [e.name, e.uncompressedSize, e.method]),
      [
        ['stops.txt', STOPS.length, 8],
        ['routes.txt', 0, 0],
      ]
    );
    assert.equal(entries[0].crc32, 0x99fca82c);
  });

  it('reads zip64 extra fields', async () => {
    assert.deepEqual(plain(await readZipIndex(ZIP64)), ZIP64_ENTRIES);
  });

  it('follows the zip64 end record when the classic one is saturated', async () => {
    const bytes = new Uint8Array(ZIP64);
    const dv = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    dv.setUint16(eocd + 8, 0xffff, true);
    dv.setUint16(eocd + 10, 0xffff, true);
    dv.setUint32(eocd + 12, 0xffffffff, true);
    dv.setUint32(eocd + 16, 0xffffffff, true);
    assert.deepEqual(plain(await readZipIndex(bytes)), ZIP64_ENTRIES);
  });

  it('finds the end record behind an archive comment, from a Blob', async () => {
    const bytes = zipSync(
      { 'stops.txt': strToU8(STOPS) },
      { comment: 'x'.repeat(1000) }
    );
    const entries = await readZipIndex(new Blob([bytes]));
    assert.deepEqual(
      entries.map((e) => e.name),
      ['stops.txt']
    );
  });

  it('rejects bytes that are not a zip', async () => {
    await assert.rejects(readZipIndex(strToU8(STOPS)), /end of central/);
  });
});
