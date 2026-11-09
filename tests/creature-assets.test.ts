import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { CREATURE_IDS, CREATURE_VARIANTS, type CreatureId } from "../lib/creatures/catalog";

type Gltf = {
  asset: { version: string };
  nodes: { name?: string }[];
  skins: { joints: number[] }[];
  materials: { name?: string }[];
  buffers: { uri?: string }[];
  images?: { uri?: string }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  animations: { name: string; channels: { target: { node: number; path: string } }[]; samplers: { input: number }[] }[];
  meshes: { extras?: { targetNames?: string[] }; primitives: { mode?: number; indices: number; attributes: Record<string, number> }[] }[];
};

function loadModel(id: CreatureId) {
  const model = readFileSync(`public/creatures/v1/${id}.glb`);
  assert.equal(model.readUInt32LE(0), 0x46546c67, "GLB magic");
  assert.equal(model.readUInt32LE(4), 2, "GLB version");
  assert.equal(model.readUInt32LE(8), model.length, "GLB declared length");
  assert.equal(model.readUInt32LE(16), 0x4e4f534a, "JSON chunk type");
  const jsonLength = model.readUInt32LE(12);
  const gltf: Gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString("utf8"));
  return { model, gltf };
}

for (const id of CREATURE_IDS) {
  test(`${id}: portable model stays within its runtime budget`, () => {
    const { model, gltf } = loadModel(id);
    assert.equal(gltf.asset.version, "2.0");
    assert.ok(model.length < 2 * 1024 * 1024, "GLB must stay under 2 MiB");
    assert.ok(gltf.materials.length <= 12);
    let triangles = 0;
    for (const mesh of gltf.meshes) {
      for (const primitive of mesh.primitives) {
        assert.equal(primitive.mode ?? 4, 4);
        triangles += gltf.accessors[primitive.indices].count / 3;
        assert.ok("NORMAL" in primitive.attributes, "every surface needs authored normals");
        assert.ok(!("JOINTS_1" in primitive.attributes), "limit skinning to four influences");
        const positions = gltf.accessors[primitive.attributes.POSITION];
        assert.ok(positions.count > 0, "surface must contain vertices");
        assert.ok(positions.min?.every(Number.isFinite) && positions.max?.every(Number.isFinite), "position bounds must be finite");
      }
    }
    assert.ok(triangles > 1000 && triangles <= 30000, `Model contains ${triangles} triangles`);
    assert.ok(gltf.buffers.every((buffer) => !buffer.uri), "geometry must be embedded");
    assert.ok((gltf.images ?? []).every((image) => !image.uri), "textures must be embedded");
    assert.ok(readFileSync(`assets/creatures/${id}/${id}.blend`).length > 0, "reproducible model source must be stored");
  });

  test(`${id}: exported rig exposes gaze, blink, and usable idle/greeting clips`, () => {
    const { gltf } = loadModel(id);
    const controls = ["head", "eye_L", "eye_R"];
    const nodes = new Set(gltf.nodes.map((node) => node.name));
    for (const name of controls) assert.ok(nodes.has(name), `${name} control missing`);
    assert.ok(gltf.skins.some((skin) => skin.joints.length >= 6), "requires an articulated rig");
    const skinnedControls = new Set(gltf.skins.flatMap((skin) => skin.joints.map((index) => gltf.nodes[index].name)));
    for (const name of controls) assert.ok(skinnedControls.has(name), `${name} must deform the model`);
    assert.ok(gltf.meshes.some((mesh) => mesh.extras?.targetNames?.includes("Blink")), "Blink morph missing");
    for (const name of ["idle", "greet"]) {
      const clip = gltf.animations.find((animation) => animation.name === name);
      assert.ok(clip, `${name} clip missing`);
      assert.ok(clip.channels.length > 0);
      const duration = Math.max(...clip.samplers.map((sampler) => gltf.accessors[sampler.input].max?.[0] ?? 0));
      assert.ok(duration >= 1 && duration <= 10, `${name} has invalid duration ${duration}`);
      assert.ok(!clip.channels.some(({ target }) => controls.includes(gltf.nodes[target.node].name ?? "") && target.path === "rotation"), `${name} must not overwrite interactive gaze controls`);
    }
    const materials = new Set(gltf.materials.map((material) => material.name));
    for (const name of ["body", "cream", "accent"]) assert.ok(materials.has(name), `${name} palette material missing`);
  });

  test(`${id}: every palette has a nonempty transparent matching portrait`, async () => {
    const portraits: Buffer[] = [];
    for (const variant of CREATURE_VARIANTS) {
      const path = `public/creatures/v1/${id}-${variant}.webp`;
      const contents = await readFile(path);
      const image = sharp(contents);
      const metadata = await image.metadata();
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);
      assert.ok(metadata.hasAlpha);
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      let opaquePixels = 0;
      for (let index = 3; index < data.length; index += info.channels) if (data[index] > 240) opaquePixels += 1;
      assert.ok(opaquePixels > 10000 && opaquePixels < 512 * 512, "portrait should contain a character on transparency");
      for (const previous of portraits) assert.ok(!previous.equals(contents), "palette portraits must differ");
      portraits.push(contents);
    }
  });
}
