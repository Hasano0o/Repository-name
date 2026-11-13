import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTranslator, AR } from '../src/i18n/lookup';
import { EN, EN_PATTERNS } from '../src/i18n/en';

declare const require: (m: string) => any;
declare const process: { cwd(): string };
// الفاحص يقرأ ملفات المصدر — الاختبارات تشتغل من مجلد المشروع (node tests/run.cjs)
const ROOT = process.cwd();
const scan = require(require('path').join(ROOT, 'tests/i18nScan.cjs'));

/**
 * الشاشات والمكوّنات اللي ترجمتها كاملة. أي نص عربي جديد فيها بدون ترجمة في src/i18n/en.ts يفشّل الاختبار.
 * (شوف الناقص: node tests/i18nScan.cjs <الملف>)
 */
const DONE = [
  'app/index.tsx', 'app/_layout.tsx', 'app/setup.tsx', 'app/add-router.tsx', 'app/router/[id].tsx',
  'src/ui/HomeFooter.tsx', 'src/ui/HomeHeader.tsx', 'src/ui/BlockerAsk.tsx', 'src/ui/CityAsk.tsx', 'src/ui/States.tsx',
  'src/ui/WelcomeTour.tsx', 'src/ui/InviteCard.tsx', 'src/ui/ModeChips.tsx', 'src/ui/Congestion.tsx', 'src/ui/RegionGrid.tsx',
  'src/ui/TimeChart.tsx', 'src/ui/AimMeter.tsx', 'src/ui/ComboCard.tsx', 'src/ui/OpPill.tsx',
  // الدفعة ٢
  'app/control/[id].tsx', 'app/newip/[id].tsx', 'app/bands/[id].tsx', 'app/towers/[id].tsx',
  'app/aim/[id].tsx', 'app/gameboost/[id].tsx', 'app/speed/[id].tsx',
  // الدفعة ٣
  'app/ping/[id].tsx', 'app/hunt/[id].tsx', 'app/combo/[id].tsx', 'app/tech.tsx', 'app/wifich/[id].tsx',
  // الدفعة ٤
  'app/newdevice.tsx', 'app/autopilot/[id].tsx', 'app/places/[id].tsx', 'app/assistant/[id].tsx',
  'app/nrdual/[id].tsx', 'app/techs.tsx', 'src/ui/BandPicker.tsx',
  // الاستهلاك اليومي (١٣ نوفمبر)
  'src/ui/UsageDaysCard.tsx',
  'src/ui/UsageTableCard.tsx',
];

// ═══ القاموس نفسه ═══

test('القاموس: ولا ترجمة فيها عربي، والمتغيرات {0}{1} نفسها في العربي والإنجليزي', () => {
  const bad: string[] = [];
  for (const [k, v] of [...Object.entries(EN), ...Object.entries(EN_PATTERNS)]) {
    if (AR.test(v)) bad.push(`عربي في الترجمة: ${k.slice(0, 50)}`);
  }
  for (const [k, v] of Object.entries(EN_PATTERNS)) {
    const a = (k.match(/\{\d\}/g) ?? []).sort().join(), b = [...new Set(v.match(/\{\d\}/g) ?? [])].sort().join();
    // الإنجليزي ممكن يستغني عن متغير (حرف جر عربي مثلاً) بس ما يخترع واحد مو موجود
    if (b.split(',').some(x => x && !a.includes(x))) bad.push(`متغير زايد في الترجمة: ${k.slice(0, 50)}`);
  }
  assert.deepEqual(bad, []);
});

// ═══ المحرك ═══

const T = makeTranslator(
  { 'حفظ': 'Save', 'وضع تجريبي': 'Demo mode', 'تردد واحد يحد السرعة': 'a single band limits speed', 'السطر الأول': 'Line one', 'للراوتر': 'the router' },
  {
    '{0} ثانية': '{0} sec',
    'انقطع ثم فشل مرة ثانية · {0} ⟶ {1}': 'Dropped then failed again · {0} ⟶ {1}',
    'مثبّت على {0}{1}': 'Locked to {0}{1}',
    'تبي تحذف "{0}"؟': 'Delete "{0}"?',
    'ما قدرنا نوصل{0}.': "We couldn't reach{0}.",
  },
);

test('نص عادي ونمط بمتغير', () => {
  assert.equal(T.full('حفظ'), 'Save');
  assert.equal(T.full('30 ثانية'), '30 sec');
  assert.equal(T.full('  حفظ '), '  Save ');
});

test('نمط عام («{0} ثانية») ما يخطف جملة لها نمطها الخاص', () => {
  // قبل: التقسيم على « · » كان ياخذ «…مرة ثانية» بنمط «{0} ثانية» ويطلّع «…مرة sec»
  assert.equal(T.full('انقطع ثم فشل مرة ثانية · 404 ⟶ 500'), 'Dropped then failed again · 404 ⟶ 500');
});

test('نمط عام ما يطلّع نص نصه عربي: جملة طويلة أو جزء ثابت قصير ← تبقى عربي كاملة', () => {
  const G = makeTranslator({}, { '{0} ثانية': '{0} sec', '{0}م': '{0} PM', 'تبي تحذف "{0}"؟': 'Delete "{0}"?' });
  assert.equal(G.core('انقطع ثم رد وفشل مرة ثانية'), null);
  assert.equal(G.core('السلام عليكم'), null);
  assert.equal(G.full('10م'), '10 PM');
  // اسم قصير جوا نمط واضح ← ينقبل
  assert.equal(G.full('تبي تحذف "راوتر البيت"؟'), 'Delete "راوتر البيت"?');
  // جملة طويلة جوا نفس النمط ← لا
  assert.equal(G.core('تبي تحذف "هذا نص طويل مو اسم أبداً"؟'), null);
});

test('«أ · ب»: كل جزء لحاله لو كلها معروفة، والجزء اللاتيني يبقى', () => {
  assert.equal(T.full('STC · وضع تجريبي'), 'STC · Demo mode');
});

test('متغير عربي جوا النمط ينترجم لو له ترجمة، واسم المستخدم يبقى مثل ما هو', () => {
  assert.equal(T.full('ما قدرنا نوصل للراوتر.'), "We couldn't reach the router.");
  assert.equal(T.full('تبي تحذف "راوتر البيت"؟'), 'Delete "راوتر البيت"?');
  assert.equal(T.full('مثبّت على B3 — تردد واحد يحد السرعة'), 'Locked to B3 — a single band limits speed');
});

test('أكثر من سطر: اللي نعرفه ينترجم والباقي يبقى', () => {
  assert.equal(T.full('السطر الأول\nسطر مجهول'), 'Line one\nسطر مجهول');
});

test('ما له ترجمة ← يرجع نفسه (null من core) والأرقام العربية تتحول', () => {
  assert.equal(T.core('نص مجهول'), null);
  assert.equal(T.full('نص مجهول ٥٪'), 'نص مجهول 5%');
  assert.equal(T.full('١'), '1');
  assert.equal(T.full('hello'), 'hello');
});

// ═══ التغطية ═══

test('الفاحص: يطلّع نصوص JSX والقوالب، ويتجاهل السجلات والمقارنات', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-scan-'));
  fs.writeFileSync(path.join(dir, 'x.tsx'), `
    // تعليق عربي
    const a = <Text>عدد الأجهزة {n} جهاز</Text>;
    const b = <Text>{busy ? 'نحفظ' : 'حفظ'}</Text>;
    const c = \`باقي \${m} دقيقة\`;
    diag('سجل للمطوّر');
    if (x === 'مقارنة' || s.includes('بحث')) {}
    const o = { 'مفتاح': 1 };
    Alert.alert('عنوان', 'رسالة');
  `);
  const got = [...scan.scanFile(dir, 'x.tsx').keys()].sort();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(got, ['باقي {0} دقيقة', 'حفظ', 'رسالة', 'عدد الأجهزة {0} جهاز', 'عنوان', 'نحفظ'].sort());
});

test('الشاشات المكتملة: ولا نص عربي بدون ترجمة', () => {
  const dict = scan.loadDict(ROOT);
  const miss: string[] = [];
  for (const f of DONE) for (const m of scan.missingIn(ROOT, f, dict)) miss.push(`${f}:${m.line} ${m.text.slice(0, 70)}`);
  assert.deepEqual(miss, [], 'نصوص ناقصة — أضفها في src/i18n/en.ts');
});
