/**
 * Headless usage — no browser, no renderer:
 *   npm run house -- --seed oak --width 30 --depth 20 --centrality 0.3 [--front east] [--floors 2] [--json]
 */
import { meshBounds, triangleCount } from '@citygen/core';
import { buildHouseMesh, generateHouse, type StyleId, type WorldEdge } from '@citygen/house';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args.set(argv[i].slice(2), argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[++i]);
}
const width = Number(args.get('width') ?? 28);
const depth = Number(args.get('depth') ?? 18);
const spec = generateHouse({
  seed: args.get('seed') ?? 'manor',
  envelope: { x: 0, z: 0, width, depth },
  front: (args.get('front') as WorldEdge) ?? 'south',
  centrality: Number(args.get('centrality') ?? 0),
  floors: args.has('floors') ? Number(args.get('floors')) : null,
  ...(args.has('style') ? { style: args.get('style') as StyleId } : {}),
});

if (args.has('json')) {
  console.log(JSON.stringify(spec, null, 2));
} else {
  const mesh = buildHouseMesh(spec);
  const b = meshBounds(mesh);
  console.log(spec.features.map((f) => `• ${f}`).join('\n'));
  console.log(`openings: ${spec.facades.reduce((s, f) => s + f.openings.length, 0)}, triangles: ${triangleCount(mesh)}`);
  console.log(`bounds x[${b.min[0].toFixed(2)}, ${b.max[0].toFixed(2)}] y[${b.min[1].toFixed(2)}, ${b.max[1].toFixed(2)}] z[${b.min[2].toFixed(2)}, ${b.max[2].toFixed(2)}]`);
}
