// Mapbox Vector Tiles (MVT v2, protobuf), decoded: just enough of the spec
// for the city's global fallback (cityomt.js): layers, features, their
// properties and geometry in tile coordinates. No dependencies, no DOM, so
// it runs in the chunk worker and in node tests.
//
//   decodeMVT(bytes) -> { [layer]: { extent, features: [{ id, type, props, geom }] } }
//   type: 1 point, 2 line, 3 polygon. geom: an array of rings / lines /
//   points, each an array of [x, y] in the layer's extent (y down).
//   Polygons keep the spec's winding: an outer ring has a positive area
//   (ringArea > 0), holes a negative one.

class Pbf {
  constructor(buf) { this.b = buf; this.p = 0; }
  varint() {
    let v = 0, s = 0, b;
    do {
      b = this.b[this.p++];
      if (s < 28) v |= (b & 0x7f) << s; else v += (b & 0x7f) * 2 ** s;
      s += 7;
    } while (b >= 0x80);
    return v;
  }
  svarint() { const v = this.varint(); return v % 2 === 1 ? -(v + 1) / 2 : v / 2; }
  bytes() { const n = this.varint(), s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  string() { return new TextDecoder().decode(this.bytes()); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) { const n = this.varint(); this.p += n; }
    else if (wire === 5) this.p += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
  // where a length-prefixed field ends (read the length first: `this.p +
  // this.varint()` would add it to where the length started)
  end() { const n = this.varint(); return this.p + n; }
  // fields of a message, until `end`
  *fields(end = this.b.length) {
    while (this.p < end) {
      const tag = this.varint();
      yield [tag >> 3, tag & 7];
    }
  }
  packed() {
    const end = this.end(), out = [];
    while (this.p < end) out.push(this.varint());
    return out;
  }
}

function value(pb) {
  const end = pb.end();
  let v = null;
  for (const [f, w] of pb.fields(end)) {
    if (f === 1) v = pb.string();
    else if (f === 2) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 4).getFloat32(0, true); pb.p += 4; }
    else if (f === 3) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 8).getFloat64(0, true); pb.p += 8; }
    else if (f === 4 || f === 5) v = pb.varint();
    else if (f === 6) v = pb.svarint();
    else if (f === 7) v = !!pb.varint();
    else pb.skip(w);
  }
  return v;
}

// the command stream -> rings / lines / points
function geometry(cmds, type) {
  const out = [];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < n; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        if (id === 1) { cur = [[x, y]]; out.push(cur); }
        else cur.push([x, y]);
      }
    } else if (id === 7) {
      if (cur && type === 3 && cur.length) cur.push([cur[0][0], cur[0][1]]);
    }
  }
  return type === 1 ? out.map(p => p[0]) : out;
}

function feature(pb, keys, vals) {
  const end = pb.end();
  const f = { id: null, type: 0, props: {}, geom: null };
  let tags = [], cmds = [];
  for (const [n, w] of pb.fields(end)) {
    if (n === 1) f.id = pb.varint();
    else if (n === 2) tags = pb.packed();
    else if (n === 3) f.type = pb.varint();
    else if (n === 4) cmds = pb.packed();
    else pb.skip(w);
  }
  for (let k = 0; k + 1 < tags.length; k += 2) f.props[keys[tags[k]]] = vals[tags[k + 1]];
  f.geom = geometry(cmds, f.type);
  return f;
}

export function decodeMVT(bytes) {
  const pb = new Pbf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const layers = {};
  for (const [n, w] of pb.fields()) {
    if (n !== 3) { pb.skip(w); continue; }
    const end = pb.end();
    let name = "", extent = 4096;
    const keys = [], vals = [], raw = [];
    for (const [m, w2] of pb.fields(end)) {
      if (m === 1) name = pb.string();
      else if (m === 2) { raw.push(pb.p); pb.skip(2); }
      else if (m === 3) keys.push(pb.string());
      else if (m === 4) vals.push(value(pb));
      else if (m === 5) extent = pb.varint();
      else pb.skip(w2);
    }
    // features last: their tags point into keys / values
    const features = [];
    const save = pb.p;
    for (const at of raw) { pb.p = at; features.push(feature(pb, keys, vals)); }
    pb.p = save;
    layers[name] = { extent, features };
  }
  return layers;
}

// shoelace area of a ring of [x, y] (positive: the MVT outer winding, y down)
export function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; }
  return a / 2;
}
