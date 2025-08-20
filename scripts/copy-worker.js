// worker 从 src 复制到 out
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'jsonParserWorker.js');
const outDir = path.join(root, 'out');
const dest = path.join(outDir, 'jsonParserWorker.js');

if (!fs.existsSync(src)) {
  console.error('src/jsonParserWorker.js not found:', src);
  process.exit(1);
}
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.copyFileSync(src, dest);
console.log('Copied worker to', dest);