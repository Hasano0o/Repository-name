// يطلّع مناطق سيرفرات الألعاب من src/utils/latency.ts (نفس اللي يقيسها التطبيق) — سيرفر المسرّع يقيس نفسها.
// التشغيل: node accel/regions.cjs > accel/regions.json   (والاختبار tests/accelRegions.test.ts يتأكد إنها متطابقة)
const fs = require('fs');
const path = require('path');
function regions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/latency.ts'), 'utf8');
  const out = {};
  const re = /\{\s*id:\s*'([^']+)'[^\n]*?url:\s*([^,]+),\s*alt:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1];
    if (id === 'cf') continue;
    const url = m[2].trim().replace(/^'|'$/g, '');
    const alt = [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1]);
    out[id] = [url, ...alt];
  }
  return out;
}
module.exports = { regions };
if (require.main === module) process.stdout.write(JSON.stringify(regions(), null, 1) + '\n');
