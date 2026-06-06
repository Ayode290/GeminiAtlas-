/**
 * Specs Inc. 2026
 * CityData – binds the geo bounds (cityBounds.ts) to the imported map textures.
 *
 * cityBounds.ts carries the MATH (centerLatLng / spanDeg / labels), but Lens
 * Studio textures are imported assets that must be assigned in the inspector.
 * This component wires the two together: drop the generated PNGs onto the
 * per-city Texture arrays (in L0..Ln order) and a globe base texture, and
 * CityData produces fully-resolved {@link City} objects for the controller.
 *
 * The bounds are READ-ONLY here; we never mutate the imported cityBounds data.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { GeoBounds, LatLng } from "./GeoMath";
import { CITY_BOUNDS, CityBoundsEntry } from "./cityBounds";

/** A single resolved level of detail: its texture + the bounds it was framed to. */
export interface LodLevel {
  level: number;
  mapTex: Texture;
  bounds: GeoBounds;
  label: string;
}

/** A resolved city: overview coordinate + ordered LOD chain (L0 first). */
export interface City {
  name: string;
  latLng: LatLng;
  levels: LodLevel[];
  /**
   * The wide "L-1" capture used ONLY to span-match the globe during the
   * globe<->table handoff (10x L0's degrees). NOT part of the navigable `levels`
   * chain. Null when its texture hasn't been assigned yet (handoff falls back to
   * a plain fade in that case).
   */
  transitionLevel: LodLevel | null;
}

@component
export class CityData extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">CityData – binds geo bounds to imported map textures</span><br/><span style="color: #94A3B8; font-size: 11px;">Assign the generated PNGs (in L0..Ln order) for each city plus the globe base texture. Bounds come from cityBounds.ts.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Globe</span>')
  @input
  @hint("Equirectangular base Earth texture for the globe sphere (hand-imported, not generated).")
  @allowUndefined
  globeBaseTexture: Texture

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Tokyo LOD textures (L0, L1, L2 in order)</span>')
  @input
  @hint("Generated Tokyo map PNGs, ordered L0 (largest area) to L2 (block level).")
  tokyoLevels: Texture[]

  @input
  @hint("Generated Tokyo WIDE handoff PNG (Tokyo_L-1.png, 10x L0 area). Used only during the globe<->table dive.")
  @allowUndefined
  tokyoTransition: Texture

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Seattle LOD textures (L0, L1, L2 in order)</span>')
  @input
  @hint("Generated Seattle map PNGs, ordered L0 (largest area) to L2 (block level).")
  seattleLevels: Texture[]

  @input
  @hint("Generated Seattle WIDE handoff PNG (Seattle_L-1.png, 10x L0 area). Used only during the globe<->table dive.")
  @allowUndefined
  seattleTransition: Texture

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Los Angeles LOD textures (L0, L1, L2 in order)</span>')
  @input
  @hint("Generated Los Angeles map PNGs, ordered L0 (largest area) to L2 (block level).")
  losAngelesLevels: Texture[]

  @input
  @hint("Generated Los Angeles WIDE handoff PNG (Los Angeles_L-1.png, 10x L0 area). Used only during the globe<->table dive.")
  @allowUndefined
  losAngelesTransition: Texture

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false

  private logger: Logger
  private cities: City[] = []
  private built: boolean = false

  onAwake() {
    this.logger = new Logger("CityData", this.enableLogging || this.enableLoggingLifecycle, true)
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()")
    this.build()
  }

  // --- Public API ------------------------------------------------------------

  /** Returns the resolved cities (building them lazily if needed). */
  getCities(): City[] {
    if (!this.built) this.build()
    return this.cities
  }

  /** Finds a resolved city by (case-insensitive) name, or null. */
  getCity(name: string): City | null {
    const key = (name ?? "").toLowerCase()
    return this.getCities().find((c) => c.name.toLowerCase() === key) ?? null
  }

  /** The globe base texture (may be null if unassigned). */
  getGlobeTexture(): Texture {
    return this.globeBaseTexture
  }

  // --- Internal --------------------------------------------------------------

  private build(): void {
    const byName: { [name: string]: Texture[] } = {
      Tokyo: this.tokyoLevels ?? [],
      Seattle: this.seattleLevels ?? [],
      "Los Angeles": this.losAngelesLevels ?? [],
    }
    const transitionByName: { [name: string]: Texture } = {
      Tokyo: this.tokyoTransition,
      Seattle: this.seattleTransition,
      "Los Angeles": this.losAngelesTransition,
    }

    this.cities = CITY_BOUNDS.map((entry) =>
      this.resolveCity(entry, byName[entry.name] ?? [], transitionByName[entry.name])
    )
    this.built = true
    this.logger.info("Resolved " + this.cities.length + " cities.")
  }

  // Pairs each bounds level with its assigned texture (by index). A missing
  // texture is logged and the level is skipped rather than crashing later.
  private resolveCity(entry: CityBoundsEntry, textures: Texture[], transitionTex?: Texture): City {
    const levels: LodLevel[] = []
    for (let i = 0; i < entry.levels.length; i++) {
      const b = entry.levels[i]
      const tex = textures[i]
      if (!tex) {
        this.logger.warn(
          "Missing texture for " + entry.name + " L" + b.level + " (expected " + b.texturePath + "); skipping this level."
        )
        continue
      }
      levels.push(this.toLodLevel(b.level, tex, b.centerLatLng, b.spanDeg, b.label))
    }
    return {
      name: entry.name,
      latLng: { lat: entry.centerLatLng.lat, lng: entry.centerLatLng.lng },
      levels,
      transitionLevel: this.resolveTransition(entry, transitionTex),
    }
  }

  // The wide L-1 handoff level, or null when its bounds or texture are missing
  // (in which case the controller falls back to a plain fade for the handoff).
  private resolveTransition(entry: CityBoundsEntry, tex?: Texture): LodLevel | null {
    const b = entry.transition
    if (!b) return null
    if (!tex) {
      this.logger.warn(
        "Missing transition (L-1) texture for " + entry.name + " (expected " + b.texturePath + "); handoff will fall back to a plain fade."
      )
      return null
    }
    return this.toLodLevel(b.level, tex, b.centerLatLng, b.spanDeg, b.label)
  }

  // Builds a LodLevel, copying bounds into fresh objects so callers can never
  // mutate the shared cityBounds data.
  private toLodLevel(level: number, tex: Texture, center: LatLng, spanDeg: number, label: string): LodLevel {
    return {
      level,
      mapTex: tex,
      bounds: { centerLatLng: { lat: center.lat, lng: center.lng }, spanDeg },
      label,
    }
  }
}
