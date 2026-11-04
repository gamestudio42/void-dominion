#!/usr/bin/env python3
"""Verify a .glb/.gltf before it reaches the engine. Stdlib only.

Reads the container itself — not a render, not the exporter's log — and reports
triangles, materials, textures, node count, bounds and size, then writes or
merges manifest.json with the same shape the ArtCraft pipeline uses.

Usage:
    verify_glb.py <file.glb> --asset NAME [options]

    --max-tris N       fail above N triangles
    --max-bytes N      fail above N bytes
    --ground           fail when the lowest point is not at y = 0 (glTF is Y-up)
    --single-mesh      fail when the file holds more than one mesh node
    --no-textures      fail when the file embeds images
    --manifest FILE    manifest to write/merge (default: <dir>/manifest.json)
    --json             print the entry instead of a table

Exit: 0 pass/warn, 1 fail, 2 usage.
"""
import hashlib
import json
import os
import struct
import sys

MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def load(path):
    data = open(path, "rb").read()
    if len(data) < 12:
        raise SystemExit("not a GLB: file too short")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC:
        raise SystemExit("not a GLB: bad magic (only .glb is supported)")
    if version != 2:
        raise SystemExit(f"unsupported glTF version {version}")
    off, js, bin_bytes = 12, None, 0
    while off + 8 <= min(length, len(data)):
        clen, ctype = struct.unpack_from("<II", data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == CHUNK_JSON:
            js = json.loads(chunk)
        elif ctype == CHUNK_BIN:
            bin_bytes = clen
    if js is None:
        raise SystemExit("GLB has no JSON chunk")
    return js, bin_bytes, len(data)


def analyse(doc):
    accessors = doc.get("accessors") or []
    meshes = doc.get("meshes") or []
    tris = verts = prims = 0
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    for mesh in meshes:
        for prim in mesh.get("primitives") or []:
            prims += 1
            mode = prim.get("mode", 4)
            if "indices" in prim:
                count = accessors[prim["indices"]].get("count", 0)
                tris += count // 3
            else:
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is not None:
                    tris += max(0, accessors[pos].get("count", 0) // 3)
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is not None:
                acc = accessors[pos]
                verts += acc.get("count", 0)
                if "min" in acc and "max" in acc:
                    mins = [min(a, b) for a, b in zip(mins, acc["min"])]
                    maxs = [max(a, b) for a, b in zip(maxs, acc["max"])]
            if mode != 4:
                # triangle strip/fan are valid glTF but cost a conversion in most engines
                pass
    bbox = None
    if mins[0] != float("inf"):
        bbox = {"min": [round(v, 4) for v in mins], "max": [round(v, 4) for v in maxs],
                "dims": [round(b - a, 4) for a, b in zip(mins, maxs)]}
    materials = []
    for m in doc.get("materials") or []:
        pbr = m.get("pbrMetallicRoughness") or {}
        materials.append({
            "name": m.get("name"),
            "baseColor": [round(c, 3) for c in pbr.get("baseColorFactor", [1, 1, 1, 1])],
            "metallic": pbr.get("metallicFactor"),
            "roughness": pbr.get("roughnessFactor"),
            "emissive": m.get("emissiveFactor"),
            "hasTexture": any(k in pbr for k in ("baseColorTexture", "metallicRoughnessTexture")),
        })
    nodes_with_mesh = [n.get("name") for n in (doc.get("nodes") or []) if "mesh" in n]
    return {
        "generator": (doc.get("asset") or {}).get("generator"),
        "version": (doc.get("asset") or {}).get("version"),
        "triangles": tris,
        "vertices": verts,
        "primitives": prims,
        "meshes": len(meshes),
        "meshNodes": nodes_with_mesh,
        "nodes": len(doc.get("nodes") or []),
        "materials": materials,
        "images": len(doc.get("images") or []),
        "textures": len(doc.get("textures") or []),
        "animations": len(doc.get("animations") or []),
        "skins": len(doc.get("skins") or []),
        "bbox": bbox,
    }


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    target, args = args[0], args[1:]
    opts = {"asset": None, "max_tris": None, "max_bytes": None, "ground": False,
            "single_mesh": False, "no_textures": False, "manifest": None, "json": False}
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--asset":
            opts["asset"] = args[i + 1]; i += 2
        elif a == "--max-tris":
            opts["max_tris"] = int(args[i + 1]); i += 2
        elif a == "--max-bytes":
            opts["max_bytes"] = int(args[i + 1]); i += 2
        elif a == "--manifest":
            opts["manifest"] = args[i + 1]; i += 2
        elif a == "--ground":
            opts["ground"] = True; i += 1
        elif a == "--single-mesh":
            opts["single_mesh"] = True; i += 1
        elif a == "--no-textures":
            opts["no_textures"] = True; i += 1
        elif a == "--json":
            opts["json"] = True; i += 1
        else:
            print(f"verify_glb: unknown option {a}", file=sys.stderr)
            return 2
    if not opts["asset"]:
        print("verify_glb: missing --asset NAME", file=sys.stderr)
        return 2

    doc, bin_bytes, total = load(target)
    a = analyse(doc)
    fail, warn = [], []
    size = os.path.getsize(target)

    if opts["max_tris"] and a["triangles"] > opts["max_tris"]:
        fail.append(f"{a['triangles']} triangles over the {opts['max_tris']} budget")
    if opts["max_bytes"] and size > opts["max_bytes"]:
        fail.append(f"{size} bytes over the {opts['max_bytes']} limit")
    if a["triangles"] == 0:
        fail.append("no triangles in the file")
    if opts["single_mesh"] and len(a["meshNodes"]) > 1:
        fail.append(f"{len(a['meshNodes'])} mesh nodes, expected 1 ({', '.join(filter(None, a['meshNodes']))})")
    if opts["no_textures"] and a["images"]:
        fail.append(f"{a['images']} embedded images; low-poly assets should stay untextured")
    if opts["ground"] and a["bbox"]:
        low = a["bbox"]["min"][1]
        if abs(low) > 0.005:
            fail.append(f"lowest point at y={low}, expected 0 (glTF is Y-up)")
    if a["bbox"]:
        longest = max(a["bbox"]["dims"])
        if longest > 50 or longest < 0.05:
            warn.append(f"longest side {longest} looks off for a unit-scale asset")
    if not a["materials"]:
        warn.append("no materials: the mesh will render with the engine default")
    if a["animations"]:
        warn.append(f"{a['animations']} animation(s) exported; confirm the engine imports them")

    verdict = "fail" if fail else ("warn" if warn else "pass")
    entry = {
        "asset": opts["asset"],
        "export": {"path": os.path.abspath(target), "kind": "glb", "codec": "gltf",
                   "bytes": size, "sha256": sha256(target), "bin_chunk_bytes": bin_bytes},
        "mesh": a,
        "verdict": verdict,
        "issues": fail + warn,
    }

    manifest_path = opts["manifest"] or os.path.join(os.path.dirname(os.path.abspath(target)), "manifest.json")
    manifest = {"asset": opts["asset"], "tool": {}, "exports": [], "verdict": "pass"}
    if os.path.exists(manifest_path):
        try:
            manifest = json.load(open(manifest_path))
        except json.JSONDecodeError:
            pass
    manifest.setdefault("exports", [])
    manifest["asset"] = opts["asset"]
    manifest["tool"] = {"name": "blender", "version": os.environ.get("BLENDER_VERSION") or None}
    import datetime
    manifest["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    key = entry["export"]["path"]
    manifest["exports"] = [e for e in manifest["exports"] if (e.get("export") or {}).get("path") != key]
    manifest["exports"].append(entry)
    verdicts = [e.get("verdict", "fail") for e in manifest["exports"]]
    manifest["verdict"] = "fail" if "fail" in verdicts else ("warn" if "warn" in verdicts else "pass")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    if opts["json"]:
        print(json.dumps(entry, indent=2))
    else:
        print(f"asset      {opts['asset']}")
        print(f"export     glb {size}B  sha256 {entry['export']['sha256'][:12]}…")
        print(f"mesh       {a['triangles']} tris / {a['vertices']} verts / {a['primitives']} primitive(s) "
              f"/ {len(a['meshNodes'])} mesh node(s)")
        print(f"materials  {len(a['materials'])}" + (f" ({', '.join(m['name'] or '?' for m in a['materials'])})" if a['materials'] else ""))
        if a["bbox"]:
            print(f"bounds     dims {a['bbox']['dims']}  min {a['bbox']['min']}")
        print(f"images     {a['images']}  animations {a['animations']}  generator {a['generator']}")
        print(f"verdict    {verdict}")
        for issue in fail + warn:
            print(f"  - {issue}")
        print(f"manifest   {manifest_path}")
    return 0 if verdict != "fail" else 1


sys.exit(main())
