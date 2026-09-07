/**
 * The basemap, in Epic's colours.
 *
 * The owner, 6 Sep 2026, on the Airbnb screenshots: "that is the level of polish
 * that I want to achieve."
 *
 * Those screenshots are Google Maps with an Airbnb style on top — the watermark
 * is in the corner of one of them. Which is the point: what makes them look
 * that way is not Google, it is the style. Default Google Maps looks nothing
 * like it. So the polish is bought here, in a style file we own, rather than
 * bought from a provider by the map load.
 *
 * The colours are the trip rebuild's own (7 Sep 2026, `trip-map-drawer.html`),
 * and they are the other way round from the app: **the ground is a warm grey
 * and the roads are cream**, not the reverse.
 *
 * That was wrong here for a day and it showed. A cream map is the same colour
 * as everything the app puts on top of it, so a chip floating over it had to be
 * given a 2px ink outline to be seen at all — and the owner is right that it
 * made them look "very, very buttony" (7 Sep 2026: "I don't know whether
 * there's an option to put some more shading on the map so it's not cream").
 * With the ground shaded, a plain cream chip reads on its own and the outlines
 * come off. The map got quieter and the controls got lighter, from one change.
 *
 * **The tiles.** Vector tiles from OpenFreeMap, which is free, needs no key and
 * asks for no attribution beyond OpenStreetMap's. That matters twice over: no
 * key can leak from the web bundle because there is no key (CLAUDE.md), and
 * there is no per-view bill, which a map on every trip screen would otherwise
 * run up. It is a deliberate first step and not the end of the road — the
 * production version of this is the same tiles served from our own object
 * store, which is a change to one URL. What it is *not* is
 * `tile.openstreetmap.org`, which is the Foundation's volunteer raster server
 * and whose usage policy does not permit an app of any size.
 *
 * The layer list is deliberately short. A basemap under a trip is scenery: it
 * has to say where the roads and the water are and then get out of the way, so
 * that the only things with real colour on the screen are the household's own
 * pins.
 */

const TILES = 'https://tiles.openfreemap.org/planet';

const INK = '#201E1D';
const MUTED = '#605D5D';
// Straight off the handoff's own drawing of the trip map.
const GROUND = '#E6E3DD';   // the warm grey the map sits on
const ROAD = '#FFFDF9';     // cream: the roads are the light thing now
const ROAD_MINOR = '#F2EFE9';
const WATER = '#D5DDE3';
const GREEN = '#DFE6D3';    // parks and open ground
const BUILDING = '#DEDAD3';
const LINE = '#D7D3CB';

/** The style, in Epic's palette. `dark` inverts the ground so the pins still read at night. */
export function epicMapStyle(dark = false): any {
  // Dark is the handoff's table: ground #1C1A19, roads #33302E/#403C3A,
  // park #20241C, water #1A2024.
  const ground = dark ? '#1C1A19' : GROUND;
  const road = dark ? '#403C3A' : ROAD;
  const roadMinor = dark ? '#33302E' : ROAD_MINOR;
  const water = dark ? '#1A2024' : WATER;
  const green = dark ? '#20241C' : GREEN;
  const building = dark ? '#26231F' : BUILDING;
  const label = dark ? '#A8A29C' : MUTED;
  const halo = dark ? '#201E1D' : GROUND;
  const placeLabel = dark ? '#FFFDF9' : INK;

  return {
    version: 8,
    // Archivo is the app's face and is not in the glyph set, so labels use the
    // set's own grotesque rather than a fallback that changes width per zoom.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: { type: 'vector', url: TILES },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': ground } },
      {
        id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': water },
      },
      {
        id: 'landcover-green', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['in', 'class', 'wood', 'grass', 'park'],
        paint: { 'fill-color': green, 'fill-opacity': 0.9 },
      },
      {
        id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
        paint: { 'fill-color': green, 'fill-opacity': 0.7 },
      },
      {
        id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 1] },
      },
      // Roads, thinnest first so the big ones draw over the small ones.
      {
        id: 'road-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track', 'path'],
        minzoom: 12,
        paint: { 'line-color': roadMinor, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 12, 0.4, 18, 6] },
      },
      {
        id: 'road-secondary', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', 'class', 'secondary', 'tertiary'],
        paint: { 'line-color': road, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 0.6, 18, 10] },
      },
      {
        id: 'road-primary', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'trunk'],
        paint: {
          'line-color': dark ? '#3B3733' : '#E6E1D8',
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 0.8, 18, 14],
        },
      },
      {
        id: 'road-motorway', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['==', 'class', 'motorway'],
        paint: {
          'line-color': dark ? '#443F3A' : '#DCD6CC',
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 5, 1, 18, 18],
        },
      },
      {
        id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['<=', 'admin_level', 4],
        paint: { 'line-color': dark ? '#3A3634' : LINE, 'line-width': 1, 'line-dasharray': [3, 2] },
      },
      // Labels. Places first and small; the household's own pins are what the
      // eye should find, so the basemap's names stay quiet.
      {
        id: 'label-place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town', 'village', 'suburb'],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 14, 14],
          'text-max-width': 8,
        },
        paint: { 'text-color': placeLabel, 'text-halo-color': halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'label-road', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'symbol-placement': 'line',
        },
        paint: { 'text-color': label, 'text-halo-color': halo, 'text-halo-width': 1.2 },
      },
    ],
  };
}
