import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { GradeShader } from './GradeShader';
import { ATMOSPHERE, BLACKOUT_PULSE, BLOOM, COLORS, DENY_SHAKE_DURATION_MS, ECONOMY, GRADE, GRID, MILESTONE_PULSE, NEIGHBORHOOD, NETWORK_RECOMPUTE, OBJECTIVE, PERMIT, PLANT, RAIN, SHADOW, STORM, SUBSTATION, TOWER_HEIGHT } from './constants';
import { Grid, type GridNode } from './Grid';
import { Tower, buildTowerVisual, type TowerBranch } from './Tower';
import { Span } from './Span';
import { PowerPlant, pickRandomFuelType, type FuelType } from './PowerPlant';
import { Neighborhood } from './Neighborhood';
import { Substation, buildSubstationVisual } from './Substation';
import { IsoCameraRig } from './CameraRig';
import { Economy } from './Economy';
import { Hud } from './Hud';
import { Guide } from './Guide';
import { SoundManager } from './SoundManager';
import { ParticleBurst, type BurstStyle } from './ParticleBurst';
import { denyShakeOffset } from './feedback';
import { clearSave, loadGame, saveGame, type SaveData } from './Persistence';
import { computeMaxBottleneck, isSubstationRedundant, type GraphEdge, type GraphNode, type NetworkGraph } from './network';

const AUTOSAVE_INTERVAL_MS = 3000;
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

interface SpanRecord {
  span: Span;
  a: Tower;
  b: Tower;
}

/** A milestone: a specific Plant+Neighborhood pair plus a fixed win threshold.
 * `targetDemandMW` is distinct from the Neighborhood's own live `currentDemandMW()` —
 * completion is about reaching/holding that fixed target under full redundancy, not a
 * moving goalpost (the goalpost itself only starts moving once Wave 7 adds demand
 * growth). `completedAt` is `null` while active; `performance.now()`-valued once done. */
interface Objective {
  id: string;
  plant: PowerPlant;
  neighborhood: Neighborhood;
  targetDemandMW: number;
  completedAt: number | null;
}

/** Anything that can be strung into the transmission network — Tower (existing),
 * Substation and PowerPlant (Wave 2). All three already share `topPos`/`gridI`/`gridJ`/
 * `hasFreeCapacity()`/`addConnection()`/`denyFeedback()` by construction. */
type TxNode = Tower | Substation | PowerPlant;

/** Any transmission-tier span touching a Substation and/or PowerPlant on at least one
 * end — pure Tower-Tower spans stay in `SpanRecord`/`Game.spans`, completely unchanged. */
interface TransmissionLinkRecord {
  span: Span;
  a: TxNode;
  b: TxNode;
}

/** A Substation-to-Neighborhood distribution span — at most one per Neighborhood by
 * design (see PLAN.md's topology decision). */
interface DistributionSpanRecord {
  span: Span;
  substation: Substation;
  neighborhood: Neighborhood;
}

/** Structural shape shared by every span endpoint kind, for the generalized
 * repair/upgrade-throughput deny feedback that now has to work across three different
 * record shapes (`SpanRecord`/`TransmissionLinkRecord`/`DistributionSpanRecord`). */
interface DenyableEndpoint {
  denyFeedback(): void;
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

function findPlantRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let o: THREE.Object3D | null = obj;
  while (o && !o.userData.isPlant) o = o.parent;
  return o;
}

function findNeighborhoodRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let o: THREE.Object3D | null = obj;
  while (o && !o.userData.isNeighborhood) o = o.parent;
  return o;
}

function findSubstationRoot(obj: THREE.Object3D): THREE.Object3D | null {
  let o: THREE.Object3D | null = obj;
  while (o && !o.userData.isSubstation) o = o.parent;
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
  private readonly bloomPass: UnrealBloomPass;
  private readonly vignettePass: ShaderPass;
  private readonly gradePass: ShaderPass;
  /** Set to `performance.now()` on milestone completion; `null` when no pulse is
   * active. Restarts rather than stacks if a second completion lands mid-pulse. */
  private milestonePulseStart: number | null = null;
  /** Same shape as `milestonePulseStart`, set on `blackoutStarted`. If both pulses are
   * ever active in the same frame (a milestone completing at the same instant a
   * blackout starts elsewhere), the blackout's tighten wins that frame — call order in
   * `tick()` is deliberate, and a blackout is the more urgent of the two. */
  private blackoutPulseStart: number | null = null;
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
  private readonly dayKeyColor = new THREE.Color(COLORS.keyLight);
  private readonly duskKeyColor = new THREE.Color(ATMOSPHERE.duskKeyColorHex);
  private readonly scratchSunColor = new THREE.Color();

  private readonly bursts: ParticleBurst[] = [];
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainPositions: THREE.Vector3[] = [];
  private readonly rainQuat: THREE.Quaternion;
  private rainActiveUntil: number | null = null;

  private readonly towers: Tower[] = [];
  private readonly spans: SpanRecord[] = [];
  private readonly spannedPairs = new Set<string>();
  private selectedTower: Tower | null = null;

  private readonly plants: PowerPlant[] = [];
  private readonly neighborhoods: Neighborhood[] = [];
  private readonly substations: Substation[] = [];
  private selectedPlant: PowerPlant | null = null;
  private selectedNeighborhood: Neighborhood | null = null;
  private selectedSubstation: Substation | null = null;

  private readonly transmissionLinks: TransmissionLinkRecord[] = [];
  private readonly distributionSpans: DistributionSpanRecord[] = [];
  /** Neighborhood ids with an existing distribution span — at most one per Neighborhood
   * (the plan's topology decision), mirroring `spannedPairs`'s role for transmission. */
  private readonly connectedNeighborhoods = new Set<string>();

  private readonly objectives: Objective[] = [];
  /** One scheduled-spawn timestamp per objective slot currently owed — a completion (or
   * a growing concurrency target) pushes one entry each, rather than sharing a single
   * slot that simultaneous completions would silently clobber. Not persisted, same as
   * the pre-existing `nextStormAt` precedent — a reload mid-gap just re-schedules with a
   * fresh delay via `topUpPendingObjectives`. */
  private readonly pendingRespawns: number[] = [];

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly ghost: THREE.Group;
  private readonly ghostMaterial: THREE.MeshStandardMaterial;
  private readonly substationGhost: THREE.Group;
  private readonly substationGhostMaterial: THREE.MeshStandardMaterial;
  private readonly ghostBasePos = new THREE.Vector3();
  private ghostDenyStart: number | null = null;
  private readonly container: HTMLElement;
  private lastTick = performance.now();
  private lastSave = performance.now();
  private isResetting = false;
  private nextStormAt = performance.now() + STORM.firstStrikeDelaySec * 1000;
  /** Periodic recompute independent of the discrete action-triggered ones and the 3s
   * autosave cadence — closes the staleness window generation variability/daily demand
   * cycling would otherwise leave (their inputs drift continuously, with no discrete
   * event of their own to hang a recompute off of). */
  private nextNetworkRecomputeAt = performance.now() + NETWORK_RECOMPUTE.intervalMs;
  /** The `nextStormAt` value the warning cue has already fired for — reset implicitly
   * every time `triggerStorm` reschedules `nextStormAt`, so the cue fires exactly once
   * per storm cycle rather than every frame during the warning window. */
  private lastStormWarningFor: number | null = null;
  private stormWarningActive = false;

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
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      BLOOM.strength,
      BLOOM.threshold,
      BLOOM.radius,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    // The grade pass also needs the final sRGB-encoded buffer (same reasoning as the
    // vignette below), and runs *before* the vignette so corner-darkening isn't itself
    // re-tinted by the grade.
    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.uniforms.shadowTint.value = new THREE.Color(COLORS.steelBlueDim);
    this.gradePass.uniforms.highlightTint.value = new THREE.Color(COLORS.keyLight);
    this.gradePass.uniforms.strength.value = GRADE.strength;
    this.composer.addPass(this.gradePass);
    // Vignette must come after OutputPass: it mixes toward a plain SDR grey constant,
    // which needs to happen in the final sRGB-encoded buffer, not the linear HDR one
    // upstream — mixing in linear space made a near-black scene's corners read lighter
    // than its center, the opposite of a vignette.
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.offset.value = ATMOSPHERE.vignetteOffset;
    this.vignettePass.uniforms.darkness.value = ATMOSPHERE.vignetteDarkness;
    this.composer.addPass(this.vignettePass);

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

    this.substationGhostMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.steelBlue,
      transparent: true,
      opacity: 0.35,
      roughness: 0.5,
      metalness: 0.45,
    });
    this.substationGhost = buildSubstationVisual(this.substationGhostMaterial);
    this.substationGhost.visible = false;
    this.scene.add(this.substationGhost);

    const fallDir = new THREE.Vector3(RAIN.windDriftX, -RAIN.fallSpeed, RAIN.windDriftZ).normalize();
    this.rainQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fallDir);
    this.rainMesh = this.buildRain();
    this.scene.add(this.rainMesh);

    this.loadSavedGame();
    this.spawnObjectiveEntities();
    this.recomputeNetworkState();
    this.checkObjectiveCompletions();

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

  /** Every span across all three span-bearing arrays, reduced to just what raycasting
   * and click-repair/upgrade actually need — recomputed fresh per call (cheap at this
   * entity count) rather than maintained as separate state. */
  private allSpanHits(): { span: Span; endpoints: DenyableEndpoint[] }[] {
    return [
      ...this.spans.map(({ span, a, b }) => ({ span, endpoints: [a, b] })),
      ...this.transmissionLinks.map(({ span, a, b }) => ({ span, endpoints: [a, b] })),
      ...this.distributionSpans.map(({ span, substation, neighborhood }) => ({
        span,
        endpoints: [substation, neighborhood],
      })),
    ];
  }

  private raycastSpan(): { span: Span; endpoints: DenyableEndpoint[] } | null {
    const candidates = this.allSpanHits();
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      candidates.map((c) => c.span.group),
      true,
    );
    if (!hits.length) return null;
    const root = findSpanRoot(hits[0].object);
    return candidates.find((c) => c.span.group === root) ?? null;
  }

  private raycastPlant(): PowerPlant | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      this.plants.map((p) => p.group),
      true,
    );
    if (!hits.length) return null;
    const root = findPlantRoot(hits[0].object);
    return this.plants.find((p) => p.group === root) ?? null;
  }

  private raycastNeighborhood(): Neighborhood | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      this.neighborhoods.map((n) => n.group),
      true,
    );
    if (!hits.length) return null;
    const root = findNeighborhoodRoot(hits[0].object);
    return this.neighborhoods.find((n) => n.group === root) ?? null;
  }

  private raycastSubstation(): Substation | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);
    const hits = this.raycaster.intersectObjects(
      this.substations.map((s) => s.group),
      true,
    );
    if (!hits.length) return null;
    const root = findSubstationRoot(hits[0].object);
    return this.substations.find((s) => s.group === root) ?? null;
  }

  /** Base tower cost gains mild linear growth per already-placed tower, on top of the
   * terrain multiplier — expansion gets steadily pricier without being punishing. */
  private computeTowerCost(node: GridNode): number {
    const growth = 1 + this.towers.length * ECONOMY.towerCostGrowthPerTower;
    return Math.round(ECONOMY.towerCost * growth * this.grid.towerCostMultiplier(node.i, node.j));
  }

  private computeSubstationCost(node: GridNode): number {
    return Math.round(SUBSTATION.cost * this.grid.towerCostMultiplier(node.i, node.j));
  }

  /** Plain click previews/places a Tower; `Shift`+click previews/places a Substation —
   * the modifier plays the same "heavier, rarer action" role `Shift+R` already does for
   * reset, so the common case (plain click) stays exactly as simple as before. */
  private onPointerMove = (e: MouseEvent): void => {
    this.updateNdc(e);
    const node = this.raycastGroundNode();
    if (node && this.grid.isBuildable(node.i, node.j)) {
      this.ghostBasePos.copy(node.world);
      if (e.shiftKey) {
        this.ghost.visible = false;
        this.substationGhost.visible = true;
        const cost = this.computeSubstationCost(node);
        this.substationGhostMaterial.opacity = this.economy.canAfford(cost, 0) ? 0.35 : 0.15;
      } else {
        this.substationGhost.visible = false;
        this.ghost.visible = true;
        const cost = this.computeTowerCost(node);
        this.ghostMaterial.opacity = this.economy.canAfford(cost, 0) ? 0.35 : 0.15;
      }
    } else {
      this.ghost.visible = false;
      this.substationGhost.visible = false;
    }
  };

  private onClick = (e: MouseEvent): void => {
    this.updateNdc(e);

    const tower = this.raycastTower();
    if (tower) {
      this.handleTowerClick(tower);
      return;
    }

    const spanHit = this.raycastSpan();
    if (spanHit) {
      if (spanHit.span.isFaulted()) this.tryRepairSpan(spanHit.span, spanHit.endpoints);
      else if (spanHit.span.isEnergized()) this.tryUpgradeSpanThroughput(spanHit.span, spanHit.endpoints);
      return;
    }

    const plant = this.raycastPlant();
    if (plant) {
      this.handlePlantClick(plant);
      return;
    }

    const neighborhood = this.raycastNeighborhood();
    if (neighborhood) {
      this.handleNeighborhoodClick(neighborhood);
      return;
    }

    const substation = this.raycastSubstation();
    if (substation) {
      this.handleSubstationClick(substation);
      return;
    }

    const node = this.raycastGroundNode();
    if (node && this.grid.isBuildable(node.i, node.j)) {
      if (e.shiftKey) {
        this.tryPlaceSubstation(node);
      } else {
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

    if (key === 'q') {
      this.cameraRig.rotate(-1);
      return;
    }
    if (key === 'e') {
      this.cameraRig.rotate(1);
      return;
    }

    if (this.selectedSubstation) {
      if (key === 'u') this.handleSubstationUpgradeKey(this.selectedSubstation);
      return;
    }

    if (!this.selectedTower || (key !== 'u' && key !== 'i')) return;
    this.handleUpgradeKey(this.selectedTower, key === 'u' ? 'capacity' : 'resilience');
  };

  /** `U` is the Substation's only upgrade path — no branch choice, so no `I` handler
   * (mirrors Tower's universal tier 1→2 step's shape, not its branching tier 2→3). */
  private handleSubstationUpgradeKey(substation: Substation): void {
    if (!substation.canUpgrade()) {
      substation.denyFeedback();
      this.sound.playDeny();
      return;
    }
    const cost = SUBSTATION.upgradeCost;
    if (!this.economy.canAfford(cost.capEx, cost.crewHours)) {
      substation.denyFeedback();
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost.capEx, cost.crewHours);
    substation.upgrade();
    this.sound.playUpgrade(substation.getTier());
    this.save();
  }

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

  /** Shift-click on buildable ground places a Substation instead of a Tower — see
   * `onPointerMove`'s comment for why Shift is the chosen modifier. */
  private tryPlaceSubstation(node: GridNode): void {
    const cost = this.computeSubstationCost(node);
    if (!this.economy.canAfford(cost, 0)) {
      this.ghostDenyStart = performance.now();
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost, 0);
    this.grid.setOccupied(node.i, node.j);
    const substation = new Substation(node.i, node.j, node.world, PERMIT.pendingDurationSec * 1000);
    this.substations.push(substation);
    this.scene.add(substation.group);
    this.sound.playPlace();
    this.spawnBurst(node.world.clone().setY(0.3), 'dust', performance.now());
    this.save();
  }

  /** Deterministic search for the nearest flat, buildable, unoccupied node to a target —
   * used to place the Wave 1 hardcoded Plant/Neighborhood pair without risking a spawn on
   * water/rough terrain or atop an already-loaded tower/substation. No randomness, so the
   * same save always resolves to the same spawn point (matching the terrain's own
   * "no seed, deterministic" discipline). */
  private findBuildableNear(targetI: number, targetJ: number): GridNode {
    for (let r = 0; r <= GRID.cells; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = targetI + di;
          const j = targetJ + dj;
          if (!isValidGridNode(i, j)) continue;
          if (this.grid.terrainAt(i, j) !== 'flat') continue;
          if (this.grid.isOccupied(i, j)) continue;
          return { i, j, world: this.grid.nodeToWorld(i, j) };
        }
      }
    }
    return { i: targetI, j: targetJ, world: this.grid.nodeToWorld(targetI, targetJ) };
  }

  /** Creates a new Plant+Neighborhood pair plus the `Objective` record wrapping them —
   * the one place both the initial spawn and every later respawn build a real, playable
   * milestone, so the two call sites below can't drift apart. */
  private createObjective(
    plantNode: GridNode,
    neighborhoodNode: GridNode,
    fuelType: FuelType,
    targetDemandMW: number,
  ): void {
    this.grid.setOccupied(plantNode.i, plantNode.j);
    const plant = new PowerPlant(plantNode.i, plantNode.j, plantNode.world, fuelType);
    this.plants.push(plant);
    this.scene.add(plant.group);

    this.grid.setOccupied(neighborhoodNode.i, neighborhoodNode.j);
    const neighborhood = new Neighborhood(neighborhoodNode.i, neighborhoodNode.j, neighborhoodNode.world);
    this.neighborhoods.push(neighborhood);
    this.scene.add(neighborhood.group);

    this.objectives.push({
      id: `objective-${this.objectives.length}-${plant.id}`,
      plant,
      neighborhood,
      targetDemandMW,
      completedAt: null,
    });
  }

  /** One hardcoded Plant+Neighborhood pair, spawned at deterministic, well-separated
   * corners of the board — only on a truly fresh game. Once transmission/distribution
   * links can reference a Plant/Neighborhood by identity (Wave 2), a fresh respawn every
   * load is no longer safe (a link's persisted `[i,j]`/id could point at nothing, or the
   * wrong thing) — `loadSavedGame()` restores a persisted pair instead, and this only
   * runs when nothing was loaded (`this.plants.length === 0`). Must run after
   * `loadSavedGame()` regardless, so the search correctly avoids cells an existing save
   * already occupies. */
  private spawnObjectiveEntities(): void {
    if (this.plants.length > 0 || this.neighborhoods.length > 0) return;
    const plantNode = this.findBuildableNear(4, 4);
    const neighborhoodNode = this.findBuildableNear(16, 16);
    this.createObjective(plantNode, neighborhoodNode, 'gas', this.nextObjectiveTargetDemandMW());
  }

  /** The concurrency ceiling — how many objectives are allowed to be active
   * simultaneously right now — derived purely from how many have ever been completed,
   * no separate persisted field. Growing-N: starts at 1 (identical to the original
   * single-objective experience), gains a slot every
   * `OBJECTIVE.objectivesPerConcurrencyStep` completions, capped at
   * `OBJECTIVE.maxConcurrentObjectives`. */
  private activeObjectiveTarget(): number {
    const completedCount = this.objectives.reduce((count, o) => count + (o.completedAt !== null ? 1 : 0), 0);
    return Math.min(
      1 + Math.floor(completedCount / OBJECTIVE.objectivesPerConcurrencyStep),
      OBJECTIVE.maxConcurrentObjectives,
    );
  }

  /** Mild escalation per objective ever created (active or completed), capped well
   * under both `NEIGHBORHOOD.demandGrowthCapMW` and `ECONOMY.spanCapacityMW`'s top tier
   * so no objective can ever become mathematically unwinnable. */
  private nextObjectiveTargetDemandMW(): number {
    return Math.min(
      NEIGHBORHOOD.startingDemandMW + this.objectives.length * OBJECTIVE.targetEscalationPerObjective,
      OBJECTIVE.maxTargetDemandMW,
    );
  }

  /** True iff `(i, j)` keeps at least `OBJECTIVE.minPairSeparationCells` (Chebyshev)
   * distance from every existing Plant/Neighborhood — so concurrent pairs don't crowd
   * into visually/topologically degenerate placements as concurrency grows. */
  private isFarEnoughFromExistingObjectives(i: number, j: number): boolean {
    const minSep = OBJECTIVE.minPairSeparationCells;
    for (const plant of this.plants) {
      if (Math.max(Math.abs(plant.gridI - i), Math.abs(plant.gridJ - j)) < minSep) return false;
    }
    for (const neighborhood of this.neighborhoods) {
      if (Math.max(Math.abs(neighborhood.gridI - i), Math.abs(neighborhood.gridJ - j)) < minSep) return false;
    }
    return true;
  }

  /** A new objective after a previous one completes (or to top up toward a newly grown
   * concurrency target) — a fresh, randomized location and a semi-random fuel type.
   * Retries a bounded number of times against `isFarEnoughFromExistingObjectives`
   * before falling back to whatever candidate was found last — placement always
   * succeeds, it just prefers spacing when it can get it. */
  private spawnNextObjective(): void {
    let plantNode: GridNode = this.findBuildableNear(0, 0);
    let neighborhoodNode: GridNode = this.findBuildableNear(GRID.cells, GRID.cells);
    for (let attempt = 0; attempt < OBJECTIVE.maxPlacementRetries; attempt++) {
      const plantI = Math.floor(Math.random() * (GRID.cells + 1));
      const plantJ = Math.floor(Math.random() * (GRID.cells + 1));
      const neighborhoodI = GRID.cells - plantI;
      const neighborhoodJ = GRID.cells - plantJ;

      plantNode = this.findBuildableNear(plantI, plantJ);
      neighborhoodNode = this.findBuildableNear(neighborhoodI, neighborhoodJ);
      if (
        this.isFarEnoughFromExistingObjectives(plantNode.i, plantNode.j) &&
        this.isFarEnoughFromExistingObjectives(neighborhoodNode.i, neighborhoodNode.j)
      ) {
        break;
      }
    }
    this.createObjective(plantNode, neighborhoodNode, pickRandomFuelType(), this.nextObjectiveTargetDemandMW());
  }

  /** If fewer objectives are active-or-already-scheduled than the current concurrency
   * target allows, queue up the shortfall. Covers both the common case (a completion
   * freed a slot) and the growth case (the target itself just increased, e.g. right
   * after the completion that crossed an `objectivesPerConcurrencyStep` threshold),
   * without double-scheduling when nothing changed. */
  private topUpPendingObjectives(now: number): void {
    const activeCount = this.objectives.reduce((count, o) => count + (o.completedAt === null ? 1 : 0), 0);
    const shortfall = this.activeObjectiveTarget() - activeCount - this.pendingRespawns.length;
    for (let i = 0; i < shortfall; i++) {
      this.pendingRespawns.push(now + OBJECTIVE.respawnDelaySec * 1000);
    }
  }

  /** Checked from `save()`, right after `recomputeNetworkState()` so served/redundant
   * state is fresh. Completion requires all three: the Neighborhood's live demand has
   * reached the fixed target, it's currently served, and currently redundant (decisions
   * #1 and #6) — a one-shot celebration fires exactly once per objective (guarded by
   * `completedAt !== null` skipping already-completed ones). Each completion queues its
   * own respawn slot (`pendingRespawns`) rather than sharing one — two objectives
   * completing in the same tick must not silently clobber each other's scheduled
   * replacement. */
  private checkObjectiveCompletions(): void {
    const now = performance.now();
    for (const objective of this.objectives) {
      if (objective.completedAt !== null) continue;
      const { neighborhood, targetDemandMW } = objective;
      if (neighborhood.currentDemandMW() >= targetDemandMW && neighborhood.isServed() && neighborhood.isRedundant()) {
        objective.completedAt = now;
        this.sound.playMilestoneComplete();
        this.spawnBurst(neighborhood.attachPos.clone().setY(0.5), 'celebrate', now);
        this.milestonePulseStart = now;
        this.pendingRespawns.push(now + OBJECTIVE.respawnDelaySec * 1000);
      }
    }
    this.topUpPendingObjectives(now);
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

    // A Substation or Plant selected from a *different* click is a pending transmission
    // link partner — checked before the Tower-Tower flow below, which stays completely
    // untouched (same `tryStringSpan` call it always used).
    if (this.selectedSubstation) {
      if (this.tryLinkTransmission(this.selectedSubstation, tower)) this.save();
      this.deselect();
      return;
    }
    if (this.selectedPlant) {
      if (this.tryLinkTransmission(this.selectedPlant, tower)) this.save();
      this.deselect();
      return;
    }

    if (!this.selectedTower) {
      this.deselect();
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

  private handleSubstationClick(substation: Substation): void {
    if (substation.isPending()) {
      substation.denyFeedback();
      this.sound.playDeny();
      return;
    }

    if (this.selectedSubstation === substation) {
      this.deselect();
      return;
    }

    if (this.selectedTower) {
      if (this.tryLinkTransmission(this.selectedTower, substation)) this.save();
      this.deselect();
      return;
    }
    if (this.selectedPlant) {
      if (this.tryLinkTransmission(this.selectedPlant, substation)) this.save();
      this.deselect();
      return;
    }

    this.deselect();
    this.selectedSubstation = substation;
    substation.setSelected(true);
    this.sound.playSelect();
  }

  private handlePlantClick(plant: PowerPlant): void {
    if (this.selectedPlant === plant) {
      this.deselect();
      return;
    }

    if (this.selectedTower) {
      if (this.tryLinkTransmission(this.selectedTower, plant)) this.save();
      this.deselect();
      return;
    }
    if (this.selectedSubstation) {
      if (this.tryLinkTransmission(this.selectedSubstation, plant)) this.save();
      this.deselect();
      return;
    }

    this.deselect();
    this.selectedPlant = plant;
    plant.setSelected(true);
    this.sound.playSelect();
  }

  private handleNeighborhoodClick(neighborhood: Neighborhood): void {
    // A selected Substation targeting an unconnected Neighborhood strings a
    // distribution span — the one new click-flow Wave 2 actually adds, per PLAN.md.
    if (this.selectedSubstation) {
      if (this.tryStringDistributionSpan(this.selectedSubstation, neighborhood)) this.save();
      this.deselect();
      return;
    }

    const wasSelected = this.selectedNeighborhood === neighborhood;
    this.deselect();
    if (!wasSelected) {
      this.selectedNeighborhood = neighborhood;
      neighborhood.setSelected(true);
      this.sound.playSelect();
    }
  }

  /** Stringing a span across rough terrain costs more Crew-Hours, not just more for raw
   * distance — mirrors `Grid.towerCostMultiplier`'s hill/marsh treatment but with its
   * own (smaller) multipliers since this scales a variable, distance-based Crew-Hours
   * cost rather than a flat one-time CapEx cost. Takes the higher of the two endpoints'
   * multipliers, not stacked — a span is as hard to string as its harder end. Widened to
   * `TxNode` (was `Tower`) in Wave 2 so `tryLinkTransmission` can reuse it unchanged —
   * every `TxNode` already exposes `gridI`/`gridJ`. */
  private spanTerrainMultiplier(a: TxNode, b: TxNode): number {
    const factor = (node: TxNode): number => {
      const terrain = this.grid.terrainAt(node.gridI, node.gridJ);
      if (terrain === 'marsh') return ECONOMY.spanMarshMultiplier;
      if (terrain === 'hill') return ECONOMY.spanHillMultiplier;
      return 1;
    };
    return Math.max(factor(a), factor(b));
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
    const crewCost =
      (ECONOMY.spanCostBase + distance * ECONOMY.spanCostPerUnitDistance) * this.spanTerrainMultiplier(a, b);
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

  /** Same cost-gating shape as `tryStringSpan`, generalized to accept a Substation or
   * PowerPlant on either side — links a Tower/Substation/Plant into the wider
   * transmission network. Kept as a separate method (rather than widening
   * `tryStringSpan`'s signature) so the original, heavily-verified Tower-Tower path
   * above stays byte-for-byte unchanged. */
  private tryLinkTransmission(a: TxNode, b: TxNode): boolean {
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
    const crewCost =
      (ECONOMY.spanCostBase + distance * ECONOMY.spanCostPerUnitDistance) * this.spanTerrainMultiplier(a, b);
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
    this.transmissionLinks.push({ span, a, b });
    this.scene.add(span.group);
    return true;
  }

  /** The one genuinely new click-flow Wave 2 adds: select a Substation, click an
   * unconnected Neighborhood. At most one distribution span per Neighborhood (the
   * plan's topology decision) — enforced via `connectedNeighborhoods`, mirroring
   * `spannedPairs`'s role for transmission links. */
  private tryStringDistributionSpan(substation: Substation, neighborhood: Neighborhood): boolean {
    if (this.connectedNeighborhoods.has(neighborhood.id)) {
      substation.denyFeedback();
      neighborhood.denyFeedback();
      this.sound.playDeny();
      return false;
    }
    if (!substation.hasFreeCapacity()) {
      substation.denyFeedback();
      this.sound.playDeny();
      return false;
    }

    const distance = substation.distPos.distanceTo(neighborhood.attachPos);
    const crewCost = SUBSTATION.distributionSpanCostBase + distance * SUBSTATION.distributionSpanCostPerUnitDistance;
    if (!this.economy.canAfford(0, crewCost)) {
      substation.denyFeedback();
      neighborhood.denyFeedback();
      this.sound.playDeny();
      return false;
    }

    this.connectedNeighborhoods.add(neighborhood.id);
    this.economy.spend(0, crewCost);
    substation.addConnection();

    const span = new Span(substation.distPos, neighborhood.attachPos, 'distribution');
    this.distributionSpans.push({ span, substation, neighborhood });
    this.scene.add(span.group);
    return true;
  }

  /** `endpoints` generalizes over `SpanRecord`'s `{a, b}` (both Tower),
   * `TransmissionLinkRecord`'s `{a, b}` (both `TxNode`), and `DistributionSpanRecord`'s
   * `{substation, neighborhood}` — every endpoint kind already implements
   * `denyFeedback()`, so this works unchanged across all three span sources. */
  private tryRepairSpan(span: Span, endpoints: DenyableEndpoint[]): void {
    const cost = STORM.repairCost;
    if (!this.economy.canAfford(cost.capEx, cost.crewHours)) {
      endpoints.forEach((e) => e.denyFeedback());
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost.capEx, cost.crewHours);
    span.repair();
    this.save();
  }

  /** Clicking a healthy (energized, non-faulted) line tries to upgrade its throughput
   * tier — same directness as clicking a faulted one to repair, no separate select
   * step. Denies (shaking every endpoint, same as every other span-level deny) at max
   * tier or if unaffordable. */
  private tryUpgradeSpanThroughput(span: Span, endpoints: DenyableEndpoint[]): void {
    if (!span.canUpgradeThroughput()) {
      endpoints.forEach((e) => e.denyFeedback());
      this.sound.playDeny();
      return;
    }
    const cost = ECONOMY.spanThroughputCost[span.getThroughputTier() - 1];
    if (!this.economy.canAfford(cost.capEx, cost.crewHours)) {
      endpoints.forEach((e) => e.denyFeedback());
      this.sound.playDeny();
      return;
    }
    this.economy.spend(cost.capEx, cost.crewHours);
    span.upgradeThroughput();
    this.sound.playUpgrade(span.getThroughputTier());
    this.save();
  }

  /** All energized spans across all three arrays are storm-strike candidates — expanded
   * in Wave 5 from the original Tower-Tower-only pool, since a blackout can only ever
   * happen as a consequence of a storm actually being able to reach a transmission link
   * or distribution span. `a`/`b` only need `gridI`/`gridJ` (terrain weighting) and an
   * optional Tower-specific resilience check below — every endpoint kind here already
   * has the former, `instanceof Tower` handles the latter. */
  private stormCandidates(): { span: Span; a: TxNode | Neighborhood; b: TxNode | Neighborhood }[] {
    return [
      ...this.spans.filter(({ span }) => span.isEnergized()).map(({ span, a, b }) => ({ span, a, b })),
      ...this.transmissionLinks.filter(({ span }) => span.isEnergized()).map(({ span, a, b }) => ({ span, a, b })),
      ...this.distributionSpans
        .filter(({ span }) => span.isEnergized())
        .map(({ span, substation, neighborhood }) => ({ span, a: substation, b: neighborhood })),
    ];
  }

  /** A span with at least one endpoint on marsh (wet/unstable ground) is more likely to
   * be picked as a storm's target — terrain-weighted, not uniform. A span with at least
   * one Resilience-branch tier-3 Tower endpoint is less likely, applied multiplicatively
   * on top (a resilient tower on marsh is safer than average, not immune). */
  private spanStormWeight(candidate: { a: TxNode | Neighborhood; b: TxNode | Neighborhood }): number {
    const aMarsh = this.grid.terrainAt(candidate.a.gridI, candidate.a.gridJ) === 'marsh';
    const bMarsh = this.grid.terrainAt(candidate.b.gridI, candidate.b.gridJ) === 'marsh';
    let weight = aMarsh || bMarsh ? STORM.marshWeightMultiplier : 1;

    const isResilientTower = (node: TxNode | Neighborhood): boolean =>
      node instanceof Tower && node.getTier() === 3 && node.getBranch() === 'resilience';
    if (isResilientTower(candidate.a) || isResilientTower(candidate.b)) {
      weight *= STORM.resilienceWeightMultiplier;
    }

    return weight;
  }

  private pickWeightedStormTarget<T extends { a: TxNode | Neighborhood; b: TxNode | Neighborhood }>(
    candidates: T[],
  ): T {
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
    const candidates = this.stormCandidates();
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

  /** Fires the warning cue exactly once per storm cycle, `STORM.warningLeadSec` before
   * the check — a heads-up that a storm check is imminent, not a guarantee anything
   * will actually be struck (that's still gated on `minEnergizedSpansToStrike` inside
   * `triggerStorm`, and the weighted target isn't picked until then either). Must run
   * before `triggerStorm` reschedules `nextStormAt` in the same tick, since it reads
   * the *current* value. */
  private updateStormWarning(now: number): void {
    this.stormWarningActive = now >= this.nextStormAt - STORM.warningLeadSec * 1000;
    if (this.stormWarningActive && this.lastStormWarningFor !== this.nextStormAt) {
      this.lastStormWarningFor = this.nextStormAt;
      this.sound.playStormWarning();
    }
  }

  private deselect(): void {
    if (this.selectedTower) {
      this.selectedTower.setSelected(false);
      this.selectedTower = null;
    }
    if (this.selectedSubstation) {
      this.selectedSubstation.setSelected(false);
      this.selectedSubstation = null;
    }
    if (this.selectedPlant) {
      this.selectedPlant.setSelected(false);
      this.selectedPlant = null;
    }
    if (this.selectedNeighborhood) {
      this.selectedNeighborhood.setSelected(false);
      this.selectedNeighborhood = null;
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

    // Dusk-only sun color shift: peaks exactly at the day/night crossover (dayFactor
    // near 0.5, where the intensity lerp is already swinging fastest) and returns to the
    // plain daytime hue everywhere else — a three-point color lerp layered on top of the
    // existing two-point intensity lerp, not a full day-to-night hue change.
    const duskFactor = Math.max(0, 1 - Math.abs(dayFactor - 0.5) * 2);
    this.scratchSunColor.copy(this.dayKeyColor).lerp(this.duskKeyColor, duskFactor);
    this.sunLight.color.copy(this.scratchSunColor);
  }

  /** No-op unless `milestonePulseStart` is set (same idiom as every other one-shot
   * timed effect in this file). Linearly decays the boost back to zero over
   * `MILESTONE_PULSE.durationMs`, added on top of whatever `BLOOM`/`ATMOSPHERE`'s named
   * baseline constants currently are — never a hardcoded snapshot, so a later bloom or
   * vignette retune still composes correctly with the pulse. */
  private updateMilestonePulse(now: number): void {
    if (this.milestonePulseStart === null) return;
    const t = (now - this.milestonePulseStart) / MILESTONE_PULSE.durationMs;
    const decay = Math.max(0, 1 - t);
    this.bloomPass.strength = BLOOM.strength + MILESTONE_PULSE.bloomStrengthBoost * decay;
    this.vignettePass.uniforms.offset.value = ATMOSPHERE.vignetteOffset + MILESTONE_PULSE.vignetteOffsetDelta * decay;
    this.vignettePass.uniforms.darkness.value =
      ATMOSPHERE.vignetteDarkness + MILESTONE_PULSE.vignetteDarknessDelta * decay;
    if (t >= 1) this.milestonePulseStart = null;
  }

  /** Same no-op-unless-active idiom, inverted: eases the vignette *tighter* than
   * baseline rather than opening it — see `BLACKOUT_PULSE`'s comment for why this is
   * vignette-only (no bloom boost). Called after `updateMilestonePulse` in `tick()` so
   * a blackout's tighten deliberately wins if both are ever active in the same frame. */
  private updateBlackoutPulse(now: number): void {
    if (this.blackoutPulseStart === null) return;
    const t = (now - this.blackoutPulseStart) / BLACKOUT_PULSE.durationMs;
    const decay = Math.max(0, 1 - t);
    this.vignettePass.uniforms.offset.value = ATMOSPHERE.vignetteOffset + BLACKOUT_PULSE.vignetteOffsetDelta * decay;
    this.vignettePass.uniforms.darkness.value =
      ATMOSPHERE.vignetteDarkness + BLACKOUT_PULSE.vignetteDarknessDelta * decay;
    if (t >= 1) this.blackoutPulseStart = null;
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

  /** Both ghosts share one base position and one deny-shake timer — only one is ever
   * visible at a time (toggled in `onPointerMove` by Shift state), so applying the same
   * shake to both is harmless and avoids needing a second deny-timer field. */
  private updateGhost(now: number): void {
    let shakeX = 0;
    if (this.ghostDenyStart !== null) {
      const elapsed = now - this.ghostDenyStart;
      shakeX = denyShakeOffset(elapsed);
      if (elapsed >= DENY_SHAKE_DURATION_MS) this.ghostDenyStart = null;
    }
    this.ghost.position.copy(this.ghostBasePos);
    this.ghost.position.x += shakeX;
    this.substationGhost.position.copy(this.ghostBasePos);
    this.substationGhost.position.x += shakeX;
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
    } else if (this.selectedSubstation) {
      const substation = this.selectedSubstation;
      const upgradeNote = substation.canUpgrade()
        ? ` · [U] UPGRADE TO T2 — $${SUBSTATION.upgradeCost.capEx}/${SUBSTATION.upgradeCost.crewHours}h`
        : ' · MAX TIER';
      context =
        `SUBSTATION T${substation.getTier()} SELECTED (${substation.capacityMW()} MW) ·` +
        ' CLICK A TOWER/PLANT TO LINK, OR A NEIGHBORHOOD TO CONNECT DISTRIBUTION' +
        upgradeNote;
    } else if (this.selectedPlant) {
      const plant = this.selectedPlant;
      context =
        `PLANT (${plant.fuelType.toUpperCase()}) SELECTED · ${Math.round(plant.nameplateCapacityMW)} MW NAMEPLATE` +
        ` · ${Math.round(plant.effectiveCapacityMW())} MW EFFECTIVE · CLICK A TOWER/SUBSTATION TO LINK`;
    } else if (this.selectedNeighborhood) {
      context = `NEIGHBORHOOD SELECTED · ${Math.round(this.selectedNeighborhood.currentDemandMW())} MW DEMAND`;
    }
    const faultCount =
      this.spans.reduce((count, { span }) => count + (span.isFaulted() ? 1 : 0), 0) +
      this.transmissionLinks.reduce((count, { span }) => count + (span.isFaulted() ? 1 : 0), 0) +
      this.distributionSpans.reduce((count, { span }) => count + (span.isFaulted() ? 1 : 0), 0);
    this.hud.update({
      capEx: this.economy.capEx,
      crewHours: this.economy.crewHours,
      crewHoursMax: this.economy.crewHoursMax,
      context,
      faultCount,
      repairCapEx: STORM.repairCost.capEx,
      repairCrewHours: STORM.repairCost.crewHours,
      hint: this.computeOnboardingHint(),
      stormWarning: this.stormWarningActive,
      blackoutCount: this.neighborhoods.reduce((count, n) => count + (n.isBlackedOut() ? 1 : 0), 0),
      capacityWarningCount: this.neighborhoods.reduce((count, n) => count + (n.isCapacityWarningActive() ? 1 : 0), 0),
      objectiveStatus: this.computeObjectiveStatus(),
      completedObjectives: this.objectives.reduce((count, o) => count + (o.completedAt !== null ? 1 : 0), 0),
    });
  }

  /** Ranks an active objective's urgency for the single-detail HUD line — blacked out
   * is most urgent, fully served-and-redundant (about to complete) is least. Lower is
   * more urgent. */
  private objectiveUrgencyRank(objective: Objective): number {
    const { neighborhood } = objective;
    if (neighborhood.isBlackedOut()) return 0;
    if (!neighborhood.isServed()) return 1;
    if (!neighborhood.isRedundant()) return 2;
    return 3;
  }

  /** Aggregate count + single most-urgent detail line — matches the existing
   * `faultCount`/`blackoutCount` precedent exactly (a count, never a per-item list),
   * so the HUD stays a meter rather than growing a menu as concurrency increases.
   * Blank during the brief respawn gap right after every objective completes. */
  private computeObjectiveStatus(): string {
    const active = this.objectives.filter((o) => o.completedAt === null);
    if (active.length === 0) return '';
    const mostUrgent = active.reduce((best, o) =>
      this.objectiveUrgencyRank(o) < this.objectiveUrgencyRank(best) ? o : best,
    );
    const { neighborhood, targetDemandMW } = mostUrgent;
    const parts = [
      active.length > 1 ? `${active.length} ACTIVE MILESTONES` : 'MILESTONE',
      `${Math.round(neighborhood.currentDemandMW())}/${Math.round(targetDemandMW)} MW`,
    ];
    if (neighborhood.isBlackedOut()) parts.push('BLACKED OUT');
    else if (!neighborhood.isServed()) parts.push('NOT SERVED');
    else if (!neighborhood.isRedundant()) parts.push('SERVED · NEEDS REDUNDANCY TO COMPLETE');
    else parts.push('SERVED · REDUNDANT');
    return parts.join(' · ');
  }

  /** A stable id per transmission-capable node, synthesized from grid coordinates for
   * Tower/Substation (which have no persistent `id` field of their own — Wave 3 doesn't
   * otherwise need one) and reusing Plant's existing `id` directly. */
  private txNodeId(node: TxNode): string {
    if (node instanceof PowerPlant) return node.id;
    return `${node instanceof Substation ? 'substation' : 'tower'}-${node.gridI}-${node.gridJ}`;
  }

  /** Translates the live scene entities into the plain, scene-independent graph shape
   * `network.ts`'s pure functions read — the only place that crosses that boundary.
   * Only energized, non-faulted spans become edges (`Span.isEnergized()` is already
   * exactly "energized and not faulted"). */
  private buildNetworkGraph(): NetworkGraph {
    const nodes: GraphNode[] = [
      ...this.plants.map((p): GraphNode => ({ id: p.id, kind: 'plant', capacityMW: p.effectiveCapacityMW() })),
      ...this.towers.map((t): GraphNode => ({ id: this.txNodeId(t), kind: 'tower', capacityMW: Infinity })),
      ...this.substations.map((s): GraphNode => ({
        id: this.txNodeId(s),
        kind: 'substation',
        capacityMW: s.capacityMW(),
      })),
      ...this.neighborhoods.map((n): GraphNode => ({ id: n.id, kind: 'neighborhood', capacityMW: Infinity })),
    ];

    const edges: GraphEdge[] = [];
    const capacityForTier = (tier: number): number => ECONOMY.spanCapacityMW[tier - 1];
    for (const { a, b, span } of this.spans) {
      if (!span.isEnergized()) continue;
      edges.push({
        a: this.txNodeId(a),
        b: this.txNodeId(b),
        kind: 'transmission',
        capacityMW: capacityForTier(span.getThroughputTier()),
      });
    }
    for (const { a, b, span } of this.transmissionLinks) {
      if (!span.isEnergized()) continue;
      edges.push({
        a: this.txNodeId(a),
        b: this.txNodeId(b),
        kind: 'transmission',
        capacityMW: capacityForTier(span.getThroughputTier()),
      });
    }
    for (const { substation, neighborhood, span } of this.distributionSpans) {
      if (!span.isEnergized()) continue;
      edges.push({
        a: this.txNodeId(substation),
        b: neighborhood.id,
        kind: 'distribution',
        capacityMW: capacityForTier(span.getThroughputTier()),
      });
    }

    return { nodes, edges };
  }

  /** Recomputes demand-met and N-1 redundancy for every Neighborhood — cheap at this
   * entity count, so it's fine to call on every discrete board-changing action rather
   * than maintaining a dirty flag (see PLAN.md's Wave 3 section). No visual/economy
   * consequence yet; purely internal state (`Neighborhood.setNetworkState`) that later
   * waves (revenue, blackout, milestones) will read. */
  private recomputeNetworkState(): void {
    const graph = this.buildNetworkGraph();
    const bottleneck = computeMaxBottleneck(
      graph,
      this.plants.map((p) => p.id),
    );

    // N-1 redundancy is computed once per Substation and shared by every Neighborhood
    // hanging off it — cacheable since it depends only on the Substation's own upstream
    // transmission topology, not which Neighborhood is asking (PLAN.md's topology note).
    const redundancyCache = new Map<string, boolean>();
    const isRedundant = (substationNodeId: string): boolean => {
      if (!redundancyCache.has(substationNodeId)) {
        redundancyCache.set(substationNodeId, isSubstationRedundant(graph, substationNodeId));
      }
      return redundancyCache.get(substationNodeId)!;
    };

    for (const neighborhood of this.neighborhoods) {
      const bottleneckMW = bottleneck.get(neighborhood.id) ?? 0;
      const served = bottleneckMW >= neighborhood.currentDemandMW();

      const distributionRecord = this.distributionSpans.find((d) => d.neighborhood === neighborhood);
      const redundant = distributionRecord ? isRedundant(this.txNodeId(distributionRecord.substation)) : false;

      // setNetworkState is purely derived — it never originates a blackout on its own,
      // only classifies the consequence of whatever already changed the graph (almost
      // always a storm fault, which has already played its own strike sound by the time
      // this runs — no second sound here to avoid double-triggering audio for one
      // event). No new strike mechanism, no new timer/probability surface — this is the
      // invariant the softlock-prevention re-check below confirms stays intact.
      const event = neighborhood.setNetworkState(served, redundant, bottleneckMW);
      if (event === 'blackoutStarted') {
        const now = performance.now();
        this.spawnBurst(neighborhood.attachPos.clone().setY(0.3), 'blackout', now);
        this.blackoutPulseStart = now;
      }
    }

    // "This thing has power" glow (Wave 1 of the models/graphics pass) — a Tower/
    // Substation glows iff at least one connected span is currently energized, across
    // every span-bearing array that could touch it.
    for (const tower of this.towers) {
      const hasEnergizedLink =
        this.spans.some((r) => (r.a === tower || r.b === tower) && r.span.isEnergized()) ||
        this.transmissionLinks.some((r) => (r.a === tower || r.b === tower) && r.span.isEnergized());
      tower.setEnergizedGlow(hasEnergizedLink);
    }
    for (const substation of this.substations) {
      const hasEnergizedLink =
        this.transmissionLinks.some((r) => (r.a === substation || r.b === substation) && r.span.isEnergized()) ||
        this.distributionSpans.some((r) => r.substation === substation && r.span.isEnergized());
      substation.setEnergizedGlow(hasEnergizedLink);
    }
  }

  private save = (): void => {
    if (this.isResetting) return;
    this.recomputeNetworkState();
    this.checkObjectiveCompletions();
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
        throughputTier: span.getThroughputTier(),
      })),
      substations: this.substations.map((s) => ({
        i: s.gridI,
        j: s.gridJ,
        pendingMs: s.getPendingRemainingMs() ?? undefined,
        tier: s.getTier(),
      })),
      plants: this.plants.map((p) => ({ id: p.id, i: p.gridI, j: p.gridJ, fuelType: p.fuelType })),
      neighborhoods: this.neighborhoods.map((n) => ({
        id: n.id,
        i: n.gridI,
        j: n.gridJ,
        // The raw base, not the cycled `currentDemandMW()` — a reload at a different
        // cycle phase must not compound the daily cycle on top of itself.
        demandMW: n.rawDemandMW(),
      })),
      transmissionLinks: this.transmissionLinks.map(({ a, b, span }) => ({
        a: [a.gridI, a.gridJ] as [number, number],
        b: [b.gridI, b.gridJ] as [number, number],
        faulted: span.isFaulted(),
        throughputTier: span.getThroughputTier(),
      })),
      objectives: this.objectives.map((o) => ({
        id: o.id,
        plantId: o.plant.id,
        neighborhoodId: o.neighborhood.id,
        targetDemandMW: o.targetDemandMW,
        completedAt: o.completedAt ?? undefined,
      })),
      distributionSpans: this.distributionSpans.map(({ substation, neighborhood, span }) => ({
        substation: [substation.gridI, substation.gridJ] as [number, number],
        neighborhoodId: neighborhood.id,
        faulted: span.isFaulted(),
        throughputTier: span.getThroughputTier(),
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
      // Combined lookup across every transmission-capable node kind, keyed by grid
      // coordinate — safe since no two entities ever share a cell (all placement paths
      // check `grid.isOccupied`/call `grid.setOccupied`). Used by the
      // `transmissionLinks` reconstruction loop below, which doesn't care which concrete
      // type it finds at either end.
      const txNodeByKey = new Map<string, TxNode>();

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
        txNodeByKey.set(`${t.i},${t.j}`, tower);
      }

      for (const s of data.substations ?? []) {
        if (!isValidGridNode(s.i, s.j)) continue;
        const pendingMs = Number.isFinite(s.pendingMs) && s.pendingMs! > 0 ? s.pendingMs : undefined;
        const tier = Number.isFinite(s.tier) ? Math.min(Math.max(1, Math.round(s.tier!)), SUBSTATION.maxTier) : 1;
        const world = this.grid.nodeToWorld(s.i, s.j);
        this.grid.setOccupied(s.i, s.j);
        const substation = new Substation(s.i, s.j, world);
        substation.materializeFromSave(pendingMs, tier);
        this.substations.push(substation);
        this.scene.add(substation.group);
        txNodeByKey.set(`${s.i},${s.j}`, substation);
      }

      const FUEL_TYPES = ['coal', 'gas', 'nuclear', 'hydro', 'solar', 'wind'];
      const plantById = new Map<string, PowerPlant>();
      for (const p of data.plants ?? []) {
        if (!isValidGridNode(p.i, p.j) || !FUEL_TYPES.includes(p.fuelType)) continue;
        const world = this.grid.nodeToWorld(p.i, p.j);
        this.grid.setOccupied(p.i, p.j);
        const plant = new PowerPlant(p.i, p.j, world, p.fuelType as FuelType);
        plant.materializeFromSave();
        this.plants.push(plant);
        this.scene.add(plant.group);
        txNodeByKey.set(`${p.i},${p.j}`, plant);
        plantById.set(plant.id, plant);
      }

      const neighborhoodById = new Map<string, Neighborhood>();
      for (const n of data.neighborhoods ?? []) {
        if (!isValidGridNode(n.i, n.j) || !Number.isFinite(n.demandMW)) continue;
        const world = this.grid.nodeToWorld(n.i, n.j);
        this.grid.setOccupied(n.i, n.j);
        const neighborhood = new Neighborhood(n.i, n.j, world, n.demandMW);
        neighborhood.materializeFromSave();
        this.neighborhoods.push(neighborhood);
        this.scene.add(neighborhood.group);
        neighborhoodById.set(n.id, neighborhood);
      }

      for (const o of data.objectives ?? []) {
        const plant = plantById.get(o.plantId);
        const neighborhood = neighborhoodById.get(o.neighborhoodId);
        if (!plant || !neighborhood || !Number.isFinite(o.targetDemandMW)) continue;
        this.objectives.push({
          id: o.id,
          plant,
          neighborhood,
          targetDemandMW: o.targetDemandMW,
          completedAt: Number.isFinite(o.completedAt) ? o.completedAt! : null,
        });
      }
      // Backward-compat: a pre-Wave-6 save has Plant/Neighborhood (Wave 2+) but no
      // `objectives` array at all — synthesize one wrapping the first pair rather than
      // leaving an existing player's in-progress network with no objective to complete.
      if (this.objectives.length === 0 && this.plants.length > 0 && this.neighborhoods.length > 0) {
        this.objectives.push({
          id: `objective-0-${this.plants[0].id}`,
          plant: this.plants[0],
          neighborhood: this.neighborhoods[0],
          targetDemandMW: NEIGHBORHOOD.startingDemandMW,
          completedAt: null,
        });
      }

      for (const s of data.spans) {
        const a = byKey.get(`${s.a[0]},${s.a[1]}`);
        const b = byKey.get(`${s.b[0]},${s.b[1]}`);
        if (!a || !b) continue;
        const throughputTier = Number.isFinite(s.throughputTier)
          ? Math.min(Math.max(1, Math.round(s.throughputTier!)), ECONOMY.spanThroughputMaxTier)
          : 1;
        a.addConnection();
        b.addConnection();
        const span = new Span(a.topPos, b.topPos);
        span.materializeEnergized(throughputTier);
        if (s.faulted) span.fault();
        this.spans.push({ span, a, b });
        this.scene.add(span.group);
        this.spannedPairs.add([a.gridI, a.gridJ, b.gridI, b.gridJ].sort().join('|'));
      }

      for (const link of data.transmissionLinks ?? []) {
        const a = txNodeByKey.get(`${link.a[0]},${link.a[1]}`);
        const b = txNodeByKey.get(`${link.b[0]},${link.b[1]}`);
        if (!a || !b) continue;
        const throughputTier = Number.isFinite(link.throughputTier)
          ? Math.min(Math.max(1, Math.round(link.throughputTier!)), ECONOMY.spanThroughputMaxTier)
          : 1;
        a.addConnection();
        b.addConnection();
        const span = new Span(a.topPos, b.topPos);
        span.materializeEnergized(throughputTier);
        if (link.faulted) span.fault();
        this.transmissionLinks.push({ span, a, b });
        this.scene.add(span.group);
        this.spannedPairs.add([a.gridI, a.gridJ, b.gridI, b.gridJ].sort().join('|'));
      }

      for (const d of data.distributionSpans ?? []) {
        const substation = txNodeByKey.get(`${d.substation[0]},${d.substation[1]}`);
        const neighborhood = neighborhoodById.get(d.neighborhoodId);
        if (!(substation instanceof Substation) || !neighborhood) continue;
        const throughputTier = Number.isFinite(d.throughputTier)
          ? Math.min(Math.max(1, Math.round(d.throughputTier!)), ECONOMY.spanThroughputMaxTier)
          : 1;
        substation.addConnection();
        const span = new Span(substation.distPos, neighborhood.attachPos, 'distribution');
        span.materializeEnergized(throughputTier);
        if (d.faulted) span.fault();
        this.distributionSpans.push({ span, substation, neighborhood });
        this.scene.add(span.group);
        this.connectedNeighborhoods.add(neighborhood.id);
      }

      if (data.camera) {
        this.cameraRig.setView(data.camera.x, data.camera.z, data.camera.zoom);
      }
    } catch {
      // Corrupted/incompatible save data — discard and continue with whatever loaded so far.
      clearSave();
    }
  }

  /** Shared per-frame update for any span regardless of which of the three arrays it
   * lives in — advances its phase animation, fires the matching sound on a phase
   * transition, and reports its current income/fault contribution for the caller to sum. */
  private tickSpan(span: Span, now: number): { income: number; faulted: boolean } {
    const event = span.update(now);
    if (event === 'energized') this.sound.playEnergize();
    else if (event === 'repaired') this.sound.playRepair();
    return { income: span.isEnergized() ? span.incomeRate() : 0, faulted: span.isFaulted() };
  }

  private tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.25);
    this.lastTick = now;

    this.cameraRig.update();
    this.updateAtmosphere(now);
    this.updateMilestonePulse(now);
    this.updateBlackoutPulse(now);

    for (const tower of this.towers) {
      const event = tower.update(now);
      if (event === 'permitCleared') {
        this.sound.playPermitClear();
        this.spawnBurst(new THREE.Vector3(tower.topPos.x, 0.3, tower.topPos.z), 'dust', now);
      }
    }

    for (const plant of this.plants) plant.update(now, dt);
    for (const neighborhood of this.neighborhoods) {
      neighborhood.update(now, dt);
      if (neighborhood.checkCapacityWarning(NEIGHBORHOOD.demandWarningLeadSec)) {
        this.sound.playCapacityWarning();
      }
    }
    for (const substation of this.substations) {
      const event = substation.update(now);
      if (event === 'permitCleared') {
        this.sound.playPermitClear();
        this.spawnBurst(new THREE.Vector3(substation.topPos.x, 0.3, substation.topPos.z), 'dust', now);
      }
    }

    let capExIncomeRate = 0;
    let faultCount = 0;
    for (const { span } of this.spans) {
      const r = this.tickSpan(span, now);
      capExIncomeRate += r.income;
      if (r.faulted) faultCount++;
    }
    for (const { span } of this.transmissionLinks) {
      const r = this.tickSpan(span, now);
      capExIncomeRate += r.income;
      if (r.faulted) faultCount++;
    }
    for (const { span } of this.distributionSpans) {
      const r = this.tickSpan(span, now);
      capExIncomeRate += r.income;
      if (r.faulted) faultCount++;
    }
    this.sound.updateFaultAlarm(now, faultCount);

    // Demand-based income (Wave 4) — a fully independent second stream, additive on top
    // of the legacy per-span rate above. A served Neighborhood pays full rate regardless
    // of redundancy (that's a completion/blackout-risk concern, not a revenue one); a
    // not-served Neighborhood contributes nothing (a cliff, not partial credit).
    let objectiveIncomeRate = 0;
    for (const neighborhood of this.neighborhoods) {
      if (neighborhood.isServed()) {
        objectiveIncomeRate += neighborhood.currentDemandMW() * OBJECTIVE.capExPerMWServedPerSec;
      }
    }

    // Simplified fuel cost (Wave 9) — a cheap existence check ("does this Plant have at
    // least one currently-energized outgoing link"), not exact per-Neighborhood flow
    // attribution; see `PLANT.fuelCostPerMW`'s comment. Computed alongside
    // `objectiveIncomeRate` but subtracted only at this final combination point —
    // never netted into a specific Neighborhood's income upstream, preserving the
    // additive/isolated revenue model discipline.
    let fuelCostRate = 0;
    for (const plant of this.plants) {
      const hasEnergizedLink = this.transmissionLinks.some(
        (link) => (link.a === plant || link.b === plant) && link.span.isEnergized(),
      );
      if (hasEnergizedLink) {
        fuelCostRate += plant.effectiveCapacityMW() * PLANT.fuelCostPerMW[plant.fuelType] * PLANT.assumedUtilizationFraction;
      }
    }

    this.economy.tick(dt, capExIncomeRate + objectiveIncomeRate - fuelCostRate);

    this.updateStormWarning(now);
    if (now >= this.nextStormAt) this.triggerStorm(now);

    if (now >= this.nextNetworkRecomputeAt) {
      this.nextNetworkRecomputeAt = now + NETWORK_RECOMPUTE.intervalMs;
      this.recomputeNetworkState();
      this.checkObjectiveCompletions();
    }

    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      if (now >= this.pendingRespawns[i]) {
        this.pendingRespawns.splice(i, 1);
        this.spawnNextObjective();
        this.save();
      }
    }

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
