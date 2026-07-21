// Rando modular character: procedural chibi built from simple volumes to
// match the turnaround (big round head, small body, stub arms, bean feet).
// Every part is a slot + tint so customization is parametric, not assets.
// The API surface (makeCharacter -> { group, setConfig, tick }) is the
// contract a future rigged GLB base can implement as a drop-in swap.
import * as THREE from "https://esm.sh/three@0.160.0";

export const PART_OPTIONS = {
  color:  ["#f4f6f8", "#ffd9e0", "#cfe6ff", "#d8f4d8", "#fff3c4", "#e6d9ff", "#ffc9a8", "#aeb6c2"],
  accent: ["#8fb7de", "#e8899a", "#f2b84b", "#7fc98f", "#9a86d9", "#e2704e", "#5b6a7d"],
  ears:      ["none", "round", "cat", "bunny"],
  arms:      ["stub", "long", "tiny"],
  wings:     ["none", "angel", "bat"],
  eyes:      ["oval", "dot", "sleepy"],
  accessory: ["none", "headphones", "halo", "antenna"],
};

export const DEFAULT_AVATAR = {
  color: "#f4f6f8", accent: "#8fb7de",
  ears: "round", arms: "stub", wings: "none", eyes: "oval", accessory: "none",
};

// accept any historical avatar jsonb shape and return a valid config
export function normalizeAvatar(raw) {
  const cfg = { ...DEFAULT_AVATAR };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_AVATAR)) {
      if (k === "color" || k === "accent") {
        if (typeof raw[k] === "string" && /^#[0-9a-f]{6}$/i.test(raw[k])) cfg[k] = raw[k];
      } else if (PART_OPTIONS[k] && PART_OPTIONS[k].includes(raw[k])) {
        cfg[k] = raw[k];
      }
    }
  }
  return cfg;
}

const DARK = 0x3a3f45;

function sphere(r, mat, sx = 1, sy = 1, sz = 1, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

export function makeCharacter(rawCfg) {
  const group = new THREE.Group();
  const refs = {};
  let cfg = normalizeAvatar(rawCfg);
  let mats = {};

  function build() {
    group.clear();
    mats = {
      body: new THREE.MeshLambertMaterial({ color: cfg.color }),
      accent: new THREE.MeshLambertMaterial({ color: cfg.accent }),
      dark: new THREE.MeshLambertMaterial({ color: DARK }),
    };

    // body
    const body = sphere(3.4, mats.body, 1, 1.05, 1);
    body.position.y = 3.8;
    group.add(body);

    // feet
    refs.feet = [];
    for (const s of [-1, 1]) {
      const foot = sphere(1.55, mats.body, 1.1, 0.55, 1.45);
      foot.position.set(s * 1.7, 0.85, 0.7);
      group.add(foot);
      refs.feet.push(foot);
    }

    // arms: pivot at the shoulder so walk-swing works
    refs.arms = [];
    const armLen = { stub: 1, long: 1.5, tiny: 0.6 }[cfg.arms];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 3.1, 5.6, 0);
      const arm = sphere(1.35, mats.body, 0.62, 1.25 * armLen, 0.62);
      arm.position.y = -1.5 * armLen;
      pivot.add(arm);
      pivot.rotation.z = s * 0.35;
      group.add(pivot);
      refs.arms.push(pivot);
    }

    // head: everything face/ear/hat related lives in this group
    const headG = new THREE.Group();
    headG.position.y = 10.1;
    refs.head = headG;
    const head = sphere(5.1, mats.body, 1, 0.96, 0.98);
    headG.add(head);

    // eyes: flattened dark spheres embedded in the head surface
    const eyeScale = { oval: [0.62, 1.05], dot: [0.5, 0.55], sleepy: [0.72, 0.45] }[cfg.eyes];
    for (const s of [-1, 1]) {
      const eye = sphere(1, mats.dark, eyeScale[0], eyeScale[1], 0.3, 14);
      eye.position.set(s * 1.85, 0.55, 4.35);
      headG.add(eye);
    }
    // subtle smile
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.09, 6, 12, Math.PI * 0.7), mats.dark);
    smile.position.set(0, -1.15, 4.55);
    smile.rotation.set(0.15, 0, Math.PI + Math.PI * 0.15);
    headG.add(smile);

    // ears
    if (cfg.ears === "round") {
      for (const s of [-1, 1]) {
        const ear = sphere(1.5, mats.body, 1, 1, 0.55);
        ear.position.set(s * 3.4, 3.8, 0);
        headG.add(ear);
        const inner = sphere(0.85, mats.accent, 1, 1, 0.3);
        inner.position.set(s * 3.5, 3.9, 0.55);
        headG.add(inner);
      }
    } else if (cfg.ears === "cat") {
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(1.35, 2.7, 10), mats.body);
        ear.position.set(s * 2.9, 4.6, 0);
        ear.rotation.z = -s * 0.35;
        headG.add(ear);
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.5, 10), mats.accent);
        inner.position.set(s * 2.95, 4.5, 0.5);
        inner.rotation.z = -s * 0.35;
        headG.add(inner);
      }
    } else if (cfg.ears === "bunny") {
      for (const s of [-1, 1]) {
        const ear = sphere(1.1, mats.body, 0.5, 2.3, 0.4);
        ear.position.set(s * 2.2, 6.2, -0.3);
        ear.rotation.z = -s * 0.18;
        headG.add(ear);
        const inner = sphere(0.7, mats.accent, 0.35, 1.7, 0.2);
        inner.position.set(s * 2.25, 6.2, 0.15);
        inner.rotation.z = -s * 0.18;
        headG.add(inner);
      }
    }

    // accessory
    if (cfg.accessory === "headphones") {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(4.4, 0.4, 8, 20, Math.PI), mats.dark);
      band.position.y = 1.2;
      headG.add(band);
      for (const s of [-1, 1]) {
        const cup = sphere(1.25, mats.accent, 0.6, 1, 1);
        cup.position.set(s * 4.6, 0.4, 0);
        headG.add(cup);
      }
    } else if (cfg.accessory === "halo") {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(2.6, 0.32, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd75e }));
      halo.position.y = 6.6;
      halo.rotation.x = Math.PI / 2.15;
      headG.add(halo);
    } else if (cfg.accessory === "antenna") {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.6, 8), mats.dark);
      stem.position.y = 6;
      headG.add(stem);
      const bob = sphere(0.55, mats.accent);
      bob.position.y = 7.4;
      headG.add(bob);
    }
    group.add(headG);

    // wings: attach behind the body, flap in tick()
    refs.wings = [];
    if (cfg.wings !== "none") {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 1.7, 6.3, -2.6);
        let wing;
        if (cfg.wings === "angel") {
          wing = new THREE.Group();
          const w1 = sphere(1.7, mats.body, 1.25, 0.6, 0.3);
          const w2 = sphere(1.25, mats.body, 1.1, 0.5, 0.3);
          w2.position.set(s * 1.3, -1.0, 0);
          wing.add(w1, w2);
        } else { // bat
          const shape = new THREE.Shape();
          shape.moveTo(0, 0);
          shape.quadraticCurveTo(s * 2.6, 1.6, s * 3.6, 0.4);
          shape.quadraticCurveTo(s * 2.9, -0.4, s * 2.6, -1.2);
          shape.quadraticCurveTo(s * 1.6, -0.7, 0, -0.9);
          wing = new THREE.Mesh(
            new THREE.ShapeGeometry(shape),
            new THREE.MeshLambertMaterial({ color: cfg.accent, side: THREE.DoubleSide }));
        }
        wing.rotation.y = s * 0.5;
        pivot.add(wing);
        group.add(pivot);
        refs.wings.push({ pivot, side: s });
      }
    }
  }

  build();

  const api = {
    group,
    get config() { return { ...cfg }; },
    setConfig(next) {
      cfg = normalizeAvatar({ ...cfg, ...next });
      build();
    },
    walking: false,
    phase: Math.random() * Math.PI * 2,
    // procedural life: idle bob / waddle walk / wing flap
    tick(t) {
      const p = t * (this.walking ? 9 : 2) + this.phase;
      const s = Math.sin(p);
      if (this.walking) {
        group.position.y = Math.abs(Math.sin(p)) * 0.55;
        group.rotation.z = Math.sin(p) * 0.07;
        refs.arms[0].rotation.x = s * 0.7;
        refs.arms[1].rotation.x = -s * 0.7;
        refs.feet[0].position.y = 0.85 + Math.max(0, s) * 0.7;
        refs.feet[1].position.y = 0.85 + Math.max(0, -s) * 0.7;
      } else {
        group.position.y = s * 0.16;
        group.rotation.z = 0;
        refs.arms[0].rotation.x = s * 0.06;
        refs.arms[1].rotation.x = -s * 0.06;
        refs.feet[0].position.y = 0.85;
        refs.feet[1].position.y = 0.85;
        refs.head.rotation.z = Math.sin(p * 0.7) * 0.03;
      }
      for (const w of refs.wings) {
        w.pivot.rotation.y = w.side * (0.25 + Math.sin(t * (this.walking ? 10 : 3.2) + this.phase) * 0.35);
      }
    },
  };
  return api;
}

// portrait thumbnail for chat headers / match cards (data URL)
let thumbRenderer = null;
export function avatarThumb(rawCfg, size = 128) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(size, size);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x8fa3b8, 1.3));
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(30, 50, 40);
  scene.add(sun);
  const ch = makeCharacter(rawCfg);
  scene.add(ch.group);
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 200);
  cam.position.set(0, 11.5, 26);
  cam.lookAt(0, 8.6, 0);
  thumbRenderer.render(scene, cam);
  return thumbRenderer.domElement.toDataURL();
}
