const closed = (points) => [...points, { ...points[0] }];
export const DRAWING_PRESETS = ['Star', 'Heart', 'Flower', 'Circle', 'Rectangle', 'Arrow'];
export function presetArtwork(name) {
  let points;
  if (name === 'Star') points = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.225 : 0.5;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  else if (name === 'Heart') points = Array.from({ length: 64 }, (_, i) => {
    const a = i * Math.PI / 32;
    return { x: 16 * Math.sin(a) ** 3 / 34, y: (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a) + 2.5) / 34 };
  });
  else if (name === 'Circle' || name === 'Flower') points = Array.from({ length: 64 }, (_, i) => {
    const a = i * Math.PI / 32, r = name === 'Circle' ? 0.5 : 0.35 + 0.15 * Math.cos(6 * a);
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  else if (name === 'Rectangle') points = [{ x: -.5, y: -.3 }, { x: .5, y: -.3 }, { x: .5, y: .3 }, { x: -.5, y: .3 }];
  else if (name === 'Arrow') points = [[-.5,-.15],[.1,-.15],[.1,-.4],[.5,0],[.1,.4],[.1,.15],[-.5,.15]].map(([x,y]) => ({x,y}));
  else throw new Error('Choose a drawing preset');
  return { name, strokes: [closed(points)] };
}
