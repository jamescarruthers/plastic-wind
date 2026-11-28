// three.js preview of the assembled instrument or the print layout.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ViewMesh {
  name: string;
  role: string;
  color: string;
  positions: Float32Array;
  indices: Uint32Array;
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private helpers = new THREE.Group();
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private section = false;
  private explode = 0;
  private mode: 'assembled' | 'print' = 'assembled';
  private hasFitted = { assembled: false, print: false };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.camera.position.set(250, 150, 600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(300, 500, 600);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(-400, -200, -300);
    this.scene.add(rim);
    this.scene.add(this.group);
    this.scene.add(this.helpers);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  setBackground(color: string) {
    this.scene.background = new THREE.Color(color);
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSection(on: boolean) {
    this.section = on;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        m.clippingPlanes = on && this.mode === 'assembled' ? [this.clip] : [];
        m.needsUpdate = true;
      }
    });
  }

  setExplode(v: number) {
    this.explode = v;
    this.group.children.forEach((o) => {
      const u = o.userData as { role?: string; name?: string };
      if (this.mode !== 'assembled') return;
      if (u.name?.includes('back half')) o.position.z = -v;
      else if (u.name?.includes('front half')) o.position.z = v;
    });
  }

  show(meshes: ViewMesh[], mode: 'assembled' | 'print', bed?: [number, number, number], plates: [number, number][] = [[0, 0]]) {
    this.mode = mode;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    for (const c of [...this.helpers.children]) this.helpers.remove(c);
    for (const pm of meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pm.positions, 3));
      g.setIndex(new THREE.BufferAttribute(pm.indices, 1));
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      g.dispose();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(pm.color),
        roughness: pm.role === 'pipe' ? 0.35 : 0.7,
        metalness: pm.role === 'pipe' ? 0.8 : 0.05,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(flat, mat);
      mesh.userData = { role: pm.role, name: pm.name };
      this.group.add(mesh);
    }
    if (mode === 'print') {
      // Print bed lies in XY with z up; show it with y into the screen.
      this.group.rotation.set(-Math.PI / 2, 0, 0);
      if (bed) {
        for (const [px, py] of plates) {
          const bedGeo = new THREE.PlaneGeometry(bed[0], bed[1]);
          const bedMesh = new THREE.Mesh(bedGeo, new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
          bedMesh.rotation.x = -Math.PI / 2;
          bedMesh.position.set(px + bed[0] / 2, -0.2, -(py + bed[1] / 2));
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bedGeo), new THREE.LineBasicMaterial({ color: 0x888888 }));
          edges.rotation.x = -Math.PI / 2;
          edges.position.copy(bedMesh.position);
          this.helpers.add(bedMesh, edges);
        }
      }
    } else {
      this.group.rotation.set(0, 0, 0);
    }
    this.setSection(this.section);
    this.setExplode(this.explode);
    if (!this.hasFitted[mode]) {
      this.fit();
      this.hasFitted[mode] = true;
    }
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = r / Math.tan((this.camera.fov * Math.PI) / 360) * 1.25;
    const dir = this.mode === 'print' ? new THREE.Vector3(0, 1.2, 1).normalize() : new THREE.Vector3(0.45, 0.15, 1).normalize();
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
  }

  resetFit() {
    this.hasFitted = { assembled: false, print: false };
  }

  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }
}
