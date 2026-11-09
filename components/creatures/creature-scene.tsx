"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  Euler,
  LoopOnce,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PMREMGenerator,
  Quaternion,
  SRGBColorSpace,
  SkinnedMesh,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { resolveCreature } from "@/lib/creatures/catalog";

type Creature = ReturnType<typeof resolveCreature>;

type SceneProps = {
  creature: Creature;
  active: boolean;
  portraitCapture: boolean;
  pointer: RefObject<{ x: number; y: number }>;
  greeting: boolean;
  greetingRequest: number;
  onReady: () => void;
  onNotReady: () => void;
  onFailure: () => void;
  onGreetingFinished: () => void;
};

function instantiateCreature(gltf: GLTF, colors: Creature["colors"]) {
  const model = clone(gltf.scene);
  const materialCopies = new Map<Material, Material>();
  const blinkTargets: { mesh: Mesh; index: number }[] = [];
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object instanceof SkinnedMesh) object.frustumCulled = false;
    const copyMaterial = (original: Material) => {
      let material = materialCopies.get(original);
      if (!material) {
        material = original.clone();
        if (material instanceof MeshStandardMaterial) {
          const color = colors[original.name as keyof Creature["colors"]];
          if (color) material.color.set(color);
          material.envMapIntensity = original.name === "iris" || original.name === "nose" ? 0.8 : 0.35;
        }
        materialCopies.set(original, material);
      }
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(copyMaterial) : copyMaterial(object.material);
    const blinkIndex = object.morphTargetDictionary?.Blink;
    if (blinkIndex !== undefined && object.morphTargetInfluences) {
      blinkTargets.push({ mesh: object, index: blinkIndex });
    }
  });
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  const height = bounds.max.y - bounds.min.y;
  const scale = 2 / Math.max(height, 0.01);
  const bones = ["head", "eye_L", "eye_R"].map((name) => {
    const bone = model.getObjectByName(name);
    if (!bone) throw new Error(`Creature model is missing its ${name} control.`);
    return { bone, rest: bone.quaternion.clone() };
  });
  return {
    model,
    materialCopies,
    blinkTargets,
    bones,
    scale,
    position: [-center.x * scale, -bounds.min.y * scale, -center.z * scale] as [number, number, number],
  };
}

function CameraAndLighting() {
  const { camera, gl, scene, size, invalidate } = useThree();

  useLayoutEffect(() => {
    frameCamera(camera as OrthographicCamera, size.width / Math.max(size.height, 1));
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  useEffect(() => {
    const room = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    const environment = generator.fromScene(room, 0.04);
    const previousEnvironment = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    setEnvironment(scene, environment.texture, 0.45);
    invalidate();
    return () => {
      setEnvironment(scene, previousEnvironment, previousIntensity);
      environment.dispose();
      generator.dispose();
      room.dispose();
    };
  }, [gl, scene, invalidate]);

  return (
    <>
      <hemisphereLight args={["#e8f0ff", "#a9b497", 0.4]} />
      <directionalLight
        position={[-3.5, 5, 5]}
        color="#fff2de"
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2.4}
        shadow-camera-right={2.4}
        shadow-camera-top={2.6}
        shadow-camera-bottom={-2}
        shadow-camera-near={0.1}
        shadow-camera-far={15}
        shadow-bias={-0.00015}
        shadow-normalBias={0.018}
      />
      <directionalLight position={[4, 2.5, 1]} color="#c9e7ff" intensity={0.35} />
      <directionalLight position={[1, 4, -4]} color="#efffde" intensity={1.1} />
    </>
  );
}

/** Three's camera is an imperative renderer object, not React state. */
function frameCamera(camera: OrthographicCamera, aspect: number) {
  const halfHeight = 1.32;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.zoom = 1;
  camera.position.set(0.9, 1.5, 6);
  camera.lookAt(0, 1.03, 0);
  camera.updateProjectionMatrix();
}

function setEnvironment(scene: Scene, texture: Texture | null, intensity: number) {
  scene.environment = texture;
  scene.environmentIntensity = intensity;
}

function GroundShadow() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, "rgba(13, 25, 18, 0.3)");
    gradient.addColorStop(0.45, "rgba(13, 25, 18, 0.14)");
    gradient.addColorStop(1, "rgba(13, 25, 18, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      <planeGeometry args={[2.1, 1.4]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function CreatureModel({ creature, active, portraitCapture, pointer, greeting, greetingRequest, onReady, onGreetingFinished }: SceneProps) {
  const gltf = useLoader(GLTFLoader, creature.modelUrl);
  const instance = useMemo(() => instantiateCreature(gltf, creature.colors), [gltf, creature.colors]);
  const mixer = useMemo(() => new AnimationMixer(instance.model), [instance.model]);
  const animations = useMemo(() => {
    const idleClip = gltf.animations.find((clip) => clip.name === "idle");
    const greetClip = gltf.animations.find((clip) => clip.name === "greet");
    if (!idleClip || !greetClip) throw new Error("Creature model is missing its idle or greet animation.");
    const greet = mixer.clipAction(greetClip);
    greet.clampWhenFinished = true;
    return { idle: mixer.clipAction(idleClip), greet };
  }, [gltf.animations, mixer]);
  const { invalidate } = useThree();
  const elapsed = useRef(0);
  const frames = useRef(0);
  const gaze = useRef({ x: 0, y: 0 });
  const parentRotation = useMemo(() => new Quaternion(), []);
  const worldOffset = useMemo(() => new Quaternion(), []);
  const targetRotation = useMemo(() => new Quaternion(), []);
  const offsetEuler = useMemo(() => new Euler(0, 0, 0, "YXZ"), []);

  useEffect(() => {
    frames.current = 0;
    if (!portraitCapture) animations.idle.reset().play();
    invalidate();
    return () => {
      mixer.stopAllAction();
      // Strict Mode replays this effect with the same memoized actions. Keep
      // their bindings cached; the instance-local mixer is collected on unmount.
    };
  }, [animations, mixer, instance.model, portraitCapture, invalidate]);

  useEffect(() => {
    const finished = ({ action }: { action: typeof animations.greet }) => {
      if (action !== animations.greet) return;
      animations.greet.fadeOut(0.22);
      animations.idle.reset().fadeIn(0.22).play();
      onGreetingFinished();
    };
    mixer.addEventListener("finished", finished);
    return () => mixer.removeEventListener("finished", finished);
  }, [animations, mixer, onGreetingFinished]);

  useEffect(() => {
    if (!greeting || !greetingRequest || portraitCapture) return;
    animations.idle.fadeOut(0.18);
    animations.greet.reset().setLoop(LoopOnce, 1).fadeIn(0.18).play();
    invalidate();
  }, [greeting, greetingRequest, animations, portraitCapture, invalidate]);

  useEffect(() => () => {
    instance.materialCopies.forEach((material) => material.dispose());
    instance.model.traverse((object) => {
      if (object instanceof SkinnedMesh) object.skeleton.dispose();
    });
  }, [instance]);

  useFrame((_, delta) => {
    if (frames.current < 3) {
      frames.current += 1;
      if (frames.current === 3) onReady();
      else invalidate();
    }
    if (!active || portraitCapture) return;
    const step = Math.min(delta, 0.05);
    elapsed.current += step;
    mixer.update(step);

    const smoothing = 1 - Math.exp(-8 * step);
    gaze.current.x = MathUtils.lerp(gaze.current.x, pointer.current.x, smoothing);
    gaze.current.y = MathUtils.lerp(gaze.current.y, pointer.current.y, smoothing);
    instance.model.updateMatrixWorld(true);
    instance.bones.forEach(({ bone, rest }, index) => {
      const amount = index === 0 ? 0.13 : 0.10;
      offsetEuler.set(-gaze.current.y * amount * 0.7, gaze.current.x * amount, 0);
      worldOffset.setFromEuler(offsetEuler);
      bone.parent?.getWorldQuaternion(parentRotation);
      targetRotation.copy(parentRotation).invert().multiply(worldOffset).multiply(parentRotation).multiply(rest);
      bone.quaternion.copy(targetRotation);
      bone.updateMatrixWorld(true);
    });

    const blinkPhase = elapsed.current % 4.7;
    const blink = blinkPhase > 3.3 && blinkPhase < 3.48
      ? Math.sin(((blinkPhase - 3.3) / 0.18) * Math.PI)
      : 0;
    instance.blinkTargets.forEach(({ mesh, index }) => {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = blink;
    });
  });

  return (
    <group position={instance.position} scale={instance.scale}>
      <primitive object={instance.model} dispose={null} />
    </group>
  );
}

function ContextMonitor({ onFailure, onNotReady }: { onFailure: () => void; onNotReady: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const contextLost = () => onFailure();
    canvas.addEventListener("webglcontextlost", contextLost);
    return () => {
      canvas.removeEventListener("webglcontextlost", contextLost);
      onNotReady();
    };
  }, [gl, onFailure, onNotReady]);
  return null;
}

export default function CreatureScene(props: SceneProps) {
  return (
    <Canvas
      orthographic
      shadows="percentage"
      camera={{ position: [0.9, 1.5, 6], near: 0.1, far: 30 }}
      dpr={[1, 1.5]}
      frameloop={props.active ? "always" : "demand"}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: props.portraitCapture }}
      onCreated={({ gl }) => {
        gl.setClearColor(new Color("#000000"), 0);
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.9;
      }}
      fallback={null}
      style={{ width: "100%", height: "100%" }}
    >
      <CameraAndLighting />
      <ContextMonitor onFailure={props.onFailure} onNotReady={props.onNotReady} />
      <GroundShadow />
      <Suspense fallback={null}>
        <CreatureModel {...props} />
      </Suspense>
    </Canvas>
  );
}
