"""Wardrobe meshing for avatar v4 (Tripo v3).

    python3 scripts/tripo_wardrobe.py mesh <dir>      # dir has front.png left.png back.png (NOT a mirrored right.png: it pins the far
                                                      # arm but projects arm skin onto the chest)
    python3 scripts/tripo_wardrobe.py segment <dir>   # Tripo semantic segmentation of <dir>/dressed.glb

`mesh` uploads the A-pose views of the base body WEARING one garment and
runs multiview-to-model (face_limit 20000) -> <dir>/dressed.glb, task id in
<dir>/_mesh_task.txt. The garment is then cut out of dressed.glb against
the bare body (scripts/wardrobe_extract.html) — or, as a fallback, with
`segment` (40 cr) -> <dir>/segmented.glb.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tripo_v3 import call, upload, wait, download, balance  # noqa: E402

JSON_HDR = {"Content-Type": "application/json"}


def post(path, body):
    return call(path, data=json.dumps(body).encode(), headers=JSON_HDR)["data"]


def mesh(d):
    inputs = []
    for view in ("front", "left", "back", "right"):
        p = os.path.join(d, view + ".png")
        if os.path.exists(p):
            inputs.append({view: {"file_token": upload(p)}})
    if len(inputs) < 2:
        raise SystemExit("need front.png plus at least one more view")
    t = post("/generation/multiview-to-model", {
        # fixed seed: the views never show the far arm, and an unseeded run
        # resolves it differently per mesh (sleeve ends up 40 deg off the arm)
        "inputs": inputs, "model": "v3.1-20260211", "face_limit": 20000,
        "model_seed": 7,
        "texture": True, "pbr": False, "texture_quality": "standard",
        "texture_alignment": "original_image", "orientation": "align_image"})
    open(os.path.join(d, "_mesh_task.txt"), "w").write(t["task_id"])
    print("mesh task", t["task_id"], "views:", [list(i)[0] for i in inputs])
    download(wait(t["task_id"]), os.path.join(d, "dressed.glb"))
    print("saved dressed.glb")


def segment(d):
    tid = open(os.path.join(d, "_mesh_task.txt")).read().strip()
    t = post("/mesh/segment", {"input": tid, "model": "v2.0-20260430",
                               "segmentation_granularity": "simple",
                               "split_by_connectivity": False})
    print("segment task", t["task_id"])
    td = wait(t["task_id"])
    download(td, os.path.join(d, "segmented.glb"))
    print("saved segmented.glb | output keys:", list((td.get("output") or {}).keys()))


def main():
    a = sys.argv[1:]
    if len(a) != 2 or a[0] not in ("mesh", "segment"):
        raise SystemExit(__doc__)
    print("balance before:", balance())
    (mesh if a[0] == "mesh" else segment)(a[1])
    print("balance after:", balance())


if __name__ == "__main__":
    main()
