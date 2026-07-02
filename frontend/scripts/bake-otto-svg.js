const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../svgs/otto-face.svg');
const src = fs.readFileSync(svgPath, 'utf8');

const viewBoxMatch = src.match(/viewBox="([^"]+)"/);
if (!viewBoxMatch) {
  console.error('Could not parse viewBox from', svgPath);
  process.exit(1);
}

const viewBox = viewBoxMatch[1];
const parts = viewBox.trim().split(/\s+/).map(Number);
const aspectRatio =
  parts.length === 4 && parts[2] > 0 && parts[3] > 0
    ? `${parts[2]} / ${parts[3]}`
    : '36.756 / 46.058829';

function extractInner(svgSource) {
  const withoutXml = svgSource.replace(/<\?xml[^?]*\?>\s*/i, '');
  const openMatch = withoutXml.match(/<svg[\s\S]*?>/i);
  if (!openMatch) return null;

  const start = withoutXml.indexOf(openMatch[0]) + openMatch[0].length;
  const end = withoutXml.lastIndexOf('</svg>');
  if (end < start) return null;

  return withoutXml
    .slice(start, end)
    .replace(/<sodipodi:namedview[\s\S]*?\/>/gi, '')
    .replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/gi, '')
    .replace(/<defs[^>]*>\s*<\/defs>/gi, '')
    .trim();
}

const inner = extractInner(src);
if (!inner) {
  console.error('Could not parse', svgPath);
  process.exit(1);
}

function wrapSvg(svgClass) {
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" class="${svgClass}" aria-hidden="true">\n${inner}\n</svg>`;
}

const jsDir = path.join(__dirname, '../js');
fs.mkdirSync(jsDir, { recursive: true });
const jsPath = path.join(jsDir, 'otto-face.js');
const js = `/** Generated from svgs/otto-face.svg — run: node scripts/bake-otto-svg.js */
export const OTTO_VIEWBOX = '${viewBox}';
export const OTTO_ASPECT_RATIO = '${aspectRatio}';

export const OTTO_FACE_SVG = \`${wrapSvg('breadcrumb-face-svg')}\`;

export const OTTO_FIRST_LAYER_SVG = \`${wrapSvg('otto-first-layer')}\`;
`;
fs.writeFileSync(jsPath, js);
console.log('Wrote', jsPath, 'from', svgPath);
