// node_modules-dan PDF və Excel kitabxanalarını www/lib qovluğuna köçürür
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www', 'lib');
fs.mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/html2pdf.js/dist/html2pdf.bundle.min.js', 'html2pdf.bundle.min.js'],
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js'],
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(out, to));
  console.log('köçürüldü:', to);
}
