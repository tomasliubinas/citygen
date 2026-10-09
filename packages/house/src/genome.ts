import { Rng, type Weighted } from '@citygen/core';

/**
 * The "genome" is everything the seed decides about a house *independently of
 * its size*: proportions, which architectural vocabulary it speaks, colours.
 * Size and context only decide which of these features get expressed.
 * Same seed + different size ⇒ same family of house.
 *
 * A style preset is a set of probability weights over the shared vocabulary.
 * New styles (Beaux-Arts, Art Nouveau, …) are new presets, not new code paths.
 */

export type StyleId = 'classicist-manor' | 'beaux-arts' | 'art-nouveau' | 'klaipeda' | 'kaunas-deco' | 'vilnius-old-town' | 'french-classical';

export type EntrancePreference = 'portico' | 'risalit' | 'gate';
export type CrownPattern = 'alternating' | 'triangular' | 'segmental' | 'cornice' | 'secession' | 'plain' | 'eared' | 'keystone';
export type ColumnOrderPref = 'tuscan' | 'ionic' | 'corinthian';
export type DormerShape = 'gable' | 'arched' | 'oculus';
export type GableShape = 'triangle' | 'arched' | 'bell' | 'stepped' | 'tiered' | 'volute' | 'block' | 'none';
export type RailingKind = 'stone' | 'iron' | 'nouveau' | 'tube' | 'xiron';
export type RoofChoice = 'hipped' | 'mansard' | 'flat';
export type DoorStyle = 'classical' | 'canopy' | 'stepped' | 'gateway' | 'slab' | 'lantern';
export type BalconetPattern = 'all' | 'alternate' | 'ends' | 'center';

export interface ManorGenome {
  style: StyleId;
  bayWidth: number;
  plinthHeight: number;
  floorHeights: { ground: number; main: number; upper: number; top: number };
  windowRatio: number;
  entrance: EntrancePreference;
  columnOrder: ColumnOrderPref;
  /** Coupled columns (Beaux-Arts) instead of single ones. */
  pairedColumns: boolean;
  roof: RoofChoice;
  /** End pavilions get their own taller, steeper roofs. */
  pavilionRoof: 'same' | 'tall';
  /** Central risalit is crowned by a pediment or by its own tall pavilion roof. */
  centralRoof: 'pediment' | 'pavilion';
  /** Balustrade parapet running along the top of the main cornice. */
  parapet: boolean;
  /** Shallow iron balconets in front of the main-floor windows (French windows). */
  balconets: boolean;
  /** Iron cresting along the mansard curb. */
  cresting: boolean;
  dormerShape: DormerShape;
  roofPitch: number;
  pedimentPitch: number;
  risalitProjection: number;
  rusticatedGround: boolean;
  archedGround: boolean;
  crown: CrownPattern;
  corners: 'quoins' | 'pilasters' | 'lesenes' | 'none';
  balustrade: RailingKind;
  /** Outline of pediments / central gables. */
  gableShape: GableShape;
  /** Corner tower (Art Nouveau) and its roof. */
  tower: boolean;
  towerSide: 'left' | 'right';
  towerRoof: 'cone' | 'bell';
  /** 'corner' = one Art Nouveau corner tower; 'castle' = gate tower + round corner towers. */
  towerPlan: 'corner' | 'castle' | 'gate';
  towerShape: 'octagon' | 'round';
  /** Tower storeys above the main eaves. */
  towerStages: number;
  /** Main building floor cap (castles): extra height goes into the towers instead. */
  maxFloors: number | null;
  rearTowers: boolean;
  stringCourses: boolean;
  /** Oriel bay windows: none, over the entrance, or on a side bay. */
  oriel: 'none' | 'center' | 'side';
  /** Classical cornice, or deep overhanging eaves on brackets. */
  eaves: 'cornice' | 'bracketed' | 'corbel' | 'parapet';
  /** Head of upper-floor windows. */
  windowHead: 'flat' | 'segmental';
  /** Small-paned upper sashes (Jugendstil glazing). */
  smallPanes: boolean;
  doorStyle: DoorStyle;
  /** Window glazing: classic sashes, or Art Deco three-part frames with a high transom. */
  glazing: 'classic' | 'deco';
  /** Art Deco: a vertical glazed strip above the entrance. */
  entranceStrip: boolean;
  /** Which bays get balconets. */
  balconetPattern: BalconetPattern;
  /** Interwar details: flagpole over the door, dark bands under the windows, round porthole windows,
   *  plain vertical strips between all bays, travertine-clad ground floor. */
  flagpole: boolean;
  decoBands: boolean;
  portholes: boolean;
  fluting: boolean;
  groundCladding: boolean;
  /** Whole façade in scored limestone blocks instead of plaster. */
  ashlar: boolean;
  /** Main-floor balcony spanning the whole risalit front (vs. the door bay only). */
  risalitBalcony: boolean;
  /** Glazed-tile frieze under the eaves. */
  accentFrieze: boolean;
  endWings: boolean;
  wingBalconies: boolean;
  porticoBalcony: boolean;
  fanlight: boolean;
  oculus: boolean;
  dormers: 'none' | 'alternate' | 'all';
  dentils: boolean;
  stairSide: 'left' | 'right';
  /** Depth of a building block (one dual-aspect flat deep) and the courtyard preference for big plots. */
  blockDepth: number;
  courtyard: 'open' | 'closed';
  colors: { wall: string; roof: string; frame: string; door: string; accent: string; trim: string; stone: string };
  /** Character: how worn the house tends to be (0 new … 1 old) and its colour drift. */
  age: number;
  tint: { warm: number; light: number; roof: number };
}

type Range = readonly [number, number];

export interface StylePreset {
  id: StyleId;
  label: string;
  bayWidth: Range;
  plinthHeight: Range;
  floorHeights: { ground: Range; main: Range; upper: Range; top: Range };
  windowRatio: Range;
  roofPitch: Range;
  pedimentPitch: Range;
  risalitProjection: Range;
  entrance: Weighted<EntrancePreference>;
  columnOrder: Weighted<ColumnOrderPref>;
  roof: Weighted<RoofChoice>;
  pavilionRoof: Weighted<'same' | 'tall'>;
  centralRoof: Weighted<'pediment' | 'pavilion'>;
  dormerShape: Weighted<DormerShape>;
  crown: Weighted<CrownPattern>;
  corners: Weighted<'quoins' | 'pilasters' | 'lesenes' | 'none'>;
  balustrade: Weighted<RailingKind>;
  gableShape: Weighted<GableShape>;
  towerRoof: Weighted<'cone' | 'bell'>;
  towerPlan: Weighted<'corner' | 'castle' | 'gate'>;
  towerShape: Weighted<'octagon' | 'round'>;
  towerStages: readonly [number, number];
  maxFloors: number | null;
  oriel: Weighted<'none' | 'center' | 'side'>;
  eaves: Weighted<'cornice' | 'bracketed' | 'corbel' | 'parapet'>;
  windowHead: Weighted<'flat' | 'segmental'>;
  doorStyle: Weighted<DoorStyle>;
  glazing?: Weighted<'classic' | 'deco'>;
  /** Spot prominence (1 = default; bright white styles: larger, softer patches). */
  weathering?: number;
  balconetPattern?: Weighted<BalconetPattern>;
  dormers: Weighted<'none' | 'alternate' | 'all'>;
  chance: {
    rusticatedGround: number;
    archedGround: number;
    endWings: number;
    wingBalconies: number;
    porticoBalcony: number;
    fanlight: number;
    oculus: number;
    dentils: number;
    pairedColumns: number;
    parapet: number;
    balconets: number;
    cresting: number;
    tower: number;
    smallPanes: number;
    accentFrieze: number;
    rearTowers?: number;
    stringCourses?: number;
    entranceStrip?: number;
    flagpole?: number;
    decoBands?: number;
    portholes?: number;
    fluting?: number;
    groundCladding?: number;
    ashlar?: number;
    risalitBalcony?: number;
  };
  colors: { wall: Weighted<string>; roof: Weighted<string>; frame: Weighted<string>; door: Weighted<string>; accent: Weighted<string>; trim?: Weighted<string>; stone?: Weighted<string> };
}

/** Vocabulary a classical preset does not use (keeps those presets short). */
const CLASSICAL_EXTRAS = {
  gableShape: [['triangle', 1]],
  towerRoof: [['cone', 1]],
  oriel: [['none', 1]],
  eaves: [['cornice', 1]],
  windowHead: [['flat', 1]],
  doorStyle: [['classical', 1]],
  towerPlan: [['corner', 1]],
  towerShape: [['octagon', 1]],
  towerStages: [1, 1],
  maxFloors: null,
} as const satisfies Partial<StylePreset>;
const CLASSICAL_CHANCES = { tower: 0, smallPanes: 0, accentFrieze: 0 };
const NO_ACCENT: Weighted<string> = [['#2f5d57', 1]];

/** White early-20th-century classicist manor with an anthracite roof. */
export const CLASSICIST_MANOR: StylePreset = {
  id: 'classicist-manor',
  ...CLASSICAL_EXTRAS,
  label: 'Classicist manor (early XX c.)',
  bayWidth: [3.1, 3.7],
  plinthHeight: [0.85, 1.3],
  floorHeights: { ground: [3.9, 4.3], main: [4.3, 4.8], upper: [3.5, 3.8], top: [3.1, 3.4] },
  windowRatio: [1.9, 2.15],
  roofPitch: [30, 38],
  pedimentPitch: [18, 23],
  risalitProjection: [0.7, 1.2],
  entrance: [['portico', 0.55], ['risalit', 0.45]],
  columnOrder: [['tuscan', 0.45], ['ionic', 0.55]],
  roof: [['hipped', 0.7], ['mansard', 0.3]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['gable', 1]],
  crown: [['alternating', 0.35], ['triangular', 0.3], ['segmental', 0.15], ['cornice', 0.2]],
  corners: [['quoins', 0.6], ['pilasters', 0.4]],
  balustrade: [['stone', 0.65], ['iron', 0.35]],
  dormers: [['none', 0.3], ['alternate', 0.45], ['all', 0.25]],
  chance: {
    rusticatedGround: 0.6,
    archedGround: 0.4,
    endWings: 0.65,
    wingBalconies: 0.5,
    porticoBalcony: 0.6,
    fanlight: 0.7,
    oculus: 0.5,
    dentils: 0.6,
    pairedColumns: 0,
    parapet: 0,
    balconets: 0,
    cresting: 0,
    ...CLASSICAL_CHANCES,
  },
  colors: {
    // Mostly white, but the old-town plaster palette shows up too: cream, ochre, pale yellow, pink, sage, grey-blue.
    wall: [['#f2efe8', 3], ['#efebe2', 2], ['#f4f3ef', 2], ['#efe3c8', 1.2], ['#e8d3a2', 1], ['#f0e2a8', 0.8], ['#ecd3c7', 0.8], ['#d8dfcb', 0.6], ['#d9dfe3', 0.7]],
    roof: [['#3a3d42', 3], ['#34373b', 2], ['#41454b', 2], ['#5b6168', 1.5], ['#8e4a34', 1.2], ['#5d4638', 0.6]],
    frame: [['#f7f6f2', 4], ['#2f4637', 2], ['#2b2d30', 2], ['#5a3b26', 1]],
    door: [['#5a3b26', 3], ['#2c4234', 2], ['#2a2c2f', 2], ['#7a2e2a', 1], ['#304a66', 0.8]],
    accent: NO_ACCENT,
  },
};

/**
 * Beaux-Arts mansion (c. 1890–1914): mansard roofs, rusticated arched ground
 * floor, coupled Corinthian/Ionic columns, tall corner pavilions, iron
 * balconets, balustraded parapets. Kept white with dark zinc/slate roofs.
 */
export const BEAUX_ARTS: StylePreset = {
  id: 'beaux-arts',
  ...CLASSICAL_EXTRAS,
  label: 'Beaux-Arts mansion (1890–1914)',
  bayWidth: [3.3, 3.9],
  plinthHeight: [0.8, 1.15],
  floorHeights: { ground: [4.3, 4.8], main: [4.6, 5.2], upper: [3.8, 4.1], top: [3.3, 3.6] },
  windowRatio: [2.0, 2.3],
  roofPitch: [32, 40],
  pedimentPitch: [16, 20],
  risalitProjection: [0.8, 1.3],
  entrance: [['portico', 0.45], ['risalit', 0.55]],
  columnOrder: [['corinthian', 0.6], ['ionic', 0.4]],
  roof: [['mansard', 0.9], ['hipped', 0.1]],
  pavilionRoof: [['tall', 0.8], ['same', 0.2]],
  centralRoof: [['pavilion', 0.5], ['pediment', 0.5]],
  dormerShape: [['arched', 0.5], ['oculus', 0.3], ['gable', 0.2]],
  crown: [['segmental', 0.35], ['cornice', 0.3], ['alternating', 0.25], ['triangular', 0.1]],
  corners: [['quoins', 0.75], ['pilasters', 0.25]],
  balustrade: [['stone', 0.55], ['iron', 0.45]],
  dormers: [['all', 0.8], ['alternate', 0.2]],
  chance: {
    rusticatedGround: 0.95,
    archedGround: 0.85,
    endWings: 0.85,
    wingBalconies: 0.6,
    porticoBalcony: 0.8,
    fanlight: 0.9,
    oculus: 0.6,
    dentils: 0.85,
    pairedColumns: 0.75,
    parapet: 0.6,
    balconets: 0.7,
    cresting: 0.6,
    ...CLASSICAL_CHANCES,
  },
  colors: {
    // Limestone-like range: white, sand, warm grey; zinc, slate and the odd copper-green roof.
    wall: [['#f3efe6', 3], ['#f1ece2', 2], ['#f5f4f0', 2], ['#eadfca', 2], ['#e6dccb', 1.5], ['#dfe0dc', 1], ['#ecd9c6', 0.8]],
    roof: [['#3d4248', 3], ['#474d55', 2], ['#33373c', 2], ['#555b63', 1.2], ['#5f8a7b', 0.6]],
    frame: [['#2b2d30', 3], ['#f7f6f2', 2], ['#34433b', 1]],
    door: [['#2a2c2f', 3], ['#3b2a20', 2], ['#2c4234', 1]],
    accent: NO_ACCENT,
  },
};

/**
 * Art Nouveau / Jugendstil villa (1895–1914): asymmetric silhouette with a
 * corner tower, oriels on corbels, curved gables, deep bracketed eaves,
 * segmental windows with small-paned upper sashes, Secession disc ornament,
 * whiplash iron railings. White walls, anthracite roof, a dark-green tile accent.
 */
export const ART_NOUVEAU: StylePreset = {
  id: 'art-nouveau',
  label: 'Art Nouveau villa (1895–1914)',
  weathering: 0.55,
  bayWidth: [3.0, 3.6],
  plinthHeight: [0.7, 1.0],
  floorHeights: { ground: [3.8, 4.2], main: [4.0, 4.4], upper: [3.5, 3.8], top: [3.2, 3.4] },
  windowRatio: [1.8, 2.05],
  roofPitch: [42, 52],
  pedimentPitch: [30, 40],
  risalitProjection: [0.6, 1.0],
  entrance: [['risalit', 1]],
  columnOrder: [['ionic', 1]],
  roof: [['hipped', 0.85], ['mansard', 0.15]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['arched', 0.5], ['oculus', 0.3], ['gable', 0.2]],
  crown: [['secession', 0.55], ['cornice', 0.25], ['segmental', 0.2]],
  corners: [['lesenes', 0.7], ['quoins', 0.3]],
  balustrade: [['nouveau', 0.85], ['stone', 0.15]],
  dormers: [['alternate', 0.5], ['all', 0.2], ['none', 0.3]],
  gableShape: [['arched', 0.5], ['bell', 0.5]],
  towerRoof: [['bell', 0.55], ['cone', 0.45]],
  oriel: [['side', 0.45], ['center', 0.35], ['none', 0.2]],
  eaves: [['bracketed', 0.75], ['cornice', 0.25]],
  windowHead: [['segmental', 0.75], ['flat', 0.25]],
  doorStyle: [['canopy', 0.75], ['classical', 0.25]],
  towerPlan: [['corner', 1]],
  towerShape: [['octagon', 1]],
  towerStages: [1, 1],
  maxFloors: null,
  chance: {
    rusticatedGround: 0.25,
    archedGround: 0.45,
    endWings: 0,
    wingBalconies: 0,
    porticoBalcony: 0,
    fanlight: 0.85,
    oculus: 0.4,
    dentils: 0.1,
    pairedColumns: 0,
    parapet: 0,
    balconets: 0.35,
    cresting: 0.3,
    tower: 0.75,
    smallPanes: 0.85,
    accentFrieze: 0.7,
  },
  colors: {
    // Jugendstil pastels next to white: mint, pale blue, light yellow, rose.
    wall: [['#f3f1ec', 3], ['#f1ede4', 2], ['#f5f5f2', 2], ['#d7e3d6', 1], ['#d6e0e8', 1], ['#efe0b5', 1], ['#ead0c8', 0.8]],
    roof: [['#3a3d42', 3], ['#33363a', 2], ['#454a50', 2], ['#8a4632', 1], ['#4f6b5c', 0.5]],
    frame: [['#2f4637', 3], ['#f7f6f2', 2], ['#2b2d30', 2]],
    door: [['#2c4234', 3], ['#5a3b26', 2], ['#2a2c2f', 2]],
    accent: [['#2f5d57', 3], ['#3d5a3c', 2], ['#7a6a3a', 1]],
  },
};

/**
 * Klaipėda (Memel) brick: Hanseatic / Prussian red-brick town architecture — red
 * brick on a fieldstone base, steep red-tile roofs, crow-stepped gables, brick
 * corbel friezes and, sometimes, a single square stair/gate tower.
 */
export const KLAIPEDA: StylePreset = {
  id: 'klaipeda',
  label: 'Klaipėda brick (Hanseatic)',
  bayWidth: [3.2, 3.9],
  plinthHeight: [0.6, 1.0],
  floorHeights: { ground: [3.7, 4.1], main: [3.8, 4.2], upper: [3.5, 3.8], top: [3.3, 3.6] },
  windowRatio: [1.6, 1.9],
  roofPitch: [48, 55],
  pedimentPitch: [45, 50],
  risalitProjection: [0.5, 0.9],
  entrance: [['risalit', 0.65], ['gate', 0.35]],
  columnOrder: [['tuscan', 1]],
  roof: [['hipped', 1]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['gable', 1]],
  crown: [['plain', 0.7], ['keystone', 0.3]],
  corners: [['none', 1]],
  balustrade: [['iron', 1]],
  dormers: [['none', 0.6], ['alternate', 0.4]],
  gableShape: [['stepped', 1]],
  towerRoof: [['cone', 1]],
  towerPlan: [['gate', 1]],
  towerShape: [['round', 1]],
  towerStages: [1, 2],
  maxFloors: null,
  oriel: [['none', 1]],
  eaves: [['corbel', 1]],
  windowHead: [['segmental', 0.7], ['flat', 0.3]],
  doorStyle: [['classical', 1]],
  chance: {
    rusticatedGround: 0, archedGround: 0.8, endWings: 0.75, wingBalconies: 0, porticoBalcony: 0, fanlight: 1, oculus: 0.55,
    dentils: 0, pairedColumns: 0, parapet: 0, balconets: 0, cresting: 0, tower: 1, smallPanes: 0.8, accentFrieze: 0,
    rearTowers: 0, stringCourses: 0,
  },
  colors: {
    wall: [['#8b4331', 3], ['#813f2e', 2], ['#934a35', 2], ['#7a3a2a', 1], ['#9a5238', 1]],
    roof: [['#843523', 3], ['#8f3d27', 2], ['#733020', 2], ['#3a3d42', 1]],
    frame: [['#f2efe8', 3], ['#2b2622', 1], ['#2f4637', 1]],
    door: [['#4a3020', 2], ['#3b2a20', 1], ['#2c4234', 1]],
    accent: [['#2f5d57', 1]],
    // Hanseatic brick is dressed in brick: cream trim is the rare exception.
    trim: [['#7f3a27', 9], ['#d8d0c0', 0.5]],
    stone: [['#8d887d', 2], ['#9a948a', 1]],
  },
};

/**
 * Kaunas interwar modernism / Art Deco (1919–1939): flat roofs behind parapets,
 * a stepped attic over the centre, smooth light plaster, travertine base, flat
 * horizontal bands, three-part windows, a vertical glazed strip over the entrance,
 * a stepped portal with a flagpole and tubular steel balcony railings.
 */
export const KAUNAS_DECO: StylePreset = {
  id: 'kaunas-deco',
  label: 'Kaunas Art Deco (1919–1939)',
  bayWidth: [3.2, 3.8],
  plinthHeight: [0.6, 0.9],
  floorHeights: { ground: [3.6, 4.0], main: [3.4, 3.7], upper: [3.3, 3.5], top: [3.2, 3.4] },
  windowRatio: [1.0, 1.6],
  roofPitch: [20, 26],
  pedimentPitch: [20, 22],
  risalitProjection: [0.4, 0.8],
  entrance: [['risalit', 1]],
  columnOrder: [['tuscan', 1]],
  // Flat roofs behind parapets, but many interwar houses and villas had a low hipped roof.
  roof: [['flat', 0.45], ['hipped', 0.55]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['gable', 1]],
  crown: [['plain', 1]],
  corners: [['none', 0.7], ['lesenes', 0.3]],
  balustrade: [['tube', 1]],
  dormers: [['none', 1]],
  gableShape: [['tiered', 0.45], ['block', 0.3], ['none', 0.25]],
  towerRoof: [['cone', 1]],
  towerPlan: [['corner', 1]],
  towerShape: [['octagon', 1]],
  towerStages: [1, 1],
  maxFloors: null,
  oriel: [['none', 0.7], ['center', 0.3]],
  eaves: [['parapet', 1]],
  windowHead: [['flat', 1]],
  doorStyle: [['stepped', 0.5], ['slab', 0.5]],
  glazing: [['deco', 1]],
  balconetPattern: [['alternate', 0.35], ['ends', 0.25], ['center', 0.25], ['all', 0.15]],
  chance: {
    rusticatedGround: 0.35, archedGround: 0, endWings: 0.4, wingBalconies: 0.6, porticoBalcony: 0, fanlight: 0, oculus: 0,
    dentils: 0, pairedColumns: 0, parapet: 0, balconets: 0.5, cresting: 0, tower: 0, smallPanes: 0, accentFrieze: 0.25,
    stringCourses: 1, entranceStrip: 0.65, flagpole: 0, decoBands: 0.45, portholes: 0.4, fluting: 0.35, groundCladding: 0.5,
  },
  colors: {
    wall: [['#e4e1d9', 3], ['#ddd6c6', 2], ['#e6d9bd', 2], ['#d6d8d2', 1.5], ['#e9dcc3', 1], ['#cfd5cb', 1]],
    roof: [['#4a4c4f', 1]],
    frame: [['#2b2d30', 2], ['#f2f0ea', 2], ['#5a3b26', 1]],
    door: [['#2a2c2f', 2], ['#6b4a2e', 2]],
    accent: [['#3a3f45', 1]],
    trim: [['#efece4', 1]],
    stone: [['#d3c9b4', 2], ['#c9c2b2', 1]],
  },
};

/**
 * Vilnius (late Baroque old-town houses): two or three floors of warm pastel
 * plaster, steep red clay-tile roofs with small dormers, curving volute gables,
 * eared window frames and wide arched gateways into the courtyard.
 */
export const VILNIUS_OLD_TOWN: StylePreset = {
  id: 'vilnius-old-town',
  label: 'Vilnius (Baroque)',
  bayWidth: [2.9, 3.4],
  plinthHeight: [0.25, 0.45],
  floorHeights: { ground: [3.8, 4.2], main: [3.8, 4.2], upper: [3.4, 3.7], top: [3.2, 3.4] },
  windowRatio: [1.6, 1.85],
  roofPitch: [40, 48],
  pedimentPitch: [30, 36],
  risalitProjection: [0.3, 0.6],
  entrance: [['risalit', 1]],
  columnOrder: [['tuscan', 1]],
  roof: [['hipped', 0.85], ['mansard', 0.15]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['gable', 0.6], ['arched', 0.4]],
  crown: [['eared', 0.5], ['cornice', 0.3], ['segmental', 0.2]],
  corners: [['pilasters', 0.4], ['none', 0.6]],
  balustrade: [['iron', 1]],
  dormers: [['alternate', 0.4], ['all', 0.3], ['none', 0.3]],
  gableShape: [['volute', 0.75], ['triangle', 0.25]],
  towerRoof: [['cone', 1]],
  towerPlan: [['corner', 1]],
  towerShape: [['octagon', 1]],
  towerStages: [1, 1],
  maxFloors: 3,
  oriel: [['none', 1]],
  eaves: [['cornice', 1]],
  windowHead: [['flat', 1]],
  doorStyle: [['gateway', 1]],
  chance: {
    rusticatedGround: 0.15, archedGround: 0.35, endWings: 0.2, wingBalconies: 0.2, porticoBalcony: 0, fanlight: 1, oculus: 0.5,
    dentils: 0.2, pairedColumns: 0, parapet: 0, balconets: 0.1, cresting: 0, tower: 0, smallPanes: 0.6, accentFrieze: 0,
  },
  colors: {
    wall: [['#efe9dc', 2], ['#e9cf8f', 2], ['#e7c3b2', 1.5], ['#cfdcc4', 1.2], ['#d3dde5', 1], ['#efe0b0', 1.2], ['#e5b99a', 0.8]],
    roof: [['#9a4b32', 3], ['#8c4a35', 2], ['#7d4430', 1.5], ['#5c6b63', 1]],
    frame: [['#f2efe8', 3], ['#4b3a2c', 1], ['#2f4637', 1]],
    door: [['#5a3b26', 2], ['#3d4f3a', 1.5], ['#6a2e28', 1]],
    accent: [['#2f5d57', 1]],
    trim: [['#fbfaf6', 1]],
    stone: [['#c9bfae', 1]],
  },
};

/**
 * French Classical (Louis XVI / Neo-French) villa: a compact symmetrical block in
 * scored limestone, hipped slate roof with œil-de-boeuf dormers, a shallow pedimented
 * centre with pilasters, tall French doors behind X-pattern iron balconets, arched
 * ground-floor windows, a recessed door flanked by lanterns, dark steel frames.
 */
export const FRENCH_CLASSICAL: StylePreset = {
  id: 'french-classical',
  label: 'French Classical villa',
  ...CLASSICAL_EXTRAS,
  bayWidth: [3.6, 4.4],
  plinthHeight: [0.35, 0.6],
  floorHeights: { ground: [4.0, 4.4], main: [3.9, 4.3], upper: [3.6, 3.8], top: [3.3, 3.5] },
  windowRatio: [2.1, 2.45],
  roofPitch: [36, 42],
  pedimentPitch: [20, 24],
  risalitProjection: [0.35, 0.6],
  entrance: [['risalit', 1]],
  columnOrder: [['ionic', 1]],
  roof: [['hipped', 0.85], ['mansard', 0.15]],
  pavilionRoof: [['same', 1]],
  centralRoof: [['pediment', 1]],
  dormerShape: [['oculus', 0.8], ['arched', 0.2]],
  crown: [['plain', 0.6], ['cornice', 0.4]],
  corners: [['pilasters', 0.8], ['quoins', 0.2]],
  balustrade: [['xiron', 1]],
  dormers: [['alternate', 0.6], ['all', 0.25], ['none', 0.15]],
  doorStyle: [['lantern', 1]],
  balconetPattern: [['all', 0.75], ['ends', 0.25]],
  chance: {
    rusticatedGround: 0, archedGround: 0.9, endWings: 0.2, wingBalconies: 0, porticoBalcony: 0, fanlight: 0.3, oculus: 0.3,
    dentils: 0.4, pairedColumns: 0, parapet: 0, balconets: 1, cresting: 0, tower: 0, smallPanes: 0, accentFrieze: 0,
    ashlar: 1,
  },
  colors: {
    wall: [['#e3ddd0', 3], ['#ddd6c7', 2], ['#e8e3d8', 2], ['#d9d2c2', 1]],
    roof: [['#3a3e44', 3], ['#33373c', 2], ['#454a51', 1]],
    frame: [['#26282b', 4], ['#3a3330', 1]],
    door: [['#1f2124', 3], ['#2f3b33', 1]],
    accent: [['#2f5d57', 1]],
    trim: [['#ece7dc', 1]],
    stone: [['#ddd6c8', 2], ['#e2dccf', 1]],
  },
};

export const STYLES: Record<StyleId, StylePreset> = {
  'kaunas-deco': KAUNAS_DECO,
  'vilnius-old-town': VILNIUS_OLD_TOWN,
  klaipeda: KLAIPEDA,
  'classicist-manor': CLASSICIST_MANOR,
  'beaux-arts': BEAUX_ARTS,
  'art-nouveau': ART_NOUVEAU,
  'french-classical': FRENCH_CLASSICAL,
};

export function createGenome(seed: string, styleId: StyleId = 'classicist-manor'): ManorGenome {
  const p = STYLES[styleId];
  const root = Rng.create(seed, 'house', styleId);
  const r = (k: string) => root.fork(k);
  const range = (k: string, [a, b]: Range) => r(k).range(a, b);
  return {
    style: styleId,
    bayWidth: range('bay-width', p.bayWidth),
    plinthHeight: range('plinth', p.plinthHeight),
    floorHeights: {
      ground: range('h-ground', p.floorHeights.ground),
      main: range('h-main', p.floorHeights.main),
      upper: range('h-upper', p.floorHeights.upper),
      top: range('h-top', p.floorHeights.top),
    },
    windowRatio: range('window-ratio', p.windowRatio),
    entrance: r('entrance').weighted(p.entrance),
    columnOrder: r('order').weighted(p.columnOrder),
    roof: r('roof').weighted(p.roof),
    pairedColumns: r('paired-columns').chance(p.chance.pairedColumns),
    pavilionRoof: r('pavilion-roof').weighted(p.pavilionRoof),
    centralRoof: r('central-roof').weighted(p.centralRoof),
    parapet: r('parapet').chance(p.chance.parapet),
    balconets: r('balconets').chance(p.chance.balconets),
    cresting: r('cresting').chance(p.chance.cresting),
    dormerShape: r('dormer-shape').weighted(p.dormerShape),
    gableShape: r('gable-shape').weighted(p.gableShape),
    tower: r('tower').chance(p.chance.tower),
    towerSide: r('tower-side').chance(0.5) ? 'left' : 'right',
    towerRoof: r('tower-roof').weighted(p.towerRoof),
    oriel: r('oriel').weighted(p.oriel),
    eaves: r('eaves').weighted(p.eaves),
    windowHead: r('window-head').weighted(p.windowHead),
    smallPanes: r('small-panes').chance(p.chance.smallPanes),
    doorStyle: r('door-style').weighted(p.doorStyle),
    accentFrieze: r('accent-frieze').chance(p.chance.accentFrieze),
    blockDepth: r('block-depth').range(11.5, 14),
    age: r('age').range(0, 1),
    tint: { warm: r('tint-warm').range(-1, 1), light: r('tint-light').range(-1, 1), roof: r('tint-roof').range(-1, 1) },
    towerPlan: r('tower-plan').weighted(p.towerPlan),
    towerShape: r('tower-shape').weighted(p.towerShape),
    towerStages: r('tower-stages').int(p.towerStages[0], p.towerStages[1]),
    maxFloors: p.maxFloors,
    rearTowers: r('rear-towers').chance(p.chance.rearTowers ?? 0),
    stringCourses: r('string-courses').chance(p.chance.stringCourses ?? 1),
    glazing: p.glazing ? r('glazing').weighted(p.glazing) : 'classic',
    entranceStrip: r('entrance-strip').chance(p.chance.entranceStrip ?? 0),
    balconetPattern: p.balconetPattern ? r('balconet-pattern').weighted(p.balconetPattern) : 'all',
    flagpole: r('flagpole').chance(p.chance.flagpole ?? 0),
    decoBands: r('deco-bands').chance(p.chance.decoBands ?? 0),
    portholes: r('portholes').chance(p.chance.portholes ?? 0),
    fluting: r('fluting').chance(p.chance.fluting ?? 0),
    groundCladding: r('ground-cladding').chance(p.chance.groundCladding ?? 0),
    ashlar: r('ashlar').chance(p.chance.ashlar ?? 0),
    risalitBalcony: r('risalit-balcony').chance(p.chance.risalitBalcony ?? 0.45),
    courtyard: r('courtyard').chance(0.5) ? 'closed' : 'open',
    roofPitch: range('roof-pitch', p.roofPitch),
    pedimentPitch: range('pediment-pitch', p.pedimentPitch),
    risalitProjection: range('risalit-projection', p.risalitProjection),
    rusticatedGround: r('rustication').chance(p.chance.rusticatedGround),
    archedGround: r('arched-ground').chance(p.chance.archedGround),
    crown: r('crown').weighted(p.crown),
    corners: r('corners').weighted(p.corners),
    balustrade: r('balustrade').weighted(p.balustrade),
    endWings: r('end-wings').chance(p.chance.endWings),
    wingBalconies: r('wing-balconies').chance(p.chance.wingBalconies),
    porticoBalcony: r('portico-balcony').chance(p.chance.porticoBalcony),
    fanlight: r('fanlight').chance(p.chance.fanlight),
    oculus: r('oculus').chance(p.chance.oculus),
    dormers: r('dormers').weighted(p.dormers),
    dentils: r('dentils').chance(p.chance.dentils),
    stairSide: r('stair-side').chance(0.5) ? 'left' : 'right',
    colors: {
      wall: r('c-wall').weighted(p.colors.wall),
      roof: r('c-roof').weighted(p.colors.roof),
      frame: r('c-frame').weighted(p.colors.frame),
      door: r('c-door').weighted(p.colors.door),
      accent: r('c-accent').weighted(p.colors.accent),
      trim: p.colors.trim ? r('c-trim').weighted(p.colors.trim) : '#fbfaf6',
      stone: p.colors.stone ? r('c-stone').weighted(p.colors.stone) : '#bdb7ad',
    },
  };
}
