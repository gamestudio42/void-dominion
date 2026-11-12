#!/usr/bin/env python3
"""Bake a Blockbench free-model hull into one textured glTF binary.

The studio ship kit stores mesh vertices relative to each element's origin.
This flattens those pieces, centres the craft on the ground, and embeds the
atlas, the ORM map and the glow map. Turret pivots stay baked at rest: the
match does not animate sub-meshes.

Usage:
    export_bbmodel.py --model hull.bbmodel --atlas a.png --orm o.png --glow g.png \
        --out out.glb --length 1.6
"""

import json
import math
import struct
import sys
from pathlib import Path


def euler(rotation, point):
    """Three.js XYZ euler, degrees, applied to a vertex around the origin."""
    ax, ay, az = (math.radians(v) for v in rotation)
    x, y, z = point
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    cz, sz = math.cos(az), math.sin(az)
    y, z = y * cx - z * sx, y * sx + z * cx
    x, z = x * cy + z * sy, -x * sy + z * cy
    x, y = x * cz - y * sz, x * sz + y * cz
    return (x, y, z)


def world_vertices(model):
    """Return (positions, hull_tris, glow_tris) in Blockbench space."""
    textures = {int(tex["id"]): tex for tex in model["textures"]}
    glow_ids = {int(tex["id"]) for tex in model["textures"] if "glow" in tex["name"]}
    positions = []
    hull, glow = [], []
    for element in model["elements"]:
        if element.get("type") != "mesh":
            continue
        origin = element.get("origin") or [0, 0, 0]
        rotation = element.get("rotation") or [0, 0, 0]
        local = {}
        for key, vertex in element["vertices"].items():
            x, y, z = euler(rotation, vertex)
            local[key] = (x + origin[0], y + origin[1], z + origin[2])
        for face in element["faces"].values():
            ids = face["vertices"]
            if len(ids) != 4:
                continue
            tex = face.get("texture")
            if tex not in textures:
                continue
            image = textures[tex]
            width = image["width"]
            height = image["height"]
            corners = []
            for vid in ids:
                px, py = face["uv"][vid]
                corners.append((local[vid], (px / width, py / height)))
            target = glow if tex in glow_ids else hull
            target.append((corners[0], corners[1], corners[2]))
            target.append((corners[0], corners[2], corners[3]))
            positions.extend(corner[0] for corner in corners)
    return positions, hull, glow


def normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    return (nx / length, ny / length, nz / length)


def orient(tris):
    """Blockbench quads are not a guaranteed winding. The highest face must point up."""
    if not tris:
        return tris
    top = max(tris, key=lambda tri: sum(corner[0][1] for corner in tri) / 3)
    points = [corner[0] for corner in top]
    if normal(*points)[1] >= 0:
        return tris
    return [tuple(reversed(tri)) for tri in tris]


def fit(tris, length):
    """Drop the keel on y=0, centre x/z, and make the longest side `length`."""
    points = [corner[0] for tri in tris for corner in tri]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    cx = (min(xs) + max(xs)) / 2
    cz = (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    scale = length / span

    def place(point):
        return ((point[0] - cx) * scale, (point[1] - min(ys)) * scale, (point[2] - cz) * scale)

    return [[(place(corner[0]), corner[1]) for corner in tri] for tri in tris]


def flatten(tris):
    positions, normals, uvs, indices = [], [], [], []
    for tri in tris:
        start = len(positions)
        points = [corner[0] for corner in tri]
        face = normal(*points)
        for corner in tri:
            positions.append(corner[0])
            normals.append(face)
            uvs.append(corner[1])
        indices.extend((start, start + 1, start + 2))
    return positions, normals, uvs, indices


def pad(blob):
    return blob + b"\x00" * ((4 - len(blob) % 4) % 4)


def pack_mesh(name, positions, normals, uvs, indices):
    pos = b"".join(struct.pack("<3f", *p) for p in positions)
    nrm = b"".join(struct.pack("<3f", *n) for n in normals)
    uv = b"".join(struct.pack("<2f", *t) for t in uvs)
    idx = b"".join(struct.pack("<H", i) for i in indices)
    chunks = [pad(pos), pad(nrm), pad(uv), pad(idx)]
    return {
        "name": name,
        "chunks": chunks,
        "count": len(positions),
        "index_count": len(indices),
        "min": [min(p[i] for p in positions) for i in range(3)],
        "max": [max(p[i] for p in positions) for i in range(3)],
    }


def glb(hull, glow, images):
    """images is a list of (png bytes,). Materials: 0 hull (atlas+orm), 1 glow."""
    blobs = []
    views = []
    accessors = []

    def add_blob(data):
        offset = sum(len(blob) for blob in blobs)
        blobs.append(data)
        view = len(views)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data.rstrip(b"\x00")) if False else len(data)})
        # byteLength must cover the real bytes; padding may be included.
        views[-1]["byteLength"] = len(data)
        return view

    def add_vec(mesh_part, key, kind, size):
        view = add_blob(mesh_part["chunks"][{"pos": 0, "nrm": 1, "uv": 2, "idx": 3}[key]])
        acc = {
            "bufferView": view,
            "componentType": 5123 if key == "idx" else 5126,
            "count": mesh_part["index_count"] if key == "idx" else mesh_part["count"],
            "type": kind,
        }
        if key == "pos":
            acc["min"] = [round(v, 5) for v in mesh_part["min"]]
            acc["max"] = [round(v, 5) for v in mesh_part["max"]]
        accessors.append(acc)
        return len(accessors) - 1

    primitives = []
    for material, part in ((0, hull), (1, glow)):
        if part["count"] == 0:
            continue
        pos = add_vec(part, "pos", "VEC3", 12)
        nrm = add_vec(part, "nrm", "VEC3", 12)
        uv0 = add_vec(part, "uv", "VEC2", 8)
        uv1 = add_vec(part, "uv", "VEC2", 8)
        idx = add_vec(part, "idx", "SCALAR", 2)
        primitives.append({
            "attributes": {"POSITION": pos, "NORMAL": nrm, "TEXCOORD_0": uv0, "TEXCOORD_1": uv1},
            "indices": idx,
            "material": material,
        })

    image_views = []
    for png in images:
        image_views.append(add_blob(pad(png)))

    buffer = b"".join(blobs)
    doc = {
        "asset": {"version": "2.0", "generator": "export_bbmodel.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "interceptor", "mesh": 0}],
        "meshes": [{"name": "interceptor", "primitives": primitives}],
        "materials": [
            {
                "name": "hull",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1, 1, 1, 1],
                    "metallicFactor": 1,
                    "roughnessFactor": 1,
                    "baseColorTexture": {"index": 0},
                    "metallicRoughnessTexture": {"index": 1},
                },
                "occlusionTexture": {"index": 1, "texCoord": 1},
                "emissiveFactor": [0, 0, 0],
            },
            {
                "name": "glow",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0, 0, 0, 1],
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "emissiveFactor": [1, 1, 1],
                "emissiveTexture": {"index": 2},
            },
        ],
        "textures": [{"sampler": 0, "source": 0}, {"sampler": 0, "source": 1}, {"sampler": 0, "source": 2}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "images": [
            {"mimeType": "image/png", "bufferView": view} for view in image_views
        ],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(buffer)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    blob = pad(buffer)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack("<II", len(js), 0x4E4F534A)
    out += js
    out += struct.pack("<II", len(blob), 0x004E4942)
    out += blob
    # Fix the length field now that we know it. It was written with the right value already.
    return bytes(out)


def main():
    args = sys.argv[1:]
    opts = {"length": 1.6}
    i = 0
    while i < len(args):
        key = args[i][2:].replace("-", "_")
        opts[key] = args[i + 1]
        i += 2
    model = json.loads(Path(opts["model"]).read_text())
    _, hull_tris, glow_tris = world_vertices(model)
    fitted = fit(orient(hull_tris + glow_tris), float(opts["length"]))
    # Split back by original order: hull tris first, then glow.
    hull_n = len(hull_tris)
    hull_fit, glow_fit = fitted[:hull_n], fitted[hull_n:]
    hull = pack_mesh("hull", *flatten(hull_fit))
    glow = pack_mesh("glow", *flatten(glow_fit)) if glow_fit else pack_mesh("glow", [], [], [], [])
    images = [Path(opts[name]).read_bytes() for name in ("atlas", "orm", "glow")]
    Path(opts["out"]).write_bytes(glb(hull, glow, images))
    print(f"wrote {opts['out']} hull {hull['index_count'] // 3} tris glow {glow['index_count'] // 3} tris")


if __name__ == "__main__":
    main()
