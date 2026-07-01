import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { ATMOSPHERE, COLORS, DENY_SHAKE_DURATION_MS, ECONOMY, GRID, PERMIT, RAIN, SHADOW, STORM, TOWER_HEIGHT } from './constants';
import { Grid, type GridNode } from './Grid';
import { Tower, buildTowerVisual, type TowerBranch } from './Tower';
import { Span } from './Span';
import { IsoCameraRig } from './CameraRig';
import { Economy } from './Economy';
import { Hud } from './Hud';
import { Guide } from './Guide';
import { SoundManager } from './SoundManager';
import { ParticleBurst, type BurstStyle } from './ParticleBurst';
import { denyShakeOffset } from './feedback';
import { clearSave, loadGame, saveGame, type SaveData } from './Persistence';

const AUTOSAVE_INTERVAL_MS = 3000;
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

interface SpanRecord {
  span: Span;
  a: Tower;
  b: Tower;
}

function isValidGridNode(i: number, j: number): boolean {
  return (
    Number.isInteger(i) && Number.isInteger(j) && i >= 0 && i <= GRID.cells && j >= 0 && j <= GRID.cells
  );
}

function findTowerRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let o: THREE.Object3D | null = obj;
  while (o && !o.userData.isTower) o = o.parent;
  return o;
}

function findSpanRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let o: THREE.Object3D | null = obj;
  while (o && !o.userData.isSpan) o = o.parent;
  return o;
}

/** Both interval bounds shrink toward `minIntervalFloorSec` as `energizedCount` grows —
 * an exponential approach (never a subtraction), so neither bound can cross the floor or
 * invert relative to the other, and no separate clamping is needed. */
function randomStormDelayMs(energizedCount: number): number {
  const scale = Math.pow(0.5, energizedCount / STORM.intervalHalfLifeSpanCount);
  const min = STORM.minIntervalFloorSec + (STORM.minIntervalSec - STORM.minIntervalFloorSec) * scale;
  const max = STORM.minIntervalFloorSec + (STORM.maxIntervalSec - STORM.minIntervalFloorSec) * scale;
  return (min + Math.random() * (max - min)) * 1000;
}

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly cameraRig: IsoCameraRig;
  private readonly grid = new Grid();
  private readonly economy = new Economy();
  private readonly hud: Hud;
  private readonly guide: Guide;
  private readonly sound = new SoundManager();
  private readonly ambientLight: THREE.AmbientLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly dayAmbientColor = new THREE.Color(COLORS.ambientLight);
  private readonly nightAmbientColor = new THREE.Color(COLORS.steelBlueDim);

  private readonly bursts: ParticleBurst[] = [];
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainPositions: THREE.Vector3[] = [];
  private readonly rainQuat: THREE.Quaternion;
  private rainActiveUntil: number | null = null;

  private readonly towers: Tower[] = [];
  private readonly spans: SpanRecord[] = [];
  private readonly spannedPairs = new Set<string>();
  private selectedTower: Tower | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly ghost: THREE.Group;
  private readonly ghostMaterial: THREE.MeshStandardMaterial;
  private readonly ghostBasePos = new THREE.Vector3();
  private ghostDenyStart: number | null = null;
  private readonly container: HTMLElement;
  private lastTick = performance.now();
  private lastSave = performance.now();
  private isResetting = false;
  private nextStormAt = performance.now() + STORM.firstStrikeDelaySec * 1000;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(COLORS.background);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    container.appendChild(this.renderer.domElement);

    this.cameraRig = new IsoCameraRig(this.renderer.domElement);
    this.hud = new Hud(container);
    this.guide = new Guide(container);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cameraRig.camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.55,
      0.4,
      0.2,
    );
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());
    // Vignette must come after OutputPass: it mixes toward a plain SDR grey constant,
    // which needs to happen in the final sRGB-encoded buffer, not the linear HDR one
    // upstream — mixing in linear space made a near-black scene's corners read lighter
    // than its center, the opposite of a vignette.
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = ATMOSPHERE.vignetteOffset;
    vignettePass.uniforms.darkness.value = ATMOSPHERE.vignetteDarkness;
    this.composer.addPass(vignettePass);

    this.scene.fog = new THREE.Fog(COLORS.background, ATMOSPHERE.fogNear, ATMOSPHERE.fogFar);

    this.ambientLight = new THREE.AmbientLight(COLORS.ambientLight, ATMOSPHERE.dayAmbientIntensity);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(COLORS.keyLight, ATMOSPHERE.dayKeyIntensity);
    this.sunLight.position.set(30, 40, 15);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
    this.sunLight.shadow.bias = SHADOW.bias;
    this.sunLight.shadow.normalBias = SHADOW.normalBias;
    this.sunLight.shadow.radius = SHADOW.radius;
    const shadowCam = this.sunLight.shadow.camera;
    shadowCam.left = -SHADOW.frustumHalfExtent;
    shadowCam.right = SHADOW.frustumHalfExtent;
    shadowCam.top = SHADOW.frustumHalfExtent;
    shadowCam.bottom = -SHADOW.frustumHalfExtent;
    shadowCam.near = 1;
    shadowCam.far = 150;
    shadowCam.updateProjectionMatrix();
    this.scene.add(this.sunLight);

    this.scene.add(this.grid.group);

    this.ghostMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      transparent: true,
      opacity: 0.35,
      roughness: 0.5,
      metalness: 0.4,
    });
    this.ghost = buildTowerVisual(this.ghostMaterial, TOWER_HEIGHT);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    const fallDir = new THREE.Vector3(RAIN.windDriftX, -RAIN.fallSpeed, RAIN.windDriftZ).normalize();
    this.rainQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fallDir);
    this.rainMesh = this.buildRain();
    this.scene.add(this.rainMesh);

    this.loadSavedGame();

    this.bindInput();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('beforeunload', this.save);
    this.renderer.setAnimationLoop(this.tick);
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('click', this.onClick);
    window.addEventListener('keydown', this.onKeyDown);
    el.addEventListener('pointerdown', () => this.sound.unlock(), { once: true });
  }

  private updateNdc(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastGroundNode(): GridNode | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObject(this.grid.groundMesh);
    if (!hits.length) return null;
    return this.grid.nearestNode(hits[0].point);
  }

  private raycastTower(): Tower | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      this.towers.map((t) => t.group),
      true,
    );
    if (!hits.length) return null;
    const root = findTowerRoot(hits[0].object);
    return this.towers.find((t) => t.group === root) ?? null;
  }

  private raycastSpan(): SpanRecord | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      this.spans.map(({ span }) => span.group),
      true,
    );
    if (!hits.length) return null;
    const root = findSpanRoot(hits[0].object);
    return this.spans.find(({ span }) => span.group === root) ?? null;
  }

  /** Base tower cost gains mild linear growth per already-placed tower, on top of the
   * terrain multiplier — expansion gets steadily pricier without being punishing. */
  private computeTowerCost(node: GridNode): number {
    const growth = 1 + this.towers.length * ECONOMY.towerCostGrowthPerTower;
    return Math.round(ECONOMY.towerCost * growth * this.grid.towerCostMultiplier(node.i, node.j));
  }

  private onPointerMove = (e: MouseEvent): void => {
    this.updateNdc(e);
    const node = this.raycastGroundNode();
    if (node && this.grid.isBuildable(node.i, node.j)) {
      this.ghostBasePos.copy(node.world);
      this.ghost.visible = true;
      const cost = this.computeTowerCost(node);
      this.ghostMaterial.opacity = this.economy.canAfford(cost, 0) ? 0.35 : 0.15;
    } else {
      this.ghost.visible = false;
    }
  };

  private onClick = (e: MouseEvent): void => {
    this.updateNdc(e);

    const tower = this.raycastTower();
    if (tower) {
      this.handleTowerClick(tower);
      return;
    }

    const spanRecord = this.raycastSpan();
    if (spanRecord) {
      if (spanRecord.span.isFaulted()) this.tryRepairSpan(spanRecord);
      return;
    }

    const node = this.raycastGroundNode();
    if (node && this.grid.isBuildable(node.i, node.j)) {
      const cost = this.computeTowerCost(node);
      if (this.economy.canAfford(cost, 0)) {
        this.economy.spend(cost, 0);
        this.placeTower(node);
        this.sound.playPlace();
        this.spawnBurst(node.world.clone().setY(0.3), 'dust', performance.now());
        this.save();
      } else {
        this.ghostDenyStart = performance.now();
        this.sound.playDeny();
      }
      return;
    }

    this.deselect();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.guide.isOpen()) return;

    if (e.shiftKey && e.key.toLowerCase() === 'r') {
      this.isResetting = true;
      this.renderer.setAnimationLoop(null);
      clearSave();
      window.location.reload();
      return;
    }

    const key = e.key.toLowerCase();
    if (!this.selectedTower || (key !== 'u' && key !== 'i')) return;
    this.handleUpgradeKey(this.selectedTower, key === 'u' ? 'capacity' : 'resilience');
  };

  /** `U` performs the universal tier 1→2 step, or — once at tier 2 — the Capacity
   * branch to tier 3. `I` only ever means the Resilience branch, and only does
   * anything at tier 2 (there's no branch choice yet at tier 1, so it's a silent
   * no-op there rather than a deny — nothing was actually denied). */
  private handleUpgradeKey(tower: Tower, keyBranch: TowerBranch): void {
    if (!tower.canUpgrade()) {
      tower.denyFeedback();
      this.sound.playDeny();
      return;
    }

    if (tower.getTier() === 1) {
      if (keyBranch === 'resilience') return;
      this.trySpendUpgrade(tower, ECONOMY.towerUpgradeCost.linear, undefined);
      return;
    }

    // tower.canUpgrade() + tier !== 1 means tier is 2 here.
    const cost = keyBranch === 'capacity' ? ECONOMY.towerUpgradeCost.capacity : ECONOMY.towerUpgradeCost.resilience;
    this.trySpendUpgrade(tower, cost, keyBranch);
  }

  private trySpendUpgrade(tower: Tower, cost: { capEx: number; crewHours: number }, branch: TowerBranch | undefined): void {
    if (!this.economy.canAfford(cost.capEx, cost.crewHours)) {
      tower.denyFeedback();
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost.capEx, cost.crewHours);
    tower.upgrade(branch);
    this.sound.playUpgrade(tower.getTier());
    this.save();
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) this.save();
  };

  private placeTower(node: GridNode): Tower {
    this.grid.setOccupied(node.i, node.j);
    const tower = new Tower(node.i, node.j, node.world, TOWER_HEIGHT, PERMIT.pendingDurationSec * 1000);
    this.towers.push(tower);
    this.scene.add(tower.group);
    return tower;
  }

  private handleTowerClick(tower: Tower): void {
    if (tower.isPending()) {
      tower.denyFeedback();
      this.sound.playDeny();
      return;
    }

    if (this.selectedTower === tower) {
      this.deselect();
      return;
    }

    if (!this.selectedTower) {
      this.selectedTower = tower;
      tower.setSelected(true);
      this.sound.playSelect();
      return;
    }

    if (this.tryStringSpan(this.selectedTower, tower)) {
      this.selectedTower.setSelected(false);
      this.selectedTower = null;
      this.save();
    }
  }

  private tryStringSpan(a: Tower, b: Tower): boolean {
    const key = [a.gridI, a.gridJ, b.gridI, b.gridJ].sort().join('|');
    if (this.spannedPairs.has(key)) {
      a.denyFeedback();
      b.denyFeedback();
      this.sound.playDeny();
      return false;
    }

    if (!a.hasFreeCapacity()) {
      a.denyFeedback();
      this.sound.playDeny();
      return false;
    }
    if (!b.hasFreeCapacity()) {
      b.denyFeedback();
      this.sound.playDeny();
      return false;
    }

    const distance = a.topPos.distanceTo(b.topPos);
    const crewCost = ECONOMY.spanCostBase + distance * ECONOMY.spanCostPerUnitDistance;
    if (!this.economy.canAfford(0, crewCost)) {
      a.denyFeedback();
      b.denyFeedback();
      this.sound.playDeny();
      return false;
    }

    this.spannedPairs.add(key);
    this.economy.spend(0, crewCost);
    a.addConnection();
    b.addConnection();

    const span = new Span(a.topPos, b.topPos);
    this.spans.push({ span, a, b });
    this.scene.add(span.group);
    return true;
  }

  private tryRepairSpan(record: SpanRecord): void {
    const cost = STORM.repairCost;
    if (!this.economy.canAfford(cost.capEx, cost.crewHours)) {
      record.a.denyFeedback();
      record.b.denyFeedback();
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost.capEx, cost.crewHours);
    record.span.repair();
    this.save();
  }

  /** A span with at least one endpoint on marsh (wet/unstable ground) is more likely to
   * be picked as a storm's target — terrain-weighted, not uniform. A span with at least
   * one Resilience-branch tier-3 endpoint is less likely, applied multiplicatively on
   * top (a resilient tower on marsh is safer than average, not immune). */
  private spanStormWeight(record: SpanRecord): number {
    const aMarsh = this.grid.terrainAt(record.a.gridI, record.a.gridJ) === 'marsh';
    const bMarsh = this.grid.terrainAt(record.b.gridI, record.b.gridJ) === 'marsh';
    let weight = aMarsh || bMarsh ? STORM.marshWeightMultiplier : 1;

    const aResilient = record.a.getTier() === 3 && record.a.getBranch() === 'resilience';
    const bResilient = record.b.getTier() === 3 && record.b.getBranch() === 'resilience';
    if (aResilient || bResilient) weight *= STORM.resilienceWeightMultiplier;

    return weight;
  }

  private pickWeightedStormTarget(candidates: SpanRecord[]): SpanRecord {
    const weights = candidates.map((c) => this.spanStormWeight(c));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1]; // floating-point fallback, never reached in practice
  }

  private triggerStorm(now: number): void {
    const candidates = this.spans.filter(({ span }) => span.isEnergized());
    if (candidates.length >= STORM.minEnergizedSpansToStrike) {
      const target = this.pickWeightedStormTarget(candidates);
      target.span.fault();
      this.sound.playStormStrike();
      this.spawnBurst(target.span.midpoint(), 'spark', now);
      this.startRain(now);
      this.save();
    }
    this.nextStormAt = now + randomStormDelayMs(candidates.length);
  }

  private deselect(): void {
    if (this.selectedTower) {
      this.selectedTower.setSelected(false);
      this.selectedTower = null;
    }
  }

  /** Slow day/night cycle: animates the existing ambient/key lights only — same hues,
   * no new state, no gameplay coupling. Purely a background atmosphere cue. */
  private updateAtmosphere(now: number): void {
    const cyclePos = (now / 1000 / ATMOSPHERE.dayNightCycleSec) % 1;
    const dayFactor = 0.5 + 0.5 * Math.cos(cyclePos * Math.PI * 2);
    this.ambientLight.color.copy(this.nightAmbientColor).lerp(this.dayAmbientColor, dayFactor);
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      ATMOSPHERE.nightAmbientIntensity,
      ATMOSPHERE.dayAmbientIntensity,
      dayFactor,
    );
    this.sunLight.intensity = THREE.MathUtils.lerp(ATMOSPHERE.nightKeyIntensity, ATMOSPHERE.dayKeyIntensity, dayFactor);
  }

  /** Thin instanced streaks, all sharing one precomputed fall+wind tilt (wind is a
   * fixed constant, not per-storm, so every particle leans the same way). Reuses the
   * deterministic-InstancedMesh pattern from Grid's terrain patches, but these actually
   * animate frame to frame rather than being placed once. */
  private buildRain(): THREE.InstancedMesh {
    const geo = new THREE.CylinderGeometry(RAIN.streakRadius, RAIN.streakRadius, RAIN.streakLength, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.ambientLight,
      transparent: true,
      opacity: RAIN.opacity,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, RAIN.count);
    mesh.visible = false;
    for (let i = 0; i < RAIN.count; i++) {
      this.rainPositions.push(new THREE.Vector3());
      this.initRainParticle(i);
    }
    return mesh;
  }

  private initRainParticle(i: number): void {
    const x = (Math.random() * 2 - 1) * RAIN.spawnHalfExtent;
    const z = (Math.random() * 2 - 1) * RAIN.spawnHalfExtent;
    const y = Math.random() * RAIN.spawnHeight;
    this.rainPositions[i].set(x, y, z);
  }

  /** Bounded weather event tied to an actual storm strike — not a persistent
   * "isRaining" state, matching the audio ambience swell's same bounded-swell shape. */
  private startRain(now: number): void {
    this.rainActiveUntil = now + RAIN.durationMs;
    this.rainMesh.visible = true;
    for (let i = 0; i < RAIN.count; i++) this.initRainParticle(i);
  }

  private updateRain(now: number, dt: number): void {
    if (this.rainActiveUntil === null) return;
    if (now >= this.rainActiveUntil) {
      this.rainActiveUntil = null;
      this.rainMesh.visible = false;
      return;
    }

    const m = new THREE.Matrix4();
    for (let i = 0; i < RAIN.count; i++) {
      const p = this.rainPositions[i];
      p.y -= RAIN.fallSpeed * dt;
      p.x += RAIN.windDriftX * dt;
      p.z += RAIN.windDriftZ * dt;
      if (p.y < 0) this.initRainParticle(i);
      m.compose(p, this.rainQuat, UNIT_SCALE);
      this.rainMesh.setMatrixAt(i, m);
    }
    this.rainMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnBurst(origin: THREE.Vector3, style: BurstStyle, now: number): void {
    const burst = new ParticleBurst(origin, style, now);
    this.scene.add(burst.group);
    this.bursts.push(burst);
  }

  private updateBursts(now: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (!this.bursts[i].update(now)) {
        this.scene.remove(this.bursts[i].group);
        this.bursts[i].dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private updateGhost(now: number): void {
    this.ghost.position.copy(this.ghostBasePos);
    if (this.ghostDenyStart !== null) {
      const elapsed = now - this.ghostDenyStart;
      this.ghost.position.x += denyShakeOffset(elapsed);
      if (elapsed >= DENY_SHAKE_DURATION_MS) this.ghostDenyStart = null;
    }
  }

  /** Derived from current state, not stored — once you place two towers or string a
   * span, the corresponding hint simply stops matching and never reappears. */
  private computeOnboardingHint(): string {
    if (this.selectedTower || this.spans.length > 0) return '';
    if (this.towers.length === 0) return 'CLICK THE GRID TO PLACE YOUR FIRST TOWER';
    if (this.towers.length === 1) return 'CLICK THE GRID AGAIN TO PLACE A SECOND TOWER';
    return 'SELECT TWO TOWERS TO STRING A SPAN BETWEEN THEM';
  }

  private updateHud(): void {
    let context = '';
    if (this.selectedTower) {
      const tower = this.selectedTower;
      const tier = tower.getTier();
      if (tier === 1) {
        const cost = ECONOMY.towerUpgradeCost.linear;
        context = `TOWER T1 SELECTED · [U] UPGRADE TO T2 — $${cost.capEx} / ${cost.crewHours}h`;
      } else if (tier === 2) {
        const cap = ECONOMY.towerUpgradeCost.capacity;
        const res = ECONOMY.towerUpgradeCost.resilience;
        context =
          `TOWER T2 SELECTED · [U] CAPACITY — $${cap.capEx}/${cap.crewHours}h` +
          ` · [I] RESILIENCE — $${res.capEx}/${res.crewHours}h`;
      } else {
        const branchLabel = tower.getBranch() === 'resilience' ? 'RESILIENCE' : 'CAPACITY';
        context = `TOWER T3 ${branchLabel} SELECTED · MAX TIER`;
      }
    }
    const faultCount = this.spans.reduce((count, { span }) => count + (span.isFaulted() ? 1 : 0), 0);
    this.hud.update({
      capEx: this.economy.capEx,
      crewHours: this.economy.crewHours,
      crewHoursMax: this.economy.crewHoursMax,
      context,
      faultCount,
      repairCapEx: STORM.repairCost.capEx,
      repairCrewHours: STORM.repairCost.crewHours,
      hint: this.computeOnboardingHint(),
    });
  }

  private save = (): void => {
    if (this.isResetting) return;
    const camera = this.cameraRig.getView();
    saveGame({
      capEx: this.economy.capEx,
      crewHours: this.economy.crewHours,
      towers: this.towers.map((t) => ({
        i: t.gridI,
        j: t.gridJ,
        tier: t.getTier(),
        pendingMs: t.getPendingRemainingMs() ?? undefined,
        branch: t.getBranch() ?? undefined,
      })),
      spans: this.spans.map(({ a, b, span }) => ({
        a: [a.gridI, a.gridJ] as [number, number],
        b: [b.gridI, b.gridJ] as [number, number],
        faulted: span.isFaulted(),
      })),
      camera,
    });
  };

  private loadSavedGame(): void {
    let data: SaveData | null = null;
    try {
      data = loadGame();
    } catch {
      data = null;
    }
    if (!data) return;

    try {
      this.economy.restore(data.capEx, data.crewHours);

      const byKey = new Map<string, Tower>();
      for (const t of data.towers) {
        if (!isValidGridNode(t.i, t.j) || !Number.isFinite(t.tier)) continue;
        const tier = Math.min(Math.max(1, Math.round(t.tier)), ECONOMY.towerMaxTier);

        const pendingMs = Number.isFinite(t.pendingMs) && t.pendingMs! > 0 ? t.pendingMs : undefined;
        const branch = t.branch === 'capacity' || t.branch === 'resilience' ? t.branch : undefined;

        const world = this.grid.nodeToWorld(t.i, t.j);
        this.grid.setOccupied(t.i, t.j);
        const tower = new Tower(t.i, t.j, world, TOWER_HEIGHT);
        tower.materializeFromSave(tier, 0, pendingMs, branch);
        this.towers.push(tower);
        this.scene.add(tower.group);
        byKey.set(`${t.i},${t.j}`, tower);
      }

      for (const s of data.spans) {
        const a = byKey.get(`${s.a[0]},${s.a[1]}`);
        const b = byKey.get(`${s.b[0]},${s.b[1]}`);
        if (!a || !b) continue;
        a.addConnection();
        b.addConnection();
        const span = new Span(a.topPos, b.topPos);
        span.materializeEnergized();
        if (s.faulted) span.fault();
        this.spans.push({ span, a, b });
        this.scene.add(span.group);
        this.spannedPairs.add([a.gridI, a.gridJ, b.gridI, b.gridJ].sort().join('|'));
      }

      if (data.camera) {
        this.cameraRig.setView(data.camera.x, data.camera.z, data.camera.zoom);
      }
    } catch {
      // Corrupted/incompatible save data — discard and continue with whatever loaded so far.
      clearSave();
    }
  }

  private tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.25);
    this.lastTick = now;

    this.cameraRig.update();
    this.updateAtmosphere(now);

    for (const tower of this.towers) {
      const event = tower.update(now);
      if (event === 'permitCleared') {
        this.sound.playPermitClear();
        this.spawnBurst(new THREE.Vector3(tower.topPos.x, 0.3, tower.topPos.z), 'dust', now);
      }
    }

    let energizedCount = 0;
    let faultCount = 0;
    for (const { span } of this.spans) {
      const event = span.update(now);
      if (event === 'energized') this.sound.playEnergize();
      else if (event === 'repaired') this.sound.playRepair();
      if (span.isEnergized()) energizedCount++;
      if (span.isFaulted()) faultCount++;
    }
    this.sound.updateFaultAlarm(now, faultCount);

    this.economy.tick(dt, energizedCount);

    if (now >= this.nextStormAt) this.triggerStorm(now);

    this.updateRain(now, dt);
    this.updateBursts(now);
    this.updateGhost(now);
    this.updateHud();

    if (now - this.lastSave > AUTOSAVE_INTERVAL_MS) {
      this.lastSave = now;
      this.save();
    }

    this.composer.render();
  };

  private onResize = (): void => {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.cameraRig.onResize();
  };
}
