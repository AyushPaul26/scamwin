"""Author the OpenMods moss otter. Run with Blender 4.5.9's bundled Python.

The surfaces below are original, deliberately shaped topology. No downloaded
character meshes, textures, or animation data are used. Blender Z is up and -Y
is forward; the glTF exporter converts this to Y up and +Z forward.
"""

import argparse
import json
import math
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument("--render", action="store_true")
parser.add_argument("--pose", choices=("neutral", "greet", "blink"), default="neutral")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for block in bpy.data.materials:
    bpy.data.materials.remove(block)

scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 121
scene.world.color = (0.15, 0.15, 0.15)


def linear_channel(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def material(name, color, roughness=0.5, coat=0.0):
    values = tuple(linear_channel(int(color[i:i + 2], 16) / 255) for i in (0, 2, 4))
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*values, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*values, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.16
    return m


M = {
    "body": material("body", "508b69", 0.5, 0.12),
    "cream": material("cream", "f2dfb2", 0.56),
    "accent": material("accent", "93bc67", 0.46, 0.1),
    "nose": material("nose", "203a31", 0.28, 0.25),
    "iris": material("iris", "173629", 0.16, 0.4),
    "eye_white": material("eye_white", "fff9e9", 0.3, 0.1),
    "eye_highlight": material("eye_highlight", "ffffff", 0.1, 0.35),
    "iris_glow": material("iris_glow", "57855c", 0.3),
    "cheek": material("cheek", "d79a7b", 0.6),
}

meshes = []
bindings = {}


def mesh(name, vertices, faces, mat, bone="root", blink=False, blink_center=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(M[mat])
    for polygon in data.polygons:
        polygon.use_smooth = True
    meshes.append(obj)
    bindings[obj.name] = bone
    if blink:
        obj.shape_key_add(name="Basis")
        key = obj.shape_key_add(name="Blink")
        center = blink_center if blink_center is not None else sum(v[2] for v in vertices) / len(vertices)
        eye_x = -0.305 if bone == "eye_L" else 0.305
        for vertex in key.data:
            lid_arch = 0.025 * (1 - ((vertex.co.x - eye_x) / 0.215) ** 2)
            vertex.co.z = center + (vertex.co.z - center) * 0.035 + lid_arch
            vertex.co.y = head_surface(vertex.co.x, center) - 0.01 + (vertex.co.y + 0.525) * 0.06
    return obj


def rounded(name, center, radii, mat, bone="root", segments=32, rings=18, deform=None, blink=False, blink_center=None):
    """Closed custom ring surface; deform controls anatomy in normalized space."""
    vertices = []
    faces = []
    for j in range(rings + 1):
        t = math.pi * j / rings
        z = math.cos(t)
        ring = math.sin(t)
        for i in range(segments):
            a = 2 * math.pi * i / segments
            x, y = math.cos(a) * ring, math.sin(a) * ring
            if deform:
                x, y, z2 = deform(x, y, z)
            else:
                z2 = z
            vertices.append((center[0] + x * radii[0], center[1] + y * radii[1], center[2] + z2 * radii[2]))
    for j in range(rings):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            c, d = a + segments, b + segments
            if j == 0:
                faces.append((a, c, d))
            elif j == rings - 1:
                faces.append((a, c, b))
            else:
                faces.append((a, c, d, b))
    return mesh(name, vertices, faces, mat, bone, blink, blink_center)


def tube(name, points, radii, mat, bone="root", segments=12):
    """A tapered curved solid, useful for expressive sculpted lines and limbs."""
    vertices, faces = [], []
    vectors = [Vector(p) for p in points]
    for j, point in enumerate(vectors):
        tangent = (vectors[min(j + 1, len(vectors) - 1)] - vectors[max(0, j - 1)]).normalized()
        side = tangent.cross(Vector((0, 1, 0))).normalized()
        if side.length < 0.1:
            side = tangent.cross(Vector((1, 0, 0))).normalized()
        normal = tangent.cross(side).normalized()
        radius = radii[j]
        if isinstance(radius, (int, float)):
            radius = (radius, radius)
        for i in range(segments):
            theta = 2 * math.pi * i / segments
            vertex = point + side * math.cos(theta) * radius[0] + normal * math.sin(theta) * radius[1]
            vertices.append(tuple(vertex))
    for j in range(len(vectors) - 1):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple((len(vectors) - 1) * segments + i for i in range(segments)))
    return mesh(name, vertices, faces, mat, bone)


def smooth_path(points, radii, subdivisions=4):
    """Catmull-Rom interpolation removes visible section corners in limbs."""
    vectors = [Vector(p) for p in points]
    result, widths = [], []
    for index in range(len(points) - 1):
        p0, p1 = vectors[max(0, index - 1)], vectors[index]
        p2, p3 = vectors[index + 1], vectors[min(len(vectors) - 1, index + 2)]
        for step in range(subdivisions):
            t = step / subdivisions
            position = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t*t + (-p0 + 3 * p1 - 3 * p2 + p3) * t*t*t)
            result.append(tuple(position))
            widths.append(radii[index] * (1 - t) + radii[index + 1] * t)
    result.append(points[-1])
    widths.append(radii[-1])
    return result, widths


def leaf(name, start, tip, width, thickness, mat, bone="tail", bend=-0.1):
    """Pointed asymmetric leaf with a raised central ridge and gently curled tip."""
    start, tip = Vector(start), Vector(tip)
    axis = tip - start
    side = Vector((1, 0, 0))
    if abs(axis.normalized().dot(side)) > 0.8:
        side = Vector((0, 0, 1))
    side = (side - side.dot(axis.normalized()) * axis.normalized()).normalized()
    normal = axis.normalized().cross(side).normalized()
    rows, cols = 16, 16
    vertices, faces = [], []
    for layer in (1, -1):
        for j in range(rows + 1):
            t = j / rows
            span = math.sin(math.pi * t) ** 0.83 * width * (0.85 + 0.15 * t)
            center = start + axis * t + normal * (bend * math.sin(math.pi * t) + 0.13 * t ** 4)
            for i in range(cols + 1):
                u = -1 + 2 * i / cols
                ridge = thickness * math.sin(math.pi * t) * (1 - u * u)
                vertex = center + side * u * span + normal * layer * ridge
                vertices.append(tuple(vertex))
    offset = (rows + 1) * (cols + 1)
    for layer in (0, 1):
        for j in range(rows):
            for i in range(cols):
                a = layer * offset + j * (cols + 1) + i
                quad = (a, a + 1, a + cols + 2, a + cols + 1)
                faces.append(quad if layer == 0 else tuple(reversed(quad)))
    for j in range(rows):
        for i in (0, cols):
            a = j * (cols + 1) + i
            b = a + cols + 1
            faces.append((a, b, b + offset, a + offset))
    return mesh(name, vertices, faces, mat, bone)


def face_patch(name, cx, cz, rx, rz, mat, surface, bone, rings=12, segments=48, shape=None):
    vertices, faces = [], []
    for j in range(rings + 1):
        r = j / rings
        for i in range(segments):
            a = 2 * math.pi * i / segments
            x, z = math.cos(a) * r, math.sin(a) * r
            if shape:
                x, z = shape(x, z)
            x, z = cx + x * rx, cz + z * rz
            vertices.append((x, surface(x, z), z))
    for j in range(rings):
        for i in range(segments):
            a, b = j * segments + i, j * segments + (i + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    return mesh(name, vertices, faces, mat, bone)


# Broad, rounded hips taper into the shoulders; the centerline leans forward.
def body_anatomy(x, y, z):
    fullness = 1.0 - 0.14 * z + 0.04 * math.cos(z * math.pi)
    return x * fullness, y * fullness - 0.1 * z, z


rounded("Torso", (0, 0.05, 0.94), (0.57, 0.43, 0.83), "body", segments=40, rings=24, deform=body_anatomy)


def body_surface(x, z):
    zn = (z - 0.94) / 0.83
    fullness = 1 - 0.14 * zn + 0.04 * math.cos(zn * math.pi)
    return 0.05 + (-math.sqrt(max(0.01, 1 - (x / (0.57 * fullness)) ** 2 - zn ** 2)) * fullness - 0.1 * zn) * 0.43 - 0.008


face_patch("Belly bib", 0, 0.89, 0.37, 0.57, "cream", body_surface, "root", shape=lambda x, z: (x * (1 - 0.12 * z), z))


def head_anatomy(x, y, z):
    cheeks = 1.0 + 0.075 * math.exp(-((z + 0.32) / 0.4) ** 2)
    return x * cheeks, y * (1 - 0.04 * z), z


rounded("Head sculpt", (0, -0.015, 2.00), (0.70, 0.56, 0.64), "body", "head", segments=44, rings=28, deform=head_anatomy)


def head_surface(x, z):
    zn = (z - 2) / 0.64
    cheeks = 1 + 0.075 * math.exp(-((zn + 0.32) / 0.4) ** 2)
    return -0.015 - 0.56 * (1 - 0.04 * zn) * math.sqrt(max(0.012, 1 - (x / (0.70 * cheeks)) ** 2 - zn ** 2)) - 0.01


face_patch("Face mask", 0, 1.90, 0.585, 0.425, "cream", head_surface, "head", rings=16, shape=lambda x, z: (x * (1 + 0.05 * z), z - 0.13 * max(z, 0) * math.exp(-(x / 0.24) ** 2)))

# One gently lobed muzzle rather than two intersecting balls.
rounded("Muzzle", (0, -0.55, 1.80), (0.43, 0.19, 0.205), "cream", "head", segments=40, rings=20,
        deform=lambda x, y, z: (x, y * (1 - 0.18 * math.exp(-(x / 0.2) ** 2) * max(z, 0)), z * (1 - 0.12 * math.exp(-(x / 0.22) ** 2))))

# Rounded triangular nose: gentle taper toward its lower point.
rounded("Nose", (0, -0.738, 1.915), (0.105, 0.048, 0.068), "nose", "head", segments=24, rings=14,
        deform=lambda x, y, z: (x * (0.85 + 0.22 * z), y, z))
tube("Philtrum", [(0, -0.750, 1.89), (0, -0.753, 1.855), (0, -0.750, 1.83)], [0.009, 0.011, 0.008], "nose", "head", 8)
for sign, side in ((-1, "L"), (1, "R")):
    mouth = [(sign * x, y, z) for x, y, z in [(0, -0.749, 1.832), (0.045, -0.751, 1.814), (0.09, -0.741, 1.821), (0.135, -0.718, 1.85)]]
    tube(f"Smile {side}", mouth, [0.008, 0.011, 0.009, 0.003], "nose", "head", 8)
    rounded(f"Whisker freckle {side} 1", (sign * 0.255, -0.70, 1.845), (0.012, 0.006, 0.012), "nose", "head", 12, 8)
    rounded(f"Whisker freckle {side} 2", (sign * 0.29, -0.677, 1.81), (0.009, 0.005, 0.009), "nose", "head", 12, 8)

    # Ear outer cups and inner lining are flattened, subtly tipped surfaces.
    ear = rounded(f"Ear {side}", (sign * 0.57, -0.005, 2.47), (0.19, 0.12, 0.22), "body", f"ear_{side}", 28, 16,
                  deform=lambda x, y, z: (x * (1 - 0.1 * z), y, z))
    rounded(f"Inner ear {side}", (sign * 0.585, -0.112, 2.48), (0.111, 0.021, 0.139), "accent", f"ear_{side}", 24, 14)

    ex, ey, ez = sign * 0.305, -0.525, 2.135
    eye_bone = f"eye_{side}"
    rounded(f"Eye white {side}", (ex, ey, ez), (0.205, 0.072, 0.265), "eye_white", eye_bone, 28, 18, blink=True, blink_center=ez)
    rounded(f"Iris {side}", (ex - sign * 0.008, ey - 0.061, ez - 0.005), (0.170, 0.044, 0.235), "iris", eye_bone, 28, 18, blink=True, blink_center=ez)
    rounded(f"Iris glow {side}", (ex - sign * 0.008, ey - 0.091, ez - 0.17), (0.075, 0.004, 0.024), "iris_glow", eye_bone, 20, 12, blink=True, blink_center=ez)
    rounded(f"Catchlight {side}", (ex - 0.052, ey - 0.105, ez + 0.095), (0.049, 0.012, 0.068), "eye_highlight", eye_bone, 20, 12, blink=True, blink_center=ez)
    rounded(f"Catchlight small {side}", (ex + 0.065, ey - 0.111, ez - 0.04), (0.026, 0.007, 0.032), "eye_highlight", eye_bone, 16, 10, blink=True, blink_center=ez)
    tube(f"Brow {side}", [(sign * 0.17, -0.425, 2.43), (sign * 0.27, -0.414, 2.46), (sign * 0.36, -0.38, 2.445)], [0.011, 0.023, 0.007], "body", "head", 10)

    # Shoulder-to-paw cross sections form a single tapered forelimb.
    arm_points = [(sign * 0.30, 0.005, 1.26), (sign * 0.48, -0.025, 1.28), (sign * 0.64, -0.075, 1.14), (sign * 0.70, -0.16, 0.96), (sign * 0.70, -0.20, 0.87), (sign * 0.68, -0.215, 0.83)]
    arm_points, arm_radii = smooth_path(arm_points, [0.07, 0.145, 0.185, 0.17, 0.125, 0.005], subdivisions=3)
    tube(f"Forelimb {side}", arm_points, arm_radii, "body", f"arm_{side}", 20)
    rounded(f"Paw pad {side}", (sign * 0.705, -0.325, 0.94), (0.093, 0.022, 0.092), "accent", f"arm_{side}", 20, 12)
    for toe in (-1, 0, 1):
        rounded(f"Paw toe {side} {toe}", (sign * 0.70 + toe * 0.057, -0.312, 1.035 + (0.008 if toe == 0 else 0)), (0.022, 0.014, 0.026), "cream", f"arm_{side}", 12, 8)

    rounded(f"Foot {side}", (sign * 0.29, -0.14, 0.19), (0.265, 0.34, 0.19), "body", f"foot_{side}", 32, 18,
            deform=lambda x, y, z: (x * (1 + 0.08 * -y), y, z * (0.8 if z < 0 else 1)))
    for toe in (-1, 0, 1):
        rounded(f"Foot toe {side} {toe}", (sign * 0.29 + toe * 0.093, -0.417, 0.225), (0.048, 0.055, 0.025), "cream", f"foot_{side}", 16, 10)

# Asymmetric leaf-shaped tail is deliberately visible around the right flank.
tube("Tail stem", [(0.1, 0.32, 0.5), (0.4, 0.48, 0.48), (0.68, 0.50, 0.63), (0.89, 0.48, 0.89)], [0.20, 0.19, 0.15, 0.07], "body", "tail", 20)
leaf("Leaf tail", (0.55, 0.48, 0.55), (1.10, 0.47, 1.61), 0.33, 0.075, "accent", "tail", -0.05)
tube("Tail midrib", [(0.57, 0.395, 0.59), (0.77, 0.365, 0.90), (0.94, 0.36, 1.25), (1.09, 0.42, 1.58)], [0.018, 0.022, 0.014, 0.003], "body", "tail", 8)
for i in range(3):
    z = 0.87 + i * 0.20
    x = 0.75 + i * 0.10
    tube(f"Tail vein {i}", [(x, 0.367, z), (x - 0.16 + i * 0.018, 0.39, z + 0.10), (x - 0.23 + i * 0.022, 0.45, z + 0.16)], [0.012, 0.009, 0.002], "body", "tail", 8)

# A small two-leaf crown gives the otter an identifiable woodland silhouette.
leaf("Crown left", (-0.03, 0.00, 2.57), (-0.24, -0.025, 2.82), 0.105, 0.035, "accent", "head", -0.02)
leaf("Crown right", (0.01, 0.015, 2.58), (0.14, 0.04, 2.91), 0.115, 0.035, "accent", "head", 0.015)

# Rig. Head and eye rotations are intentionally never keyed: the browser
# adds bounded gaze on top of these rest transforms.
armature = bpy.data.armatures.new("Moss otter skeleton")
rig = bpy.data.objects.new("MossOtterRig", armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bone_specs = {
    "root": ((0, 0, 0.12), (0, 0, 0.7), None),
    "head": ((0, 0, 1.50), (0, 0, 2.15), "root"),
    "eye_L": ((-0.305, -0.525, 2.135), (-0.305, -0.525, 2.335), "head"),
    "eye_R": ((0.305, -0.525, 2.135), (0.305, -0.525, 2.335), "head"),
    "arm_L": ((-0.46, -0.01, 1.31), (-0.70, -0.16, 0.96), "root"),
    "arm_R": ((0.46, -0.01, 1.31), (0.70, -0.16, 0.96), "root"),
    "foot_L": ((-0.29, -0.01, 0.22), (-0.29, -0.25, 0.22), "root"),
    "foot_R": ((0.29, -0.01, 0.22), (0.29, -0.25, 0.22), "root"),
    "ear_L": ((-0.50, 0, 2.35), (-0.58, 0, 2.55), "head"),
    "ear_R": ((0.50, 0, 2.35), (0.58, 0, 2.55), "head"),
    "tail": ((0.10, 0.32, 0.5), (0.65, 0.49, 0.70), "root"),
}
for name, (start, end, parent) in bone_specs.items():
    bone = armature.edit_bones.new(name)
    bone.head, bone.tail = start, end
    if parent:
        bone.parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

for obj in meshes:
    group = obj.vertex_groups.new(name=bindings[obj.name])
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Creature skin", "ARMATURE")
    modifier.object = rig
    obj.parent = rig

for pose in rig.pose.bones:
    pose.rotation_mode = "XYZ"


def reset_pose():
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def key(name, frame, location=None, rotation=None, scale=None):
    bone = rig.pose.bones[name]
    for prop, value in (("location", location), ("rotation_euler", rotation), ("scale", scale)):
        if value is not None:
            setattr(bone, prop, value)
            bone.keyframe_insert(data_path=prop, frame=frame, group=name)


def finish_action(name, end):
    action = rig.animation_data.action
    action.name = name
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.name = name
    strip.action_frame_start = 1
    strip.action_frame_end = end
    track.mute = True
    rig.animation_data.action = None
    reset_pose()


for frame in (1, 31, 61, 91, 121):
    phase = (frame - 1) / 120 * math.tau
    breath = 0.5 - 0.5 * math.cos(phase)
    key("root", frame, scale=(1 + 0.012 * breath, 1 + 0.018 * breath, 1 + 0.006 * breath))
    key("tail", frame, rotation=(0.025 * math.sin(phase), 0, 0.045 * math.sin(phase)))
    key("arm_L", frame, rotation=(0.018 * math.sin(phase), 0, 0.018 * breath))
    key("arm_R", frame, rotation=(-0.018 * math.sin(phase), 0, -0.018 * breath))
    key("ear_L", frame, rotation=(0.02 * math.sin(phase), 0, 0))
    key("ear_R", frame, rotation=(-0.025 * math.sin(phase), 0, 0))
finish_action("idle", 121)

# Right forepaw lifts out and forward, gives two short waves, and settles.
for frame, lift, wave, bounce in [(1, 0, 0, 0), (10, 0.40, 0, 0.025), (22, 1.85, -0.20, 0.04), (30, 1.85, 0.22, 0.035), (38, 1.85, -0.20, 0.025), (46, 1.85, 0.22, 0.015), (56, 0.85, 0, 0.008), (70, 0, 0, 0)]:
    rest = armature.bones["arm_R"].matrix_local.to_quaternion()
    world_wave = Quaternion((0, 1, 0), -lift + wave) @ Quaternion((1, 0, 0), 0.32 * min(lift, 1))
    key("arm_R", frame, rotation=(rest.inverted() @ world_wave @ rest).to_euler())
    key("arm_L", frame, rotation=(0.04 * min(lift, 1), 0, -0.10 * min(lift, 1)))
    key("root", frame, location=(0, bounce, 0), rotation=(0, 0, -0.035 * min(lift, 1)))
    key("tail", frame, rotation=(0, 0, 0.12 * math.sin((frame - 1) / 69 * math.tau)))
finish_action("greet", 70)
scene.frame_set(1)

rig["character"] = "moss-otter"
rig["catalogVersion"] = 1
rig["authoringBlender"] = "4.5.9"
rig["license"] = "Original OpenMods artwork"

source_dir = ROOT / "assets/creatures/moss-otter"
output = ROOT / "public/creatures/v1/moss-otter.glb"
source_dir.mkdir(parents=True, exist_ok=True)
output.parent.mkdir(parents=True, exist_ok=True)

# Select only character meshes and armature; cameras/lights are source-only.
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes + [rig]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=str(output), export_format="GLB", use_selection=True,
    export_yup=True, export_apply=False, export_animations=True,
    export_animation_mode="NLA_TRACKS", export_nla_strips=True,
    export_frame_range=False, export_force_sampling=True,
    export_anim_single_armature=True, export_morph=True,
    export_skins=True, export_def_bones=True, export_extras=True,
    export_materials="EXPORT", export_cameras=False, export_lights=False,
    export_image_format="AUTO", export_texcoords=False,
)

# NLA sampling exports constant channels for unkeyed bones too. Remove the
# gaze-owned channels so AnimationMixer cannot take ownership of those nodes.
raw = output.read_bytes()
json_length = struct.unpack_from("<I", raw, 12)[0]
document = json.loads(raw[20:20 + json_length])
for clip in document.get("animations", []):
    clip["channels"] = [channel for channel in clip["channels"]
                        if document["nodes"][channel["target"]["node"]].get("name") not in {"head", "eye_L", "eye_R"}]
encoded = json.dumps(document, separators=(",", ":")).encode()
encoded += b" " * ((-len(encoded)) % 4)
binary_chunks = raw[20 + json_length:]
output.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(binary_chunks))
                   + struct.pack("<I4s", len(encoded), b"JSON") + encoded + binary_chunks)

# Source lighting/camera make the .blend useful for further art iteration.
def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


bpy.ops.object.camera_add(location=(3.3, -8, 3.2))
camera = bpy.context.object
camera.name = "Art review camera"
camera.data.type = "ORTHO"
camera.data.ortho_scale = 3.8
aim(camera, (0.15, 0, 1.45))
scene.camera = camera
for name, location, energy, size, color in [
    ("Key softbox", (-3, -4, 6), 450, 4, (1, 0.94, 0.84)),
    ("Fill softbox", (4, -2, 4), 300, 3.5, (0.8, 0.92, 1)),
    ("Rim softbox", (0, 3, 4), 550, 3, (0.9, 1, 0.88)),
]:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy, light.data.shape, light.data.size, light.data.color = energy, "DISK", size, color
    aim(light, (0, 0, 1.3))
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "AgX"
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(source_dir / "moss-otter.blend"), compress=True)

triangle_count = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
report = {"blender": bpy.app.version_string, "meshes": len(meshes), "triangles": triangle_count,
          "materials": list(M), "bones": list(bone_specs), "animations": ["idle", "greet"],
          "morphTargets": ["Blink"], "fileBytes": output.stat().st_size,
          "coordinateSystem": "glTF: Y up, +Z forward", "runtimePaletteMaterials": ["body", "cream", "accent"]}
(source_dir / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if args.render:
    if args.pose == "greet":
        rig.animation_data.action = bpy.data.actions["greet"]
        scene.frame_set(30)
    elif args.pose == "blink":
        for obj in meshes:
            if obj.data.shape_keys:
                obj.data.shape_keys.key_blocks["Blink"].value = 1
    scene.render.filepath = f"/tmp/openmods-moss-otter-{args.pose}.png"
    bpy.ops.render.render(write_still=True)
