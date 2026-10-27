import { importSvg } from '../../src/core/svg.js';
import { defaultProject, validateProject, drawingCommands } from '../../src/core/project.js';

let count = 0;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const rejects = (source, message) => {
  let failed = false;
  try { importSvg(source); } catch { failed = true; }
  assert(failed, message);
  count++;
};

try {
  for (const body of [
    '<path d="M0 0 L10 10 M10 0 L0 10"/>', '<line x1="0" y1="0" x2="10" y2="20"/>',
    '<polyline points="0,0 10,10 20,0"/>', '<polygon points="0,0 10,10 20,0"/>',
    '<rect width="40" height="20"/>', '<circle r="10"/>', '<ellipse rx="20" ry="10"/>',
    '<path d="M0 0 C0 20 20 20 20 0 S40 -20 40 0 Q50 20 60 0 T80 0"/>',
    '<g transform="translate(10 20)"><g transform="rotate(45) scale(2)"><path d="M0 0 L10 20"/></g></g>',
  ]) {
    const artwork = importSvg(svg(body), 'example.svg');
    const project = validateProject({ ...defaultProject(), artwork });
    assert(drawingCommands(project).at(-1) === 'M400', 'Imported job must have completion barrier');
    const reopened = validateProject(JSON.parse(JSON.stringify(project)));
    assert(JSON.stringify(reopened) === JSON.stringify(project), 'Project round-trip');
    count++;
  }
  const artwork = importSvg(svg('<g transform="scale(2 1)"><path d="M0 0 L10 10"/></g>'));
  assert(artwork.strokes[0][0].x === -.5 && artwork.strokes[0][0].y === .25, 'Nested transforms and Y flip');
  count++;
  for (const body of [
    '<script>alert(1)</script><path d="M0 0L1 1"/>', '<image href="https://example.com/a.svg"/>',
    '<title><script>alert(1)</script></title><path d="M0 0L1 1"/>',
    '<path onload="alert(1)" d="M0 0L1 1"/>', '<foreignObject/>', '<use href="#shape"/>',
    '<style>path{display:none}</style>', '<text>Hello</text>', '<defs><path d="M0 0L1 1"/></defs>',
    '<path style="display:none" d="M0 0L1 1"/>', '<path clip-path="url(#clip)" d="M0 0L1 1"/>',
    '<path fill="url(https://example.com/a)" d="M0 0L1 1"/>', '<path class="hidden" d="M0 0L1 1"/>',
    '<path opacity="0" d="M0 0L1 1"/>', '<path stroke-dasharray="2 2" d="M0 0L1 1"/>',
    '<path d="M0 0 A1 1 0 0 0 5 5"/>', '<rect width="10" height="10" rx="2"/>',
    '<rect width="10mm" height="10"/>', '<svg><path d="M0 0L1 1"/></svg>',
    '<path d="M0 0L1 1"/><unsupported/>', '<path d="M0 0L1 1"',
    '<path d="M0 0"/>', '<polyline points="0 0 1"/>',
  ]) rejects(svg(body), `Must reject: ${body}`);
  rejects('<!DOCTYPE svg [<!ENTITY x "hi">]>' + svg('<path d="M0 0L1 1"/>'), 'Reject entity declarations');
  rejects('<?xml-stylesheet href="https://example.com/a.css"?>' + svg('<path d="M0 0L1 1"/>'), 'Reject stylesheet PI');
  rejects('<svg><path d="M0 0L1 1"/></svg>', 'Require SVG namespace');
  rejects(svg(' '.repeat(262144)), 'Bound file size');
  rejects(svg('<g>'.repeat(32) + '<path d="M0 0L1 1"/>' + '</g>'.repeat(32)), 'Bound nesting');
  rejects(svg('<line x2="1"/>'.repeat(201)), 'Bound stroke count');
  console.log(`SVG_CHECK:${JSON.stringify({ ok: true, message: `${count} native SVG DOM checks passed` })}`);
} catch (error) {
  console.log(`SVG_CHECK:${JSON.stringify({ ok: false, message: error.stack })}`);
}
