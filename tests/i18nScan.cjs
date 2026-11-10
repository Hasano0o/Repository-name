/**
 * فاحص الترجمة: يطلّع كل نص عربي يشوفه المستخدم من ملفات الشاشات، ويقول وش منها ما له ترجمة في src/i18n/en.ts.
 *
 * • يقرأ الكود بمحلل TypeScript (مو regex): نصوص JSX، النصوص العادية، والقوالب `…${x}…` (تتحول «…{0}…» مثل مفاتيح EN_PATTERNS).
 * • يحكم بنفس منطق tr() في src/i18n/index.ts (قاموس ← أنماط ← تقسيم السطور والفواصل) — نص ينحسب مترجم بس لو ما بقى فيه عربي.
 * • ما يحسب: التعليقات، سجلات المطوّر (diag / console / reportError…)، مفاتيح الكائنات، ونصوص المقارنة (includes / startsWith…).
 *
 * الاستخدام:
 *   node tests/i18nScan.cjs                 ← ملخص لكل ملف
 *   node tests/i18nScan.cjs app/setup.tsx   ← النصوص الناقصة في ملف (أو أكثر)
 *   node tests/i18nScan.cjs --json app/…    ← نفسها JSON
 * والاختبار tests/i18nCoverage.test.ts يستخدمه عشان الشاشات المكتملة ما يدخلها نص بدون ترجمة.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const AR = /[؀-ۿ]/;
const norm = s => s.replace(/\s+/g, ' ').trim();
/** نصوص تبقى عربي عمداً (اسم اللغة في زر تبديل اللغة) */
const KEEP_AR = new Set(['ع', 'عربي', 'العربية']);

// ─── القاموس + محرك الترجمة الحقيقي (src/i18n/lookup.ts — مو نسخة منه) ───
function loadTs(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
  return mod.exports;
}
function loadDict(root) {
  const { EN, EN_PATTERNS } = loadTs(root, 'src/i18n/en.ts');
  const { makeTranslator } = loadTs(root, 'src/i18n/lookup.ts');
  const T = makeTranslator(EN, EN_PATTERNS);
  return { tr: T.full, core: T.core, size: T.size, patterns: T.patterns(), EN, EN_PATTERNS };
}

// ─── استخراج النصوص ───
/** دوال ما يشوف المستخدم نصوصها (سجلات وتشخيص للمطوّر) */
const SKIP_CALLS = new Set(['diag', 'reportError', 'logErr', 'log', 'warn', 'error', 'debug', 'info', 'sendSupportReport', 'markLogin', 'screenOpened', 'require']);
/** دوال مقارنة — نصها مو للعرض */
const MATCH_CALLS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'match', 'test', 'split', 'replace', 'replaceAll', 'search', 'has', 'get', 'getItem', 'setItem', 'removeItem']);
/** خصائص JSX ما تنعرض */
const SKIP_ATTRS = new Set(['testID', 'key', 'nativeID', 'name', 'id', 'href', 'pathname', 'accessibilityRole']);

function jsxText(raw) {
  // نفس قاعدة JSX: كل سطر ينقص من أطرافه، والسطور الفاضية تنشال، والباقي ينوصل بمسافة
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw;
  return lines.map((l, i) => {
    let t = l.replace(/\t/g, ' ');
    if (i !== 0) t = t.replace(/^ +/, '');
    if (i !== lines.length - 1) t = t.replace(/ +$/, '');
    return t;
  }).filter(Boolean).join(' ');
}

function scanFile(root, rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const units = new Map(); // النص ← { أول سطر ظهر فيه، النص قبل توحيد المسافات (فيه السطور) }
  const add = (s, node) => {
    const k = norm(s);
    if (!k || !AR.test(k) || k.length > 900 || KEEP_AR.has(k)) return;
    if (!units.has(k)) units.set(k, { line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, raw: s });
  };
  const callName = n => {
    const e = n.expression;
    return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
  };
  const skipped = node => {
    for (let p = node.parent, c = node; p; c = p, p = p.parent) {
      if (ts.isCallExpression(p) && p.arguments.includes(c)) {
        const nm = callName(p);
        if (SKIP_CALLS.has(nm)) return true;
        if (MATCH_CALLS.has(nm) && c === node) return true;
      }
      if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText(sf))) return true;
      if (ts.isBinaryExpression(p) && c === node && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) return true;
      if (ts.isCaseClause(p) && p.expression === c) return true;
      if (ts.isPropertyAssignment(p) && p.name === c) return true;
      if (ts.isElementAccessExpression(p) && p.argumentExpression === c) return true;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isTypeNode(p)) return true;
      if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
    }
    return false;
  };
  const visit = node => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children.filter(c => !(ts.isJsxText(c) && !c.text.trim()) && !(ts.isJsxExpression(c) && !c.expression));
      const flat = kids.every(c => ts.isJsxText(c) || ts.isJsxExpression(c));
      if (flat && kids.some(c => ts.isJsxText(c) && AR.test(c.text))) {
        // «نص {قيمة} نص»: وقت التشغيل الأجزاء تنضم وتنترجم كجملة وحدة ← مفتاح بـ {0} {1}…
        let i = 0, s = '';
        for (const c of kids) {
          if (ts.isJsxText(c)) s += jsxText(c.text);
          else if (ts.isStringLiteralLike(c.expression)) s += c.expression.text;
          else s += `{${i++}}`;
        }
        if (!skipped(node)) add(s, node);
        for (const c of kids) if (ts.isJsxExpression(c)) visit(c);
        return;
      }
      for (const c of node.children) {
        if (ts.isJsxText(c)) { if (AR.test(c.text) && !skipped(c)) add(jsxText(c.text), c); } else visit(c);
      }
      visit(ts.isJsxElement(node) ? node.openingElement : node.openingFragment);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (AR.test(node.text) && !skipped(node)) add(node.text, node);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const s = node.head.text + node.templateSpans.map((sp, i) => `{${i}}` + sp.literal.text).join('');
      if (AR.test(s) && !skipped(node)) add(s, node);
      node.templateSpans.forEach(sp => visit(sp.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
}

/** النصوص اللي ما لها ترجمة كاملة في ملف: [{ text, line }] */
function missingIn(root, rel, dict) {
  const out = [];
  for (const [text, u] of scanFile(root, rel)) {
    // المتغيرات نعوّضها بقيمة لاتينية ونشوف: بقى عربي؟ = ناقص
    const sample = text.replace(/\{(\d+)\}/g, (_, i) => 'X' + i);
    if (AR.test(dict.tr(sample))) out.push({ text, line: u.line, raw: u.raw });
  }
  return out;
}

function listFiles(root, dirs) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$|\.test\.ts$/.test(e.name)) out.push(rel);
    }
  };
  dirs.forEach(walk);
  return out.sort();
}

module.exports = { loadDict, scanFile, missingIn, listFiles, AR, norm };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter(a => !a.startsWith('--'));
  const dict = loadDict(root);
  if (files.length) {
    const res = {};
    for (const f of files) res[f] = missingIn(root, f, dict);
    if (json) console.log(JSON.stringify(res, null, 1));
    else for (const f of files) { console.log(`\n== ${f} — ناقص ${res[f].length}`); for (const m of res[f]) console.log(`${m.line}\t${m.text}`); }
  } else {
    let T = 0, M = 0;
    const rows = listFiles(root, ['app', 'src']).filter(f => !f.startsWith('src/i18n/')).map(f => {
      const all = scanFile(root, f).size, miss = all ? missingIn(root, f, dict).length : 0;
      T += all; M += miss;
      return [f, all, miss];
    }).filter(r => r[1]);
    rows.sort((a, b) => b[2] - a[2]);
    console.log(`القاموس: ${dict.size} نص + ${dict.patterns} نمط · نصوص التطبيق: ${T} · مترجم: ${T - M} (${Math.round((T - M) * 100 / T)}%) · ناقص: ${M}`);
    for (const [f, all, miss] of rows) console.log(`${String(miss).padStart(4)} / ${String(all).padEnd(4)} ${f}`);
  }
}
