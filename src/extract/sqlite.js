// Reading a SQLite database, with no dependencies.
//
// Cursor does not keep conversations in files. It keeps them in a SQLite
// key/value table inside `state.vscdb`, which means the choice was: take a
// dependency, shell out to a binary that may not exist, or read the format.
//
// The format is documented, stable, and older than most of the tools in this
// product. Reading it is a few hundred lines. Shelling out to `sqlite3` would
// have been fewer, and would have failed on every machine that does not have
// it — silently returning "this person has no Cursor history", which is the one
// failure mode this codebase refuses.
//
// THIS IS A READER AND ONLY A READER. It opens the file read-only, never
// writes, never locks, and understands exactly enough to walk one table:
//
//   - the 100-byte database header, for page size and encoding
//   - `sqlite_master` on page 1, to find a table's root page
//   - table b-trees, interior and leaf
//   - the record format: varints, serial types, and the column values
//   - overflow chains, because a JSON blob of a conversation does not fit in
//     one page and pretending it does yields truncated JSON that fails to
//     parse — which looks exactly like a corrupt database
//   - the write-ahead log, because Cursor is usually RUNNING. Its most recent
//     conversations live in `state.vscdb-wal` and not yet in the database
//     file, so a reader that ignores the WAL quietly returns yesterday's
//     history and nothing says so.
//
// It does not do indexes, joins, filters, or writes, and it should not learn.

import { openSync, readSync, closeSync, statSync, existsSync } from 'node:fs';

const INTERIOR_TABLE = 0x05;
const LEAF_TABLE = 0x0d;

export class SqliteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SqliteError';
  }
}

function read(fd, length, position) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/** SQLite's variable-length integer: up to 9 bytes, 7 bits each. */
function varint(buf, offset) {
  let value = 0n;
  let i = 0;
  for (; i < 8; i += 1) {
    const byte = buf[offset + i];
    if (byte === undefined) return [0, i + 1];
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return [Number(value), i + 1];
  }
  const last = buf[offset + 8] ?? 0;
  value = (value << 8n) | BigInt(last);
  return [Number(BigInt.asIntN(64, value)), 9];
}

/**
 * The write-ahead log, as a map of page number to its newest committed content.
 *
 * Frames after the last commit are not durable and must not be read: a
 * half-written transaction is not what the application would see.
 */
function readWal(path, pageSize) {
  const walPath = `${path}-wal`;
  if (!existsSync(walPath)) return new Map();

  let size = 0;
  try {
    size = statSync(walPath).size;
  } catch {
    return new Map();
  }
  if (size <= 32) return new Map();

  const fd = openSync(walPath, 'r');
  try {
    const header = read(fd, 32, 0);
    const magic = header.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) return new Map();
    if (header.readUInt32BE(8) !== pageSize) return new Map(); // a WAL for a different page size
    const salt1 = header.readUInt32BE(16);
    const salt2 = header.readUInt32BE(20);

    const frameSize = 24 + pageSize;
    const pages = new Map();
    let committed = new Map();

    for (let offset = 32; offset + frameSize <= size; offset += frameSize) {
      const fh = read(fd, 24, offset);
      if (fh.length !== 24) break;
      // Salts identify the current checkpoint generation. A frame carrying old
      // salts is a leftover from before a reset and is not part of this log.
      if (fh.readUInt32BE(8) !== salt1 || fh.readUInt32BE(12) !== salt2) break;

      const pageNo = fh.readUInt32BE(0);
      pages.set(pageNo, offset + 24);
      // A non-zero "database size after commit" marks a commit frame. Only
      // what precedes one has actually happened.
      if (fh.readUInt32BE(4) !== 0) committed = new Map(pages);
    }

    const out = new Map();
    for (const [pageNo, at] of committed) out.set(pageNo, read(fd, pageSize, at));
    return out;
  } catch {
    return new Map();
  } finally {
    try {
      closeSync(fd);
    } catch {}
  }
}

/**
 * Decode one record into its column values.
 *
 * Only the types this reader can meet in a key/value table are materialised:
 * integers, text and blobs. A float or a NULL comes back as-is rather than
 * throwing, because a reader that dies on an unexpected column is a reader that
 * dies on the next Cursor release.
 */
function decodeRecord(payload) {
  const [headerSize, headerLen] = varint(payload, 0);
  const types = [];
  let p = headerLen;
  while (p < headerSize) {
    const [t, len] = varint(payload, p);
    types.push(t);
    p += len;
  }

  const values = [];
  let body = headerSize;
  for (const t of types) {
    if (t === 0) {
      values.push(null);
    } else if (t >= 1 && t <= 6) {
      const width = [0, 1, 2, 3, 4, 6, 8][t];
      let n = 0;
      for (let i = 0; i < width; i += 1) n = n * 256 + payload[body + i];
      values.push(n);
      body += width;
    } else if (t === 7) {
      values.push(payload.readDoubleBE(body));
      body += 8;
    } else if (t === 8) {
      values.push(0);
    } else if (t === 9) {
      values.push(1);
    } else if (t >= 12 && t % 2 === 0) {
      const len = (t - 12) / 2;
      values.push(payload.subarray(body, body + len));
      body += len;
    } else if (t >= 13) {
      const len = (t - 13) / 2;
      values.push(payload.toString('utf8', body, body + len));
      body += len;
    } else {
      values.push(null);
    }
  }
  return values;
}

/** Open a database for reading. The caller closes it. */
export function openDb(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (e) {
    throw new SqliteError(`could not be opened (${e.code || e.message})`);
  }

  let pageSize;
  let usable;
  let wal;
  try {
    const header = read(fd, 100, 0);
    if (header.length !== 100 || header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw new SqliteError('not a SQLite database');
    }
    const raw = header.readUInt16BE(16);
    pageSize = raw === 1 ? 65536 : raw;
    usable = pageSize - header[20]; // reserved bytes per page
    wal = readWal(path, pageSize);
  } catch (e) {
    closeSync(fd);
    throw e instanceof SqliteError ? e : new SqliteError(e.message);
  }

  /** A page, preferring the write-ahead log's newer copy when there is one. */
  const page = (n) => wal.get(n) || read(fd, pageSize, (n - 1) * pageSize);

  /** Follow an overflow chain and return the whole payload. */
  function fullPayload(head, payloadSize, firstPage) {
    if (head.length >= payloadSize) return head.subarray(0, payloadSize);
    const parts = [head];
    let got = head.length;
    let next = firstPage;
    // A chain longer than the database is a loop; stop rather than hang.
    for (let guard = 0; next > 0 && got < payloadSize && guard < 100000; guard += 1) {
      const p = page(next);
      if (p.length < 4) break;
      next = p.readUInt32BE(0);
      const chunk = p.subarray(4, Math.min(4 + (payloadSize - got), usable));
      parts.push(chunk);
      got += chunk.length;
    }
    return Buffer.concat(parts, Math.min(got, payloadSize));
  }

  /** Walk a table b-tree, yielding decoded rows. */
  function* walk(pageNo, depth = 0) {
    if (depth > 64) return; // corrupt tree; do not recurse forever
    const p = page(pageNo);
    if (p.length === 0) return;

    // Page 1 carries the 100-byte file header before its b-tree header.
    const base = pageNo === 1 ? 100 : 0;
    const type = p[base];
    const cellCount = p.readUInt16BE(base + 3);
    const headerLen = type === INTERIOR_TABLE ? 12 : 8;
    const pointers = base + headerLen;

    if (type === INTERIOR_TABLE) {
      for (let i = 0; i < cellCount; i += 1) {
        const at = p.readUInt16BE(pointers + i * 2);
        yield* walk(p.readUInt32BE(at), depth + 1);
      }
      const rightmost = p.readUInt32BE(base + 8);
      if (rightmost) yield* walk(rightmost, depth + 1);
      return;
    }
    if (type !== LEAF_TABLE) return;

    for (let i = 0; i < cellCount; i += 1) {
      const at = p.readUInt16BE(pointers + i * 2);
      let q = at;
      const [payloadSize, a] = varint(p, q);
      q += a;
      const [, b] = varint(p, q); // rowid, unused here
      q += b;

      // How much of the payload lives on this page. Straight out of the file
      // format spec: getting this wrong truncates every large value, and
      // truncated JSON is indistinguishable from a corrupt database.
      const maxLocal = usable - 35;
      let local = payloadSize;
      let overflow = 0;
      if (payloadSize > maxLocal) {
        const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
        const k = minLocal + ((payloadSize - minLocal) % (usable - 4));
        local = k <= maxLocal ? k : minLocal;
        overflow = p.readUInt32BE(q + local);
      }

      const head = p.subarray(q, q + local);
      yield decodeRecord(fullPayload(head, payloadSize, overflow));
    }
  }

  return {
    path,

    /** Every row of one table, as arrays of column values. */
    rows(table) {
      let root = null;
      for (const r of walk(1)) {
        // sqlite_master: type, name, tbl_name, rootpage, sql
        if (r[0] === 'table' && r[1] === table) {
          root = r[3];
          break;
        }
      }
      if (!root) throw new SqliteError(`no table named "${table}"`);
      return [...walk(root)];
    },

    tables() {
      const out = [];
      for (const r of walk(1)) if (r[0] === 'table') out.push(r[1]);
      return out;
    },

    close() {
      try {
        closeSync(fd);
      } catch {}
    },
  };
}
