"""Reusable original-creature authoring helpers for Blender 4.5.9.

Importing this module does not reset or build a scene. Instantiate a builder to
start one character; all authoring coordinates use Blender Z up, -Y forward.
"""
import json
import math
from pathlib import Path
import struct

import bpy
import bmesh
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]


class CreatureBuilder:
    def __init__(self, character_id, palette):
        self.character_id = character_id
        self.meshes, self.bindings, self.eye_centers, self.eye_surfaces = [], {}, {}, {}
        self.clip_lengths = {}
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
        for item in list(bpy.data.materials):
            bpy.data.materials.remove(item)
        self.scene = bpy.context.scene
        self.scene.render.fps = 30
        self.scene.frame_start, self.scene.frame_end = 1, 121
        self.scene.world.color = (0.15, 0.15, 0.15)
        colors = {"body": "508b69", "cream": "f2dfb2", "accent": "93bc67",
                  "nose": "263634", "iris": "17302b", "eye_white": "fff9e9",
                  "eye_highlight": "ffffff", "iris_glow": "62877d"}
        colors.update({key: value.removeprefix("#") for key, value in palette.items()})
        self.materials = {key: self.material(key, color, 0.20 if key == "iris" else 0.5,
                                           0.35 if key == "iris" else 0.12)
                          for key, color in colors.items()}

    def linear_channel(self, v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    def material(self, name, color, roughness=0.5, coat=0.0):
        values = tuple(self.linear_channel(int(color[i:i + 2], 16) / 255) for i in (0, 2, 4))
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*values, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*values, 1)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.16
        return m

    def mesh(self, name, vertices, faces, mat, bone="root", blink=False, blink_center=None):
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
        data.materials.append(self.materials[mat])
        for polygon in data.polygons:
            polygon.use_smooth = True
        self.meshes.append(obj)
        self.bindings[obj.name] = bone
        if blink:
            obj.shape_key_add(name="Basis")
            key = obj.shape_key_add(name="Blink")
            center = blink_center if blink_center is not None else sum(v[2] for v in vertices) / len(vertices)
            eye_x = self.eye_centers[bone][0]
            for vertex in key.data:
                lid_arch = 0.025 * (1 - ((vertex.co.x - eye_x) / 0.215) ** 2)
                vertex.co.z = center + (vertex.co.z - center) * 0.035 + lid_arch
                vertex.co.y = self.eye_surfaces[bone](vertex.co.x, center) - 0.01 + (vertex.co.y - self.eye_centers[bone][1]) * 0.06
        return obj

    def rounded(self, name, center, radii, mat, bone="root", segments=32, rings=18, deform=None, blink=False, blink_center=None):
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
        return self.mesh(name, vertices, faces, mat, bone, blink, blink_center)

    def tube(self, name, points, radii, mat, bone="root", segments=12):
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
        return self.mesh(name, vertices, faces, mat, bone)

    def smooth_path(self, points, radii, subdivisions=4):
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

    def leaf(self, name, start, tip, width, thickness, mat, bone="tail", bend=-0.1):
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
        return self.mesh(name, vertices, faces, mat, bone)

    def face_patch(self, name, cx, cz, rx, rz, mat, surface, bone, rings=12, segments=48, shape=None):
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
        return self.mesh(name, vertices, faces, mat, bone)

    patch = face_patch

    def eyes(self, center_L, center_R, radii=(0.20, 0.07, 0.26), surface=None):
        """Five surfaces per eye share one Blink morph and one gaze bone."""
        for side, center in (("L", center_L), ("R", center_R)):
            bone = f"eye_{side}"
            self.eye_centers[bone] = center
            self.eye_surfaces[bone] = surface or (lambda x, z, cy=center[1]: cy + 0.025)
            ex, ey, ez = center
            rx, ry, rz = radii
            self.rounded(f"Eye white {side}", center, radii, "eye_white", bone, 28, 18, blink=True, blink_center=ez)
            self.rounded(f"Iris {side}", (ex, ey - ry * 0.85, ez), (rx * 0.83, ry * 0.62, rz * 0.89), "iris", bone, 28, 18, blink=True, blink_center=ez)
            self.rounded(f"Iris glow {side}", (ex, ey - ry * 1.3, ez - rz * 0.66), (rx * 0.36, 0.004, rz * 0.09), "iris_glow", bone, 16, 10, blink=True, blink_center=ez)
            self.rounded(f"Catchlight {side}", (ex - rx * 0.25, ey - ry * 1.5, ez + rz * 0.36), (rx * 0.24, 0.011, rz * 0.26), "eye_highlight", bone, 18, 10, blink=True, blink_center=ez)
            self.rounded(f"Catchlight small {side}", (ex + rx * 0.31, ey - ry * 1.5, ez - rz * 0.15), (rx * 0.12, 0.007, rz * 0.12), "eye_highlight", bone, 12, 8, blink=True, blink_center=ez)

    def make_rig(self, bone_specs):
        self.bone_specs = bone_specs
        armature = bpy.data.armatures.new(f"{self.character_id} skeleton")
        self.rig = rig = bpy.data.objects.new(f"{self.character_id} rig", armature)
        bpy.context.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        for name, (start, end, parent) in bone_specs.items():
            bone = armature.edit_bones.new(name)
            bone.head, bone.tail = start, end
            if parent:
                bone.parent = armature.edit_bones[parent]
        bpy.ops.object.mode_set(mode="OBJECT")
        for obj in self.meshes:
            group = obj.vertex_groups.new(name=self.bindings[obj.name])
            group.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
            modifier = obj.modifiers.new("Creature skin", "ARMATURE")
            modifier.object = rig
            obj.parent = rig
        for pose in rig.pose.bones:
            pose.rotation_mode = "XYZ"

    def key(self, name, frame, location=None, rotation=None, scale=None):
        bone = self.rig.pose.bones[name]
        for prop, value in (("location", location), ("rotation_euler", rotation), ("scale", scale)):
            if value is not None:
                setattr(bone, prop, value)
                bone.keyframe_insert(data_path=prop, frame=frame, group=name)

    def world_rotation(self, bone_name, rotation):
        """Convert a world-space quaternion into the bone's rest axes."""
        rest = self.rig.data.bones[bone_name].matrix_local.to_quaternion()
        return (rest.inverted() @ rotation @ rest).to_euler()

    def finish_action(self, name, end):
        action = self.rig.animation_data.action
        action.name = name
        track = self.rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, action)
        strip.name, strip.action_frame_start, strip.action_frame_end = name, 1, end
        track.mute = True
        self.rig.animation_data.action = None
        self.clip_lengths[name] = end
        for bone in self.rig.pose.bones:
            bone.location, bone.rotation_euler, bone.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)

    def export(self, render_pose="neutral", render=False):
        scene, rig = self.scene, self.rig
        scene.frame_set(1)
        rig["character"], rig["catalogVersion"], rig["authoringBlender"] = self.character_id, 1, "4.5.9"
        rig["license"] = "Original OpenMods artwork"
        source = ROOT / "assets/creatures" / self.character_id
        target = ROOT / "public/creatures/v1" / f"{self.character_id}.glb"
        source.mkdir(parents=True, exist_ok=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in self.meshes + [rig]:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True,
            export_yup=True, export_apply=False, export_animations=True,
            export_animation_mode="NLA_TRACKS", export_nla_strips=True,
            export_frame_range=False, export_force_sampling=True,
            export_anim_single_armature=True, export_morph=True,
            export_skins=True, export_def_bones=True, export_extras=True,
            export_materials="EXPORT", export_cameras=False, export_lights=False,
            export_image_format="AUTO", export_texcoords=False)
        raw = target.read_bytes()
        json_length = struct.unpack_from("<I", raw, 12)[0]
        document = json.loads(raw[20:20 + json_length])
        for clip in document.get("animations", []):
            clip["channels"] = [channel for channel in clip["channels"]
                if document["nodes"][channel["target"]["node"]].get("name") not in {"head", "eye_L", "eye_R"}]
        encoded = json.dumps(document, separators=(",", ":")).encode()
        encoded += b" " * ((-len(encoded)) % 4)
        tail = raw[20 + json_length:]
        target.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail))
            + struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail)
        self.review_lighting()
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(source / f"{self.character_id}.blend"), compress=True)
        triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in self.meshes)
        report = {"blender": bpy.app.version_string, "meshes": len(self.meshes), "triangles": triangles,
            "materials": list(self.materials), "bones": list(self.bone_specs), "animations": list(self.clip_lengths),
            "morphTargets": ["Blink"], "fileBytes": target.stat().st_size,
            "coordinateSystem": "glTF: Y up, +Z forward", "runtimePaletteMaterials": ["body", "cream", "accent"]}
        (source / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        if render:
            if render_pose == "greet":
                rig.animation_data.action = bpy.data.actions["greet"]
                scene.frame_set(round(self.clip_lengths["greet"] * 0.42))
            elif render_pose == "blink":
                for obj in self.meshes:
                    if obj.data.shape_keys:
                        obj.data.shape_keys.key_blocks["Blink"].value = 1
            scene.render.filepath = f"/tmp/openmods-{self.character_id}-{render_pose}.png"
            bpy.ops.render.render(write_still=True)
        return report

    def review_lighting(self):
        scene = self.scene
        bounds = [vertex.co for obj in self.meshes for vertex in obj.data.vertices]
        height = max(p.z for p in bounds)
        width = max(p.x for p in bounds) - min(p.x for p in bounds)
        def aim(obj, target):
            obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
        bpy.ops.object.camera_add(location=(3.0, -8, height * 0.95))
        camera = bpy.context.object
        camera.name, camera.data.type = "Art review camera", "ORTHO"
        camera.data.ortho_scale = max(height, width) * 1.28
        aim(camera, (0, 0, height * 0.50))
        scene.camera = camera
        for name, position, energy, color in [
            ("Key softbox", (-3, -4, 6), 450, (1, .94, .84)),
            ("Fill softbox", (4, -2, 4), 300, (.8, .92, 1)),
            ("Rim softbox", (0, 3, 4), 550, (.9, 1, .88))]:
            bpy.ops.object.light_add(type="AREA", location=position)
            light = bpy.context.object
            light.name = name
            light.data.energy, light.data.shape, light.data.size, light.data.color = energy, "DISK", 4, color
            aim(light, (0, 0, height * .45))
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
        scene.render.resolution_x = scene.render.resolution_y = 720
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.view_settings.view_transform = "AgX"
