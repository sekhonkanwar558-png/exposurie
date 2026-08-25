// Reading a zip, with no dependencies.
//
// A claude.ai export arrives as a zip, and a zip is the only container in the
// whole product — so pulling in a package to open one would trade the entire
// zero-dependency property for a few hundred lines we can write ourselves.
// `node:zlib` already ships the hard half: DEFLATE.
//
// Two properties this has to have, and both are about honesty rather than
// features:
//
//   IT OPENS ONE ENTRY, NOT THE ARCHIVE. An export is one enormous
//   `conversations.json` next to a handful of small files. Walking the central
//   directory and inflating only what is asked for keeps a 16 MB read from
//   becoming a whole-archive decompression, and keeps memory proportional to
//   the thing we actually wanted.
//
//   IT NEVER GUESSES. A zip this reader cannot handle — an encrypted entry, a
//   compression method that is neither stored nor deflated, a truncated
//   download — fails by NAME, with a reason. The alternative is the failure
//   class this codebase keeps finding: a wrong answer wearing the shape of a
//   right one, here an export that reads as zero conversations while the tool
//   reports success.

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const LOC64_SIG = 0x07064b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/** A zip we could not read, said out loud rather than thrown as a stack trace. */
export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

function readAt(fd, length, position) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/**
 * Find the end-of-central-directory record.
 *
 * It sits at the end of the file, behind a comment field that may be up to
 * 64 KB long, so it is found by scanning backwards rather than by arithmetic.
 * A truncated download has no EOCD at all, which is the case worth naming: it
 * looks like a zip, it is the right size in a file listing, and every other
 * reader would call it corrupt without saying why.
 */
function findEocd(fd, size) {
  const span = Math.min(size, 65557); // 22-byte record + 65535-byte comment
  const buf = readAt(fd, span, size - span);
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return { buf, offset: i };
  }
  return null;
}

/**
 * Where the central directory starts, and how many entries it holds.
 *
 * Zip64 exists because the original format kept these in 32 bits. An export big
 * enough to need it is unlikely and not impossible, and the failure without it
 * is silent: the 32-bit fields read 0xFFFFFFFF, which is a plausible-looking
 * offset into nothing. So the locator is checked rather than assumed absent.
 */
function centralDirectory(fd, size) {
  const found = findEocd(fd, size);
  if (!found) {
    throw new ZipError(
      'no end-of-archive record — the file is not a zip, or the download was cut short',
    );
  }
  const { buf, offset } = found;

  let entries = buf.readUInt16LE(offset + 10);
  let cdSize = buf.readUInt32LE(offset + 12);
  let cdOffset = buf.readUInt32LE(offset + 16);

  // The zip64 locator sits immediately before the EOCD when the archive is big.
  const locAt = offset - 20;
  if (locAt >= 0 && buf.readUInt32LE(locAt) === LOC64_SIG) {
    const eocd64At = Number(buf.readBigUInt64LE(locAt + 8));
    const rec = readAt(fd, 56, eocd64At);
    if (rec.length === 56 && rec.readUInt32LE(0) === EOCD64_SIG) {
      entries = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
  }
  if (cdOffset + cdSize > size) {
    throw new ZipError('the archive index points past the end of the file — it is truncated');
  }
  return { entries, cdSize, cdOffset };
}

/** Pull 64-bit sizes out of an entry's extra field when the 32-bit ones overflowed. */
function zip64Extra(extra, need) {
  for (let p = 0; p + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      const out = {};
      let q = p + 4;
      for (const field of need) {
        if (q + 8 > p + 4 + len) break;
        out[field] = Number(extra.readBigUInt64LE(q));
        q += 8;
      }
      return out;
    }
    p += 4 + len;
  }
  return {};
}

/**
 * Open a zip and read its index. Nothing is decompressed here.
 *
 * Returns a handle with `names()` and `read(name)`. The caller closes it, and
 * `read` is where the only real work happens — one entry at a time.
 */
export function openZip(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch (e) {
    throw new ZipError(`could not be opened (${e.code || e.message})`);
  }
  if (size < 22) throw new ZipError('too small to be a zip');

  const fd = openSync(path, 'r');
  let index;
  try {
    const { entries, cdSize, cdOffset } = centralDirectory(fd, size);
    const cd = readAt(fd, cdSize, cdOffset);
    index = new Map();

    let p = 0;
    for (let i = 0; i < entries && p + 46 <= cd.length; i += 1) {
      if (cd.readUInt32LE(p) !== CD_SIG) break;
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressed = cd.readUInt32LE(p + 20);
      let uncompressed = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

      // 0xFFFFFFFF is the format's "look in the extra field" sentinel, in a
      // fixed order: uncompressed, compressed, then the local header offset.
      const need = [];
      if (uncompressed === 0xffffffff) need.push('uncompressed');
      if (compressed === 0xffffffff) need.push('compressed');
      if (localOffset === 0xffffffff) need.push('localOffset');
      if (need.length) {
        const big = zip64Extra(extra, need);
        if (big.uncompressed !== undefined) uncompressed = big.uncompressed;
        if (big.compressed !== undefined) compressed = big.compressed;
        if (big.localOffset !== undefined) localOffset = big.localOffset;
      }

      index.set(name, { name, flags, method, compressed, uncompressed, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch (e) {
    closeSync(fd);
    throw e instanceof ZipError ? e : new ZipError(`index unreadable (${e.message})`);
  }

  return {
    path,
    size,
    names: () => [...index.keys()],
    has: (name) => index.has(name),
    entry: (name) => index.get(name) || null,

    /** Inflate one entry to a string. The only place bytes are expanded. */
    read(name) {
      const e = index.get(name);
      if (!e) throw new ZipError(`the archive has no "${name}"`);
      // Bit 0 of the general-purpose flags is encryption. We cannot read it,
      // and must not let an empty result pass for an empty file.
      if (e.flags & 0x1) throw new ZipError(`"${name}" is encrypted`);
      if (e.method !== STORED && e.method !== DEFLATED) {
        throw new ZipError(`"${name}" uses compression method ${e.method}, which is not supported`);
      }

      // The central directory's name and extra lengths are not required to
      // match the local header's, so the data offset is computed from the
      // header actually sitting in front of the bytes.
      const head = readAt(fd, 30, e.localOffset);
      if (head.length !== 30 || head.readUInt32LE(0) !== LFH_SIG) {
        throw new ZipError(`"${name}" has no local header where the index says it does`);
      }
      const dataAt = e.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const raw = readAt(fd, e.compressed, dataAt);
      if (raw.length !== e.compressed) throw new ZipError(`"${name}" is truncated`);

      const out = e.method === DEFLATED ? inflateRawSync(raw) : raw;
      return out.toString('utf8');
    },

    close() {
      try {
        closeSync(fd);
      } catch {}
    },
  };
}

/** Read one entry and close, for the common single-shot case. */
export function readZipEntry(path, name) {
  const zip = openZip(path);
  try {
    return zip.read(name);
  } finally {
    zip.close();
  }
}
