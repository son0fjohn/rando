"""Tripo v3 rig + retarget for an existing GLB (same path that produced
web/avatar3/body.glb + anims/).

    python3 scripts/tripo_rig.py in.glb out_dir [--yaw DEG] [--anims idle,walk]
                                   [--rig-model v2.5-20260210|v1.0-20240301]

Steps: optional yaw fix (rotates the VERTEX DATA so the character faces +Z —
Tripo's rigger ignores node transforms) -> POST /files ->
POST /animations/rig-check (free) -> POST /animations/rig (biped, tripo
bone naming, 25 cr) -> POST /animations/retarget per clip (10 cr each,
animate_in_place — the fix that stopped folded-leg / drifting retargets
last time). Output: out_dir/body_rigged.glb + out_dir/<clip>.glb.
"""
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tripo_v3 import call, upload, wait, download, balance  # noqa: E402

JSON_HDR = {"Content-Type": "application/json"}


def yaw_glb(src, dst, deg):
    """Rotate the mesh `deg` about +Y IN THE VERTEX DATA (positions, normals,
    tangents) and clear node transforms. Tripo's rigger reads raw vertices and
    ignores node rotations — a node-level yaw rigs the character sideways
    (legs swing out to the side)."""
    d = open(src, "rb").read()
    assert d[:4] == b"glTF"
    jlen, = struct.unpack("<I", d[12:16])
    js = json.loads(d[20:20 + jlen])
    boff = 20 + jlen + 8
    blen, = struct.unpack("<I", d[20 + jlen:24 + jlen])
    bin_ = bytearray(d[boff:boff + blen])
    # fold any existing single-root node yaw into the angle, then clear it
    total = math.radians(deg)
    for n in js["nodes"]:
        m = n.pop("matrix", None)
        if m:
            total += math.atan2(m[8], m[0])      # yaw of a pure-Y rotation matrix
        q = n.pop("rotation", None)
        if q:
            total += 2 * math.atan2(q[1], q[3])
    c, s_ = math.cos(total), math.sin(total)
    done = set()
    for mesh in js["meshes"]:
        for prim in mesh["primitives"]:
            for attr in ("POSITION", "NORMAL", "TANGENT"):
                ai = prim["attributes"].get(attr)
                if ai is None or ai in done:
                    continue
                done.add(ai)
                acc = js["accessors"][ai]
                bv = js["bufferViews"][acc["bufferView"]]
                ncomp = 4 if attr == "TANGENT" else 3
                stride = bv.get("byteStride") or 4 * ncomp
                off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
                xs, zs = [], []
                for i in range(acc["count"]):
                    o = off + i * stride
                    x, y, z = struct.unpack_from("<3f", bin_, o)
                    x2, z2 = x * c + z * s_, -x * s_ + z * c
                    struct.pack_into("<3f", bin_, o, x2, y, z2)
                    xs.append(x2); zs.append(z2)
                if attr == "POSITION":
                    acc["min"] = [min(xs), acc["min"][1], min(zs)]
                    acc["max"] = [max(xs), acc["max"][1], max(zs)]
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * (-len(jb) % 4)
    rest = struct.pack("<I", len(bin_)) + b"BIN\x00" + bytes(bin_)
    out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(jb) + len(rest)) \
        + struct.pack("<I", len(jb)) + b"JSON" + jb + rest
    open(dst, "wb").write(out)
    return dst


def post(path, body):
    return call(path, data=json.dumps(body).encode(), headers=JSON_HDR)["data"]


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        raise SystemExit(__doc__)
    src, out_dir = a[0], a[1]
    yaw = float(a[a.index("--yaw") + 1]) if "--yaw" in a else 0.0
    anims = (a[a.index("--anims") + 1] if "--anims" in a else "idle,walk").split(",")
    # v2.5 is the rigger that made web/avatar3 (tripo:: bone names); v1.0
    # mislocates chibi hips/knees -> legs kick out sideways on retarget
    rig_model = a[a.index("--rig-model") + 1] if "--rig-model" in a else "v2.5-20260210"
    os.makedirs(out_dir, exist_ok=True)
    print("balance before:", balance())

    if yaw:
        src = yaw_glb(src, os.path.join(out_dir, "_input_yawfixed.glb"), yaw)
        print(f"yaw {yaw:+.0f} deg baked -> {src}")
    tok = upload(src)
    print("uploaded ->", tok)

    chk = post("/animations/rig-check", {"input": tok})
    print("rig-check task", chk["task_id"])
    cd = wait(chk["task_id"], poll_s=4)
    print("rig-check output:", json.dumps(cd.get("output"))[:300])

    rig = post("/animations/rig", {"input": tok, "model": rig_model,
                                   "rig_type": "biped", "spec": "tripo",
                                   "out_format": "glb"})
    print("rig task", rig["task_id"])
    rd = wait(rig["task_id"])
    download(rd, os.path.join(out_dir, "body_rigged.glb"))
    print("saved body_rigged.glb")
    open(os.path.join(out_dir, "_rig_task.txt"), "w").write(rig["task_id"])

    for name in anims:
        t = post("/animations/retarget", {"input": rig["task_id"],
                                          "animation": f"preset:{name}",
                                          "out_format": "glb",
                                          "bake_animation": True,
                                          "export_with_geometry": True,
                                          "animate_in_place": True})
        print(f"retarget {name} task", t["task_id"])
        td = wait(t["task_id"])
        download(td, os.path.join(out_dir, f"{name}.glb"))
        print(f"saved {name}.glb")
    print("balance after:", balance())


if __name__ == "__main__":
    main()
