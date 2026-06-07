/**
 * Specs Inc. 2026
 * One colored, Perlin-distorted HOLLOW RING — a single layer of the AgentRing.
 *
 * Plain helper class (not a @component): AgentRing creates a child SceneObject
 * per layer and wraps it in one of these. Each layer owns its RenderMeshVisual,
 * a CLONED material (so the shared base asset — e.g. "Bubble Mat" — is never
 * mutated) forced to ADDITIVE blend, and its own Perlin sampler. Stacked cyan +
 * magenta + yellow add to white where they overlap; the diverging rim crescents
 * reveal each layer's pure color.
 *
 * The ring matches the Bubbles system exactly: a filled BAND (annulus) between an
 * OUTER rim (the blob) and a slightly smaller INNER rim, each sampled with its
 * OWN noise so the two rims undulate independently rather than as a parallel
 * offset (a direct port of BubbleMesh's outer/"sub" rim pair). It reuses
 * BubbleMeshBuilder + getBubblePointsInto from ../Bubbles so the mesh + rim math
 * (and its allocation-free hot path) is shared, not forked.
 */
import { PerlinNoise } from "../Bubbles/PerlinNoise";
import {
  Point,
  buildRimDirections,
  getBubblePointsInto,
  allocPointBuffer,
  DEFAULT_REFERENCE_RADIUS,
} from "../Bubbles/ShapeGeometry";
import { BubbleMeshBuilder } from "../Bubbles/BubbleMeshBuilder";

export interface AgentDiscConfig {
  baseMaterial: Material;
  color: vec4;
  radius: number;
  numPoints: number;
  // Ring band thickness as a fraction of the radius (the prototype's SUB_FRACTION).
  // The inner rim sits at radius*(1-innerFraction). Small = thin ring; 1 = disc.
  innerFraction?: number;
  referenceRadius?: number;
  // Local Z offset (cm) so the three layers sit on slightly different planes.
  zOffset?: number;
}

export class AgentNoiseDisc {
  private readonly sceneObject: SceneObject;
  private readonly noise: PerlinNoise;
  private readonly cosDir: number[];
  private readonly sinDir: number[];
  private readonly outerBuf: Point[];
  private readonly innerBuf: Point[];
  private readonly radius: number;
  private readonly innerFraction: number;
  private readonly referenceRadius: number;
  private readonly builder: BubbleMeshBuilder;
  private material: Material | null = null;

  constructor(sceneObject: SceneObject, config: AgentDiscConfig) {
    this.sceneObject = sceneObject;

    // Min 3 so the 4-point rectangle eye is allowed; the noisy rings pass ~64.
    const points = Math.max(3, Math.floor(config.numPoints));
    this.radius = config.radius > 0 ? config.radius : 4;
    this.innerFraction = Math.max(
      0,
      Math.min(1, config.innerFraction !== undefined ? config.innerFraction : 0.12)
    );
    this.referenceRadius =
      config.referenceRadius && config.referenceRadius > 0
        ? config.referenceRadius
        : DEFAULT_REFERENCE_RADIUS;

    this.noise = new PerlinNoise();
    const dirs = buildRimDirections(points);
    this.cosDir = dirs.cos;
    this.sinDir = dirs.sin;
    this.outerBuf = allocPointBuffer(points);
    this.innerBuf = allocPointBuffer(points);

    // Nudge the layer along local Z so the three planes don't z-fight.
    if (config.zOffset) {
      const t = this.sceneObject.getTransform();
      const p = t.getLocalPosition();
      t.setLocalPosition(new vec3(p.x, p.y, config.zOffset));
    }

    const rmv = this.sceneObject.createComponent(
      "Component.RenderMeshVisual"
    ) as RenderMeshVisual;
    this.applyMaterial(rmv, config.baseMaterial, config.color);

    this.builder = new BubbleMeshBuilder(points, this.radius);
    rmv.mesh = this.builder.getMesh();
  }

  /** Updates the layer's color on its cloned material. */
  setColor(color: vec4): void {
    if (this.material) {
      (this.material.mainPass as any).baseColor = color;
    }
  }

  /**
   * Rebuilds the ring band for this layer. `absTime` is the absolute noise-time
   * for THIS layer (AgentRing folds in the per-layer divergence), `distortion`
   * how far the rim pushes in/out, `noiseScale` the rim wobble frequency. The
   * outer and inner rims are each sampled with their own (scaled) noise so the
   * band's two edges wobble against each other — matching BubbleMesh.
   */
  render(absTime: number, distortion: number, noiseScale: number): void {
    const f = this.innerFraction;
    getBubblePointsInto(
      this.outerBuf,
      this.noise,
      this.cosDir,
      this.sinDir,
      this.radius,
      absTime,
      noiseScale,
      distortion,
      this.referenceRadius
    );
    getBubblePointsInto(
      this.innerBuf,
      this.noise,
      this.cosDir,
      this.sinDir,
      this.radius * (1 - f),
      absTime,
      noiseScale * (1 - f),
      distortion * (1 - f),
      this.referenceRadius
    );
    this.builder.updateBand(this.outerBuf, this.innerBuf);
  }

  /**
   * Renders a static, filled axis-aligned RECTANGLE = the bounding box of the
   * disc (corners at ±radius), built from exactly 4 outer points + a center fan.
   * Used for the eyes: a 4-point quad that exactly bounds the circle it replaces,
   * so width/height (and the transform's aspect/blink scaling) are unchanged.
   * Requires the disc to have been constructed with numPoints === 4.
   */
  renderBoundingRect(): void {
    const r = this.radius;
    // Outer = the four corners (CCW); inner collapses to the origin so the band
    // builder's quads fan from center → a solid filled square.
    const corners: [number, number][] = [
      [r, r],
      [-r, r],
      [-r, -r],
      [r, -r],
    ];
    const n = Math.min(4, this.outerBuf.length);
    for (let i = 0; i < n; i++) {
      this.outerBuf[i][0] = corners[i][0];
      this.outerBuf[i][1] = corners[i][1];
      this.innerBuf[i][0] = 0;
      this.innerBuf[i][1] = 0;
    }
    this.builder.updateBand(this.outerBuf, this.innerBuf);
  }

  // --- internal --------------------------------------------------------------

  private applyMaterial(
    rmv: RenderMeshVisual,
    baseMaterial: Material,
    color: vec4
  ): void {
    if (!baseMaterial) return;
    // Clone so each layer owns its color/blend and the shared asset is untouched.
    this.material = baseMaterial.clone();
    const pass = this.material.mainPass as any;
    pass.baseColor = color;
    // Additive so overlapping CMY layers build toward white. Black contributes
    // nothing, which is also exactly how the Spectacles optical display works.
    try {
      pass.blendMode = BlendMode.Add;
    } catch (e) {
      // Some materials don't expose blendMode at runtime; fall back to whatever
      // the base material's blend is (set it to Add in the asset for the effect).
    }
    // Don't occlude the other layers, and draw both faces of the flat ring.
    pass.depthWrite = false;
    pass.twoSided = true;
    // Non-occludable: ignore the depth buffer so world/scene geometry never hides
    // the ring — it always draws on top of whatever is behind it.
    pass.depthTest = false;
    rmv.mainMaterial = this.material;
  }
}
