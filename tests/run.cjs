// يشغّل اختبارات tests/*.test.ts بدون أي مكتبة جديدة:
// يحوّل ملفات TypeScript لـ JavaScript بالـ typescript الموجود أصلاً، وبعدها node --test.
// التشغيل: node tests/run.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bandly-tests-'));

// الملفات اللي تحتاجها الاختبارات (كلها بدون react-native)
const files = [
  'src/drivers/noChange.ts',
  'src/drivers/huawei/cellLock.ts',
  'src/utils/applyGuard.ts',
  'src/utils/bands.ts',
  'src/utils/advisor.ts',
  'src/drivers/huawei/netStandard.ts',
  ...fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`),
];

for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: rel,
  }).outputText;
  const dest = path.join(out, rel.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, js);
}

const tests = files.filter(f => f.endsWith('.test.ts')).map(f => path.join(out, f.replace(/\.ts$/, '.js')));
const r = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
