"""Build a low-poly mesh from a JSON spec and export it, headless.

Run:
    blender -b --factory-startup -P tools/asset-pipeline/blender/generate_lowpoly.py \
        -- --spec tools/asset-pipeline/blender/examples/scout_ship.json

The script never imports external art: every part is a primitive, so the result
is original and reproducible from the spec. Output goes to <out>/<name>.glb,
plus an optional turntable atlas under <out>/frames/.

Spec keys
    name        asset name, also the .glb basename
    out         output directory (overridable with --out)
    tri_budget  advisory; verify_glb.py enforces it
    unit_scale  longest bounding-box side after normalisation (metres)
    ground      true moves the mesh so its lowest point sits at z = 0
    palette     {key: {color:[r,g,b], rough, metal, emissive}}
    atlas       {frames, size, samples, elevation_deg} or null to skip renders
    parts       [{name, prim, mat, loc:[x,y,z], rot:[rx,ry,rz] degrees,
                  scale:[...], mirror, params:{...}}]

scale by primitive
    cube      full dimensions [x, y, z]
    cylinder  [radius_x, radius_y, height]
    cone      [radius_x, radius_y, height]
    ico/uv    [radius_x, radius_y, radius_z]
    torus     [radius_x, radius_y, radius_z] of the major ring

mirror: true adds the part again mirrored across X.
"""
import json
import math
import os
import sys

import bpy

PRIMITIVES = {"cube", "cylinder", "cone", "ico", "uv", "torus"}


def argv_after_dashdash():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_value(flags, default=None):
    args = argv_after_dashdash()
    for flag in flags:
        if flag in args:
            i = args.index(flag)
            if i + 1 < len(args):
                return args[i + 1]
    return default


def flag_set(flag):
    return flag in argv_after_dashdash()


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)


def make_material(key, spec):
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    color = tuple(spec.get("color", (0.8, 0.8, 0.8))) + (1.0,)
    bsdf.inputs["Base Color"].default_value = color
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = float(spec.get("rough", 0.6))
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = float(spec.get("metal", 0.0))
    strength = float(spec.get("emissive", 0.0))
    if strength > 0 and "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def add_primitive(part):
    prim = part.get("prim", "cube")
    if prim not in PRIMITIVES:
        raise SystemExit(f"unknown primitive: {prim}")
    params = part.get("params", {})
    if prim == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif prim == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=int(params.get("vertices", 8)), radius=1.0, depth=1.0)
    elif prim == "cone":
        bpy.ops.mesh.primitive_cone_add(
            vertices=int(params.get("vertices", 8)),
            radius1=float(params.get("radius1", 1.0)),
            radius2=float(params.get("radius2", 0.0)),
            depth=1.0,
        )
    elif prim == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=int(params.get("subdivisions", 1)), radius=1.0)
    elif prim == "uv":
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=int(params.get("segments", 12)), ring_count=int(params.get("rings", 8)), radius=1.0
        )
    else:  # torus
        bpy.ops.mesh.primitive_torus_add(
            major_radius=1.0,
            minor_radius=float(params.get("minor_radius", 0.25)),
            major_segments=int(params.get("major_segments", 12)),
            minor_segments=int(params.get("minor_segments", 6)),
        )
    ob = bpy.context.active_object
    ob.name = part.get("name", prim)
    ob.scale = tuple(part.get("scale", (1.0, 1.0, 1.0)))
    ob.location = tuple(part.get("loc", (0.0, 0.0, 0.0)))
    ob.rotation_euler = tuple(math.radians(a) for a in part.get("rot", (0.0, 0.0, 0.0)))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    bevel = part.get("bevel")
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = float(bevel)
        mod.segments = int(part.get("bevel_segments", 1))
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(float(part.get("bevel_angle", 40.0)))
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def mirror_x(ob):
    dup = ob.copy()
    dup.data = ob.data.copy()
    dup.name = ob.name + "_mirror"
    bpy.context.collection.objects.link(dup)
    dup.scale = (-dup.scale.x, dup.scale.y, dup.scale.z)
    bpy.context.view_layer.objects.active = dup
    bpy.ops.object.select_all(action="DESELECT")
    dup.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return dup


def join_and_normalise(objs, unit_scale, ground):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    body = bpy.context.active_object

    # One mesh, one pivot: origin at the world cursor, longest side == unit_scale.
    coords = [v.co.copy() for v in body.data.vertices]
    dims = [max(c[i] for c in coords) - min(c[i] for c in coords) for i in range(3)]
    longest = max(dims) or 1.0
    k = float(unit_scale) / longest
    center = [(max(c[i] for c in coords) + min(c[i] for c in coords)) * 0.5 for i in range(3)]
    lowest = min(c.z for c in coords)
    cx, cy, cz = center
    for v in body.data.vertices:
        v.co = ((v.co.x - cx) * k, (v.co.y - cy) * k, (v.co.z - cz) * k)
    if ground:
        drop = (lowest - cz) * k
        for v in body.data.vertices:
            v.co.z -= drop
    body.data.update()
    bpy.ops.object.shade_flat()
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return body


def mesh_metrics(ob):
    me = ob.data
    tris = sum(max(1, len(p.vertices) - 2) for p in me.polygons)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return {
        "vertices": len(me.vertices),
        "triangles": tris,
        "polygons": len(me.polygons),
        "materials": [m.name for m in me.materials if m],
        "bounds": {
            "x": [round(min(xs), 4), round(max(xs), 4)],
            "y": [round(min(ys), 4), round(max(ys), 4)],
            "z": [round(min(zs), 4), round(max(zs), 4)],
        },
        "dims": [round(max(xs) - min(xs), 4), round(max(ys) - min(ys), 4), round(max(zs) - min(zs), 4)],
    }


def export_glb(body, out_dir, name):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    return path


def setup_camera_and_lights(target_z):
    bpy.ops.object.camera_add(location=(3.2, -3.2, 1.9))
    cam = bpy.context.active_object
    cam.data.lens = 60
    bpy.context.scene.camera = cam
    empty = bpy.data.objects.new("target", None)
    bpy.context.collection.objects.link(empty)
    empty.location = (0.0, 0.0, target_z)
    c = cam.constraints.new("TRACK_TO")
    c.target = empty
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"

    bpy.ops.object.light_add(type="AREA", location=(2.5, -2.0, 3.5))
    key = bpy.context.active_object
    key.data.energy = 380
    key.data.size = 3.0
    bpy.ops.object.light_add(type="AREA", location=(-2.8, -1.2, 2.0))
    fill = bpy.context.active_object
    fill.data.energy = 120
    fill.data.size = 4.0
    return cam


def render_atlas(cam, out_dir, atlas, target_z):
    frames = int(atlas.get("frames", 8))
    size = int(atlas.get("size", 256))
    samples = int(atlas.get("samples", 16))
    elevation = float(atlas.get("elevation_deg", 18.0))

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"

    frames_dir = os.path.join(out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    radius = float(atlas.get("radius", 3.4))
    height = target_z + radius * math.tan(math.radians(elevation))
    for i in range(frames):
        ang = math.radians(360.0 / frames * i)
        cam.location = (radius * math.sin(ang), -radius * math.cos(ang), height)
        sc.render.filepath = os.path.join(frames_dir, f"view_{i:03d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"RENDER {i}/{frames} ang={math.degrees(ang):.0f}")


def main():
    spec_path = arg_value(["--spec", "-s"])
    if not spec_path or not os.path.exists(spec_path):
        raise SystemExit("missing --spec <file.json>")
    spec = json.load(open(spec_path))

    out_dir = arg_value(["--out", "-o"], spec.get("out"))
    if not out_dir:
        raise SystemExit("missing output directory (--out or spec.out)")
    name = spec.get("name") or "asset"

    reset_scene()
    materials = {k: make_material(k, v) for k, v in (spec.get("palette") or {}).items()}

    objs = []
    for part in spec.get("parts", []):
        ob = add_primitive(part)
        mat_key = part.get("mat")
        if mat_key:
            if mat_key not in materials:
                raise SystemExit(f"part {part.get('name')} uses unknown material {mat_key}")
            ob.data.materials.append(materials[mat_key])
        objs.append(ob)
        if part.get("mirror"):
            objs.append(mirror_x(ob))
    if not objs:
        raise SystemExit("spec has no parts")

    body = join_and_normalise(objs, spec.get("unit_scale", 1.0), bool(spec.get("ground", False)))
    metrics = mesh_metrics(body)
    budget = int(spec.get("tri_budget", 0) or 0)
    print("METRICS " + json.dumps(metrics))
    if budget and metrics["triangles"] > budget:
        print(f"BUDGET_EXCEEDED tris={metrics['triangles']} budget={budget}")

    glb = export_glb(body, out_dir, name)
    print(f"GLB {glb} {os.path.getsize(glb)}")

    atlas = spec.get("atlas")
    if atlas and not flag_set("--no-atlas"):
        target_z = metrics["bounds"]["z"][1] * 0.5
        cam = setup_camera_and_lights(target_z)
        render_atlas(cam, out_dir, atlas, target_z)
        print(f"ATLAS {os.path.join(out_dir, 'frames')}")

    print("OK " + out_dir)


main()
