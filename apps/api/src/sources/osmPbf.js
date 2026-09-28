/**
 * A streaming reader for OpenStreetMap's .osm.pbf format.
 *
 * The local extract (back-office handover 5.3: "The local OSM extract
 * replaces live Overpass") is a Geofabrik download read here one block at a
 * time, so a national file never has to be in memory. The format is a
 * sequence of length-prefixed blobs, each a zlib-compressed protobuf block of
 * nodes, ways and relations (https://wiki.openstreetmap.org/wiki/PBF_Format).
 *
 * Only what the loader needs is decoded: ids, tags, node coordinates, way
 * node references and relation members. Metadata (users, timestamps,
 * versions) is skipped.
 */

import { open } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import Pbf from 'pbf';

/** Every blob in the file: `{ type, data }`, data decompressed. */
async function* blobs(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    let pos = 0;
    const lenBuf = Buffer.alloc(4);
    while (pos < size) {
      await fh.read(lenBuf, 0, 4, pos);
      const headerLen = lenBuf.readUInt32BE(0);
      pos += 4;
      const headerBuf = Buffer.alloc(headerLen);
      await fh.read(headerBuf, 0, headerLen, pos);
      pos += headerLen;
      const header = new Pbf(headerBuf).readFields((tag, h, p) => {
        if (tag === 1) h.type = p.readString();
        else if (tag === 3) h.datasize = p.readVarint();
      }, { type: null, datasize: 0 });
      const blobBuf = Buffer.alloc(header.datasize);
      await fh.read(blobBuf, 0, header.datasize, pos);
      pos += header.datasize;
      const blob = new Pbf(blobBuf).readFields((tag, b, p) => {
        if (tag === 1) b.raw = p.readBytes();
        else if (tag === 2) b.rawSize = p.readVarint();
        else if (tag === 3) b.zlib = p.readBytes();
      }, { raw: null, rawSize: 0, zlib: null });
      const data = blob.raw ?? (blob.zlib ? inflateSync(blob.zlib) : null);
      if (!data) throw new Error(`osm pbf: a ${header.type} blob in a compression this reader does not know`);
      yield { type: header.type, data };
    }
  } finally {
    await fh.close();
  }
}

/** Decode one PrimitiveBlock into its entities, calling `on` for each. */
function block(data, on, want) {
  const pb = new Pbf(data);
  const blk = { strings: [], groups: [], granularity: 100, latOffset: 0, lonOffset: 0 };
  pb.readFields((tag, b, p) => {
    if (tag === 1) {
      const end = p.readVarint() + p.pos;
      while (p.pos < end) {
        const t = p.readVarint();
        if ((t >> 3) === 1) b.strings.push(Buffer.from(p.readBytes()).toString('utf8'));
        else p.skip(t);
      }
    } else if (tag === 2) b.groups.push(p.readBytes());
    else if (tag === 17) b.granularity = p.readVarint();
    else if (tag === 19) b.latOffset = p.readVarint(true);
    else if (tag === 20) b.lonOffset = p.readVarint(true);
  }, blk);
  const s = blk.strings;
  const lat = (v) => 1e-9 * (blk.latOffset + blk.granularity * v);
  const lon = (v) => 1e-9 * (blk.lonOffset + blk.granularity * v);
  const tagsOf = (keys, vals) => {
    const t = {};
    for (let i = 0; i < keys.length; i++) t[s[keys[i]]] = s[vals[i]];
    return t;
  };

  for (const g of blk.groups) {
    const gp = new Pbf(g);
    gp.readFields((tag, _, p) => {
      if (tag === 2 && want.node) {
        // DenseNodes: delta-coded ids and coordinates, tags in one flat list.
        const d = new Pbf(p.readBytes());
        const ids = []; const lats = []; const lons = []; const kv = [];
        d.readFields((t, __, q) => {
          if (t === 1) q.readPackedSVarint(ids);
          else if (t === 8) q.readPackedSVarint(lats);
          else if (t === 9) q.readPackedSVarint(lons);
          else if (t === 10) q.readPackedVarint(kv);
        }, null);
        let id = 0; let la = 0; let lo = 0; let k = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; la += lats[i]; lo += lons[i];
          let tags = null;
          while (k < kv.length && kv[k] !== 0) {
            tags ??= {};
            tags[s[kv[k]]] = s[kv[k + 1]];
            k += 2;
          }
          k += 1;
          on({ type: 'node', id, lat: lat(la), lon: lon(lo), tags: tags ?? {} });
        }
      } else if (tag === 1 && want.node) {
        const n = new Pbf(p.readBytes()).readFields((t, o, q) => {
          if (t === 1) o.id = q.readSVarint();
          else if (t === 2) q.readPackedVarint(o.keys);
          else if (t === 3) q.readPackedVarint(o.vals);
          else if (t === 8) o.lat = q.readSVarint();
          else if (t === 9) o.lon = q.readSVarint();
        }, { id: 0, keys: [], vals: [], lat: 0, lon: 0 });
        on({ type: 'node', id: n.id, lat: lat(n.lat), lon: lon(n.lon), tags: tagsOf(n.keys, n.vals) });
      } else if (tag === 3 && want.way) {
        const w = new Pbf(p.readBytes()).readFields((t, o, q) => {
          if (t === 1) o.id = q.readVarint(true);
          else if (t === 2) q.readPackedVarint(o.keys);
          else if (t === 3) q.readPackedVarint(o.vals);
          else if (t === 8) q.readPackedSVarint(o.refs);
        }, { id: 0, keys: [], vals: [], refs: [] });
        let r = 0;
        const refs = w.refs.map((x) => (r += x));
        on({ type: 'way', id: w.id, tags: tagsOf(w.keys, w.vals), refs });
      } else if (tag === 4 && want.relation) {
        const rel = new Pbf(p.readBytes()).readFields((t, o, q) => {
          if (t === 1) o.id = q.readVarint(true);
          else if (t === 2) q.readPackedVarint(o.keys);
          else if (t === 3) q.readPackedVarint(o.vals);
          else if (t === 9) q.readPackedSVarint(o.memids);
          else if (t === 10) q.readPackedVarint(o.types);
        }, { id: 0, keys: [], vals: [], memids: [], types: [] });
        let m = 0;
        const members = rel.memids.map((x, i) => ({ id: (m += x), type: ['node', 'way', 'relation'][rel.types[i]] ?? 'node' }));
        on({ type: 'relation', id: rel.id, tags: tagsOf(rel.keys, rel.vals), members });
      }
      // Anything not read here is skipped by Pbf itself (readFields skips a
      // field the callback did not consume).
    }, null);
  }
}

/**
 * Read every entity in the file, calling `on(entity)`. `want` limits what is
 * decoded ({ node, way, relation }), which is most of the cost of a pass.
 * Yields to the event loop between blocks so a load never starves the API.
 */
export async function readPbf(path, on, want = { node: true, way: true, relation: true }) {
  let blocks = 0;
  for await (const b of blobs(path)) {
    if (b.type !== 'OSMData') continue;
    block(b.data, on, want);
    blocks += 1;
    if (blocks % 20 === 0) await new Promise((r) => setImmediate(r));
  }
  return blocks;
}
