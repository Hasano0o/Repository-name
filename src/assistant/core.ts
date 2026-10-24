/**
 * مساعد Bandly — المنطق الصافي (بدون react-native): حالة المساعد + فهم الطلب.
 * ─────────────────────────────────────────────
 * • هذا الملف ما يلمس الراوتر أبداً. يحوّل كلام المستخدم لـ «إجراء» من قائمة محدودة (ACTIONS)،
 *   والتنفيذ الفعلي في run.ts عبر دوال Bandly الموجودة.
 * • الفهم محلي بالكامل (مطابقة كلمات) — ما يطلع أي نص من الجوال.
 * • حالة المساعد منفصلة تماماً عن الراوتر وإعداداته.
 */

// ═══ حالة المساعد ═══
export type AssistantMode = 'enabled' | 'paused' | 'disabled';

export interface AssistantState {
  mode: AssistantMode;
  /** وقت انتهاء الإيقاف المؤقت (ms) — null = لين يرجّعه المستخدم بنفسه */
  pausedUntil: number | null;
}

export const DEFAULT_STATE: AssistantState = { mode: 'enabled', pausedUntil: null };

/** الحالة الفعلية الحين: الإيقاف المؤقت ينتهي لحاله لو له وقت. الإيقاف الكامل ما ينتهي أبداً لحاله. */
export function effectiveMode(s: AssistantState, now = Date.now()): AssistantMode {
  if (s.mode === 'paused' && s.pausedUntil !== null && now >= s.pausedUntil) return 'enabled';
  return s.mode;
}

/** نقرأ الحالة المحفوظة بحذر: أي قيمة غريبة ← نعتبره مفعّل، إلا لو فيها «disabled» صريح */
export function parseState(raw: string | null | undefined): AssistantState {
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const v = JSON.parse(raw);
    if (v?.mode === 'disabled') return { mode: 'disabled', pausedUntil: null };
    if (v?.mode === 'paused') {
      const until = typeof v.pausedUntil === 'number' && Number.isFinite(v.pausedUntil) ? v.pausedUntil : null;
      return { mode: 'paused', pausedUntil: until };
    }
    return { ...DEFAULT_STATE };
  } catch {
    // الملف تالف — لو فيه كلمة disabled نحترمها (ما نشغّل المساعد غصب على المستخدم)
    return /disabled/.test(raw) ? { mode: 'disabled', pausedUntil: null } : { ...DEFAULT_STATE };
  }
}

export const pauseFor = (mins: number | null, now = Date.now()): AssistantState =>
  ({ mode: 'paused', pausedUntil: mins === null ? null : now + mins * 60_000 });

export const MODE_LABEL: Record<AssistantMode, string> = {
  enabled: 'شغّال',
  paused: 'موقف مؤقتاً',
  disabled: 'موقف بالكامل',
};

/** الوقت الباقي للإيقاف المؤقت بالعربي */
export function pauseLeft(s: AssistantState, now = Date.now()): string {
  if (s.mode !== 'paused') return '';
  if (s.pausedUntil === null) return 'لين ترجّعه بنفسك';
  const m = Math.max(1, Math.ceil((s.pausedUntil - now) / 60_000));
  if (m >= 60) return `باقي ${Math.round(m / 60)} ساعة`;
  return m === 1 ? 'باقي دقيقة' : m === 2 ? 'باقي دقيقتين' : `باقي ${m} دقيقة`;
}

// ═══ الإجراءات المسموحة ═══
export type Risk = 'none' | 'read' | 'write' | 'danger';

export type ActionId =
  | 'help' | 'check_signal' | 'ping_now' | 'best_band' | 'best_tower' | 'best_channel' | 'my_band' | 'temp' | 'autopilot'
  | 'open_ping' | 'open_finder' | 'open_aim' | 'open_towers' | 'open_speed' | 'open_devices'
  | 'open_newip' | 'open_wifich' | 'open_control' | 'open_details' | 'open_bands'
  | 'reboot' | 'reboot_now' | 'factory_reset' | 'power_off' | 'power_on';

export interface ActionDef {
  id: ActionId;
  /** نص الزر */
  label: string;
  /**
   * none = كلام بس · read = يقرأ من الراوتر/الشبكة بدون أي تغيير
   * write = يغيّر شي (يحتاج تأكيد) · danger = يمسح أو يقطع (تأكيد مضاعف — ما ينفّذه المساعد بنفسه حالياً)
   */
  risk: Risk;
  /** الشاشة اللي يفتحها (app/<route>/[id]) */
  route?: string;
  /** اسم الشاشة كما يشوفه المستخدم */
  screen?: string;
  /** الشاشة تبدأ المطلوب لحالها لما تنفتح (?auto=1) — اللي يقطع النت يعرض تأكيده أول */
  auto?: boolean;
}

export const ACTIONS: Record<ActionId, ActionDef> = {
  help: { id: 'help', label: 'وش تقدر تسوي؟', risk: 'none' },
  check_signal: { id: 'check_signal', label: 'افحص إشارتي', risk: 'read' },
  ping_now: { id: 'ping_now', label: 'كم البنق عندي؟', risk: 'read' },
  best_band: { id: 'best_band', label: 'اختار لي أفضل تردد', risk: 'write', route: 'optimize', screen: 'المُحسِّن التلقائي', auto: true },
  best_tower: { id: 'best_tower', label: 'أفضل برج', risk: 'write', route: 'towers', screen: 'الأبراج', auto: true },
  autopilot: { id: 'autopilot', label: 'اضبط لي كل شي', risk: 'write', route: 'autopilot', screen: 'اضبط لي كل شي', auto: true },
  best_channel: { id: 'best_channel', label: 'أفضل قناة واي فاي', risk: 'write', route: 'wifich', screen: 'قناة الواي فاي', auto: true },
  my_band: { id: 'my_band', label: 'ترددي الحالي', risk: 'read' },
  temp: { id: 'temp', label: 'حرارة الراوتر', risk: 'read' },
  open_ping: { id: 'open_ping', label: 'مُحسّن الألعاب', risk: 'write', route: 'ping', screen: 'مُحسّن الألعاب', auto: true },
  open_finder: { id: 'open_finder', label: 'اختار لي الأفضل', risk: 'none', route: 'finder', screen: 'اختار لي الأفضل' },
  open_aim: { id: 'open_aim', label: 'وجّه الأنتنا', risk: 'none', route: 'aim', screen: 'توجيه الأنتنا' },
  open_towers: { id: 'open_towers', label: 'الأبراج', risk: 'none', route: 'towers', screen: 'الأبراج' },
  open_speed: { id: 'open_speed', label: 'اختبر السرعة', risk: 'read', route: 'speed', screen: 'اختبار السرعة', auto: true },
  open_devices: { id: 'open_devices', label: 'الأجهزة المتصلة', risk: 'none', route: 'device', screen: 'الأجهزة' },
  open_newip: { id: 'open_newip', label: 'آي بي جديد', risk: 'none', route: 'newip', screen: 'آي بي جديد' },
  open_wifich: { id: 'open_wifich', label: 'قناة الواي فاي', risk: 'none', route: 'wifich', screen: 'قناة الواي فاي' },
  open_control: { id: 'open_control', label: 'مركز التحكم', risk: 'none', route: 'control', screen: 'مركز التحكم' },
  open_details: { id: 'open_details', label: 'التفاصيل', risk: 'none', route: 'details', screen: 'التفاصيل' },
  open_bands: { id: 'open_bands', label: 'الترددات', risk: 'none', route: 'bands', screen: 'الترددات' },
  reboot: { id: 'reboot', label: 'أعد تشغيل الراوتر', risk: 'write' },
  /** داخلي: ينفّذ بعد ما يأكد المستخدم — ما له كلمات */
  reboot_now: { id: 'reboot_now', label: 'إيه، أعد التشغيل', risk: 'write' },
  factory_reset: { id: 'factory_reset', label: 'ضبط المصنع', risk: 'danger', route: 'control', screen: 'مركز التحكم' },
  power_off: { id: 'power_off', label: 'طفّي الراوتر', risk: 'none' },
  power_on: { id: 'power_on', label: 'شغّل الراوتر', risk: 'none' },
};

/** أزرار البداية — أكثر شي يحتاجه المبتدئ */
export const QUICK: ActionId[] = ['check_signal', 'best_band', 'best_tower', 'open_ping', 'open_speed', 'open_aim'];

/** شبكة الأزرار الملوّنة في شاشة المساعد — مرتّبة: اعرف وضعك ← حسّنه ← الراوتر */
export const GRID: { title: string; items: ActionId[] }[] = [
  { title: 'اعرف وضعك', items: ['check_signal', 'my_band', 'temp', 'open_speed'] },
  { title: '🤖 خلّني أسويها عنك', items: ['autopilot'] },
  { title: 'حسّن اتصالك', items: ['best_band', 'best_tower', 'best_channel', 'open_ping'] },
  { title: 'الراوتر', items: ['reboot', 'power_off'] },
];

// ═══ فهم الكلام ═══
/** توحيد الكتابة: بدون تشكيل ولا تطويل، أ/إ/آ ← ا، ة ← ه، ى ← ي، أرقام هندية ← عربية */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** كلمات كل إجراء (مكتوبة بعد التوحيد). الأطول يكسب عند التعادل عشان «اعاده تشغيل» تغلب «تشغيل». */
const WORDS: [ActionId, string[]][] = [
  ['factory_reset', ['ضبط المصنع', 'اعدادات المصنع', 'فورمات', 'factory reset', 'فرمته', 'فرمت', 'ريسيت كامل', 'امسح كل شي', 'امسح الاعدادات']],
  ['reboot', ['اعد تشغيل الراوتر', 'اعاده تشغيل الراوتر', 'اعد تشغيل', 'اعاده تشغيل', 'اعيد تشغيل', 'ريستارت', 'restart', 'reboot', 'ريبوت', 'شغله من جديد', 'طفيه وشغله', 'طفه وشغله']],
  ['power_on', ['شغل الراوتر', 'ولع الراوتر', 'الراوتر طافي', 'الراوتر مطفي', 'الراوتر مقفل', 'افتح الراوتر']],
  ['power_off', ['طفي الراوتر', 'اطفي الراوتر', 'طف الراوتر', 'سكر الراوتر', 'قفل الراوتر', 'اطفاء الراوتر', 'شيل الكهربا', 'power off']],
  ['best_band', ['افضل تردد', 'احسن تردد', 'اقوى تردد', 'التردد الافضل', 'اختار لي تردد', 'اختر لي تردد', 'اختار تردد', 'افضل باند', 'جرب الترددات', 'المحسن التلقائي']],
  ['best_tower', ['افضل برج', 'احسن برج', 'اقوى برج', 'البرج الافضل', 'اختار لي برج', 'اختر لي برج', 'اختار برج', 'جرب الابراج', 'بنق الابراج']],
  ['autopilot', ['اضبط لي كل شي', 'اضبط كل شي', 'ظبط كل شي', 'ظبطه', 'اضبطه', 'سو كل شي', 'سوها عني', 'دير جهازي', 'ادير جهازي', 'دير الراوتر', 'حسن كل شي', 'اضبط لي الراوتر', 'اضبط الراوتر', 'رتب كل شي', 'اضبط لحالك', 'سويها بنفسك']],
  ['best_channel', ['افضل قناه', 'احسن قناه', 'انظف قناه', 'قناه الواي فاي', 'غير القناه', 'اختار قناه', 'اختار لي قناه']],
  ['my_band', ['ترددي', 'ترددي الحالي', 'وش ترددي', 'على اي تردد', 'وش التردد', 'التردد الحالي', 'اي باند', 'وش الباند']],
  ['temp', ['حراره', 'الحراره', 'حار', 'سخن', 'حراره الراوتر', 'حراره جهازي', 'درجه الحراره', 'حرارته']],
  ['ping_now', ['كم البنق', 'كم بنقي', 'قيس البنق', 'افحص البنق', 'وش البنق', 'البنق كم', 'ping test', 'كم الping']],
  ['open_ping', ['محسن الالعاب', 'بنق', 'ping', 'لاق', 'لاك', 'lag', 'تقطيع باللعب', 'العب', 'لعب', 'العاب', 'قيمنق', 'gaming', 'ببجي', 'pubg', 'فورت', 'كود', 'فيفا', 'فالو', 'روكيت']],
  ['check_signal', ['افحص اشارتي', 'افحص الاشاره', 'اشارتي', 'الاشاره', 'اشاره', 'قوه الاشاره', 'افحص', 'فحص', 'وش وضعي', 'وش حالتي', 'كيف الاتصال', 'الاتصال']],
  ['open_finder', ['الافضل', 'افضل', 'حسن', 'تحسين', 'سرعني', 'النت بطيء', 'بطيء', 'ثقيل', 'ضعيف', 'رجع النت قوي', 'best']],
  ['open_aim', ['انتنا', 'انتينا', 'انتين', 'هوائي', 'وجه', 'توجيه', 'اتجاه', 'مكان الراوتر', 'وين احط', 'antenna']],
  ['open_towers', ['برج', 'ابراج', 'الابراج', 'خليه', 'tower', 'cell']],
  ['open_bands', ['تردد', 'ترددات', 'باند', 'band', 'n78', 'n41', 'b3']],
  ['open_speed', ['سرعه', 'السرعه', 'اختبار السرعه', 'سبيد', 'speed', 'كم سرعتي', 'كم النت']],
  ['open_devices', ['اجهزه', 'الاجهزه', 'المتصلين', 'مين متصل', 'مين داخل', 'احظر', 'حظر']],
  ['open_newip', ['اي بي', 'ايبي', 'ip جديد', 'ip', 'اي بي جديد', 'عنوان جديد']],
  ['open_wifich', ['channel', 'تداخل']],
  ['open_control', ['اسم الواي فاي', 'كلمه الواي فاي', 'باسورد الواي فاي', 'رمز الواي فاي', 'واي فاي الضيوف', 'upnp', 'dmz', 'نور', 'انوار', 'الاضاءه', 'ليد', 'مركز التحكم', 'حجب', 'nat']],
  ['open_details', ['تفاصيل', 'الارقام', 'sinr', 'rsrp', 'rsrq', 'pci']],
  ['help', ['مساعده', 'ساعدني', 'وش تقدر', 'وش تسوي', 'help', 'كيف استخدم', 'وش اسوي']],
];
const WORDS_N: [ActionId, string[]][] = WORDS.map(([id, ws]) => [id, ws.map(normalize)]);

export interface Intent { action: ActionId; score: number }

/**
 * يرجع أفضل إجراء يطابق الكلام، أو null لو ما فهمنا.
 * النقاط = أطول كلمة مطابقة (بالحروف) — العبارة الطويلة الدقيقة تغلب الكلمة القصيرة العامة.
 * الكلمة لازم تكون كلمة كاملة (أو بداية كلمة) عشان «حسن» ما تطابق «احسن» بالغلط... إلا لو مقصودة.
 */
export function matchIntent(text: string): Intent | null {
  const t = ` ${normalize(text)} `;
  if (t.trim().length < 2) return null;
  let best: Intent | null = null;
  for (const [id, ws] of WORDS_N) {
    for (const w of ws) {
      if (!w) continue;
      // بداية كلمة: قبلها مسافة أو «ال/و/ب/ف/ل» ملتصقة
      const re = new RegExp(`(?:\\s|\\s(?:و|ب|ف|ل|ال|وال|بال))${escapeRe(w)}`);
      if (!re.test(t)) continue;
      const score = w.length;
      if (!best || score > best.score) best = { action: id, score };
    }
  }
  return best;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «اسمي حسن» / «انا حسن» / «سمني حسن» ← حسن */
export function extractName(text: string): string | null {
  const m = text.trim().match(/^(?:اسمي|إسمي|انا|أنا|سمني|ناديني|نادني|my name is|i'm|i am)\s+(.{1,24})$/i);
  const raw = (m ? m[1] : '').trim();
  return cleanName(raw);
}

/** الاسم: حروف ومسافات بس، ٢٤ حرف كحد أقصى، بدون أرقام أو روابط */
export function cleanName(raw: string): string | null {
  const v = raw.replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return v.length >= 2 ? v : null;
}
