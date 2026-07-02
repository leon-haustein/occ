const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');

for (const file of ['layer2.html', 'layer3.html', 'layer4.html']) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    /const faceSvg = `[\s\S]*?`;/,
    'const faceSvg = OTTO_FACE_SVG;'
  );
  content = content.replace(
    '<script>',
    "<script type=\"module\">\n        import { OTTO_FACE_SVG } from './js/otto-face.js';\n"
  );
  fs.writeFileSync(filePath, content);
  console.log('Patched', file);
}
