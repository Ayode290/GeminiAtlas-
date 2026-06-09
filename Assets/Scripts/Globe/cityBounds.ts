/**
 * Specs Inc. 2026
 * cityBounds.ts – the in-lens mirror of cityBounds.json.
 *
 * !!! GENERATED / KEPT IN SYNC BY tools/generate_map_textures.py !!!
 * cityBounds.json is the SINGLE SOURCE OF TRUTH. Running the generator rewrites
 * this file from the JSON so the framing used to capture the PNGs can never
 * drift from the bounds used to align them in-lens. You may hand-edit the JSON
 * and re-run the tool; avoid hand-editing this file directly.
 *
 * Lens Studio's TypeScript (isolatedModules, no resolveJsonModule) cannot
 * `import` a .json directly, so the data is materialized here as a typed module.
 */
import { LatLng } from "./GeoMath";

/** One baked level-of-detail entry for a city. */
export interface LodBoundsEntry {
  level: number;
  centerLatLng: LatLng;
  spanDeg: number;
  outSize: number;
  /** Human-readable label shown in the UI for this level. */
  label: string;
  /** Repo-relative path of the PNG the generator writes for this level. */
  texturePath: string;
}

/** One city: an overview coordinate plus its ordered LOD list (L0 first). */
export interface CityBoundsEntry {
  name: string;
  centerLatLng: LatLng;
  levels: LodBoundsEntry[];
  /** Wide 'L-1' capture for the globe<->table handoff (not a navigable level). */
  transition?: LodBoundsEntry;
}

/** The globe base (hand-imported equirectangular Earth texture). */
export const GLOBE_BOUNDS = {
  baseTexture: "Assets/Textures/Globe/earth_equirect.png",
  centerLatLng: { lat: 0, lng: 0 } as LatLng,
  spanDeg: 360,
};

/** Tile provider + attribution used by the offline generator (not at runtime). */
export const TILE_PROVIDER = {
  urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "(c) OpenStreetMap contributors",
};

/** All cities and their LOD bounds, mirrored from cityBounds.json. */
export const CITY_BOUNDS: CityBoundsEntry[] = [
  {
    name: "Tokyo",
    centerLatLng: { lat: 35.679921569965856, lng: 139.7708038167485 },
    levels: [
      { level: 0, centerLatLng: { lat: 35.679921569965856, lng: 139.7708038167485 }, spanDeg: 0.45, outSize: 1536, label: "Tokyo", texturePath: "Assets/Textures/Globe/Tokyo_L0.png" },
      { level: 1, centerLatLng: { lat: 35.679921569965856, lng: 139.7708038167485 }, spanDeg: 0.14, outSize: 1536, label: "Tokyo · closer", texturePath: "Assets/Textures/Globe/Tokyo_L1.png" },
      { level: 2, centerLatLng: { lat: 35.679921569965856, lng: 139.7708038167485 }, spanDeg: 0.045, outSize: 1536, label: "Tokyo · streets", texturePath: "Assets/Textures/Globe/Tokyo_L2.png" },
    ],
    transition: { level: -1, centerLatLng: { lat: 35.679921569965856, lng: 139.7708038167485 }, spanDeg: 4.5, outSize: 3072, label: "Tokyo region", texturePath: "Assets/Textures/Globe/Tokyo_L-1.png" },
  },
  {
    name: "Seattle",
    centerLatLng: { lat: 47.6062, lng: -122.3321 },
    levels: [
      { level: 0, centerLatLng: { lat: 47.6062, lng: -122.3321 }, spanDeg: 0.45, outSize: 1536, label: "Seattle", texturePath: "Assets/Textures/Globe/Seattle_L0.png" },
      { level: 1, centerLatLng: { lat: 47.6062, lng: -122.3321 }, spanDeg: 0.14, outSize: 1536, label: "Seattle · closer", texturePath: "Assets/Textures/Globe/Seattle_L1.png" },
      { level: 2, centerLatLng: { lat: 47.6062, lng: -122.3321 }, spanDeg: 0.045, outSize: 1536, label: "Seattle · streets", texturePath: "Assets/Textures/Globe/Seattle_L2.png" },
    ],
    transition: { level: -1, centerLatLng: { lat: 47.6062, lng: -122.3321 }, spanDeg: 4.5, outSize: 3072, label: "Seattle region", texturePath: "Assets/Textures/Globe/Seattle_L-1.png" },
  },
  {
    name: "Los Angeles",
    centerLatLng: { lat: 33.764523, lng: -118.190466 },
    levels: [
      { level: 0, centerLatLng: { lat: 33.764523, lng: -118.190466 }, spanDeg: 0.45, outSize: 1536, label: "Los Angeles", texturePath: "Assets/Textures/Globe/Los Angeles_L0.png" },
      { level: 1, centerLatLng: { lat: 33.764523, lng: -118.190466 }, spanDeg: 0.14, outSize: 1536, label: "Los Angeles · closer", texturePath: "Assets/Textures/Globe/Los Angeles_L1.png" },
      { level: 2, centerLatLng: { lat: 33.764523, lng: -118.190466 }, spanDeg: 0.045, outSize: 1536, label: "Los Angeles · streets", texturePath: "Assets/Textures/Globe/Los Angeles_L2.png" },
    ],
    transition: { level: -1, centerLatLng: { lat: 33.764523, lng: -118.190466 }, spanDeg: 4.5, outSize: 3072, label: "Los Angeles region", texturePath: "Assets/Textures/Globe/Los Angeles_L-1.png" },
  },
];
