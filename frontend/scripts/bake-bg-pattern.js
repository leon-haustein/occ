const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const templatePath = path.join(rootDir, 'svgs/bg-pattern.svg');
const stylePath = path.join(rootDir, 'style.css');
const svgsDir = path.join(rootDir, 'svgs');

const template = fs.readFileSync(templatePath, 'utf8');
const styleCss = fs.readFileSync(stylePath, 'utf8');

function parseLayerColors(css) {
  const colors = {};
  for (let i = 1; i <= 4; i++) {
    const match = css.match(new RegExp(`--color-layer-${i}:\\s*([^;\\s]+)`));
    if (match) colors[i] = match[1].trim();
  }
  return colors;
}

const layerColors = parseLayerColors(styleCss);

const LAYERS = [
  {
    bodyClass: 'bg-index',
    outputFile: 'bg-pattern-index.svg',
    colorLayer: 1,
    bevelColor: null,
    shadowOpacity: '0.1',
  },
];

function bakeSvg(layer) {
  const textColor = layerColors[layer.colorLayer];
  if (!textColor) {
    console.error(`Missing --color-layer-${layer.colorLayer} in style.css`);
    process.exit(1);
  }

  const bevelColor = layer.bevelColor || textColor.replace(/^#/, '');

  return template
    .replace(/\{\{TEXT_COLOR\}\}/g, textColor)
    .replace(/\{\{BEVEL_COLOR\}\}/g, bevelColor)
    .replace(/\{\{SHADOW_OPACITY\}\}/g, layer.shadowOpacity);
}

function buildLayerCss(layers) {
  const blocks = layers.map((layer) => {
    return `body.${layer.bodyClass} {
    background-color: var(--color-layer-${layer.colorLayer});
    background-image: url("svgs/${layer.outputFile}");
    background-repeat: repeat;
}`;
  });

  return `/* Layer backgrounds — generated from svgs/bg-pattern.svg
   Run: node scripts/bake-bg-pattern.js */
${blocks.join('\n\n')}`;
}

fs.mkdirSync(svgsDir, { recursive: true });

for (const layer of LAYERS) {
  const outPath = path.join(svgsDir, layer.outputFile);
  fs.writeFileSync(outPath, bakeSvg(layer));
  console.log('Wrote', outPath);
}

const startMarker = '/* LAYER-BG:START */';
const endMarker = '/* LAYER-BG:END */';
const generatedBlock = buildLayerCss(LAYERS);

if (!styleCss.includes(startMarker) || !styleCss.includes(endMarker)) {
  console.error('Missing LAYER-BG markers in style.css');
  process.exit(1);
}

const patchedCss = styleCss.replace(
  new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
  `${startMarker}\n${generatedBlock}\n${endMarker}`
);

fs.writeFileSync(stylePath, patchedCss);
console.log('Patched', stylePath);
