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
  'src/drivers/huawei/session.ts',
  'src/utils/applyGuard.ts',
  'src/utils/bands.ts',
  'src/utils/advisor.ts',
  'src/drivers/huawei/netStandard.ts',
  'src/drivers/huawei/rsaEnc.ts',
  'src/drivers/lockSnapshot.ts',
  'src/drivers/huawei/lockState.ts',
  'src/drivers/zte/lockState.ts',
  'src/store/routerLockCore.ts',
  'src/store/routerIdentityCore.ts',
  'src/assistant/core.ts',
  'src/drivers/models.ts',
  'src/drivers/zyxel/crypto.ts',
  'src/drivers/fiberhome/crypto.ts',
  'src/drivers/fiberhome/nodes.ts',
  'src/drivers/fiberhome/extras.ts',
  'src/drivers/fiberhome/index.ts',
  'src/drivers/oppo/crypto.ts',
  'src/drivers/oppo/parse.ts',
  'src/drivers/oppo/index.ts',
  'src/drivers/greenpacket/parse.ts',
  'src/drivers/greenpacket/index.ts',
  'src/drivers/zteufi/index.ts',
  'src/services/amdRefs.ts',
  'src/drivers/zte/writeResult.ts',
  'src/drivers/zte/u30.ts',
  // درايفر ZTE كامل (للاختبار بالمحاكاة — AsyncStorage يتبدّل ببديل داخل الاختبار)
  'src/drivers/zte/index.ts',
  'src/drivers/zte/extras.ts',
  'src/drivers/zte/formulaStore.ts',
  'src/drivers/zteng/index.ts',
  'src/drivers/http.ts',
  'src/services/diag.ts',
  'src/utils/snapshot.ts',
  'src/utils/normalize.ts',
  'src/drivers/noChange.ts',
  'src/services/routerDump.ts',
  'src/services/live.ts',
  'src/utils/host.ts',
  'src/drivers/types.ts',
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
const testEnv = {
  ...process.env,
  NODE_PATH: [
    path.join(root, 'node_modules'),
    process.env.NODE_PATH
  ].filter(Boolean).join(path.delimiter),
};
const r = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
  env: testEnv,
});
fs.rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
