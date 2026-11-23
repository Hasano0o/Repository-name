/**
 * «سرّع واي فايك» (حسن ٢٣ نوفمبر — للألياف وأي راوتر): يفحص وش اللي يبطّئ الواي فاي ويعطي الحل.
 * المدخلات كلها اختيارية — الجوال (أندرويد: dBm/التردد/الربط)، البنق للراوتر، وإعدادات الراوتر لو مضاف ويدعمها.
 * صافي (بدون react-native) — ينختبر في tests/wifiBoost.test.ts.
 */
import { PhoneWifi, WifiRead, wifiBand, wifiWeak } from './fiberKit';

export type BoostFix = 'connect5' | 'split' | 'enable5' | 'channel' | 'rooms' | 'closer' | 'reboot';
export type BoostLevel = 'ok' | 'warn' | 'bad';
export interface BoostItem { key: string; level: BoostLevel; title: string; why: string; fix?: BoostFix; fixLabel?: string }

export interface BoostInput {
  phone?: PhoneWifi | null;
  lan?: WifiRead | null;
  /** شبكات الراوتر (من مركز التحكم) */
  nets?: { index: string; band: '2.4' | '5'; name: string }[];
  /** تشغيل كل نطاق */
  bands?: { band: '2.4' | '5'; on: boolean }[];
  /** الراوتر يسمح نغيّر القناة / الأسماء / تشغيل النطاق */
  can?: { channel?: boolean; rename?: boolean; bandOn?: boolean };
  /** سرعة الباقة (ميقا) لو العضو حددها */
  plan?: number;
  /** قنوات الراوتر (getWifiRadios) — '0' = تلقائي */
  radios?: { band: '2.4' | '5'; channel: string }[];
}

export function boostCheck(i: BoostInput): BoostItem[] {
  const out: BoostItem[] = [];
  const band = wifiBand(i.phone?.frequency);
  const rssi = typeof i.phone?.rssi === 'number' ? i.phone.rssi : undefined;
  const five = i.bands?.find(b => b.band === '5');
  const n24 = i.nets?.find(n => n.band === '2.4');
  const n5 = i.nets?.find(n => n.band === '5');
  const sameName = !!n24 && !!n5 && n24.name.trim() === n5.name.trim();

  // ١) شبكة 5 جيجا مطفية
  if (five && !five.on) {
    out.push({
      key: 'five-off', level: 'bad', title: 'شبكة 5 جيجا مطفية في راوترك',
      why: 'كل الأجهزة على 2.4 جيجا — بطيئة (حوالي ١٠٠ ميقا بالكثير) ومزحومة.',
      ...(i.can?.bandOn ? { fix: 'enable5' as const, fixLabel: 'شغّل 5 جيجا' } : {}),
    });
  }

  // ٢) الجوال على 2.4
  if (band === '2.4') {
    const strong = rssi !== undefined && rssi >= -65;
    if (sameName) {
      out.push({
        key: 'on24-same', level: 'warn', title: 'جوالك على 2.4 جيجا والشبكتين بنفس الاسم',
        why: 'الجوال يختار 2.4 لحاله. لو فصلنا 5 جيجا باسم ثاني تقدر تتصل فيها مباشرة.',
        ...(i.can?.rename ? { fix: 'split' as const, fixLabel: 'افصل الشبكتين' } : {}),
      });
    } else {
      out.push({
        key: 'on24', level: strong ? 'bad' : 'warn', title: 'جوالك على شبكة 2.4 جيجا',
        why: n5 ? `اتصل بشبكة «${n5.name}» (5 جيجا) — أسرع بكثير.` : 'اتصل بشبكة 5 جيجا من نفس الراوتر (غالباً في اسمها 5G) — أسرع بكثير.',
        fix: 'connect5', fixLabel: 'افتح إعدادات الواي فاي',
      });
    }
  } else if (band === '5' || band === '6') {
    out.push({ key: 'on5', level: 'ok', title: `جوالك على ${band} جيجا ✓`, why: 'هذي الشبكة السريعة.' });
  }

  // ٣) الإشارة
  if (rssi !== undefined) {
    if (rssi < -72) {
      out.push({ key: 'weak', level: 'bad', title: `إشارة الواي فاي ضعيفة (${rssi} dBm)`, why: 'بعيد عن الراوتر أو فيه جدران — السرعة تنزل كثير.', fix: 'rooms', fixLabel: 'افحص الغرف' });
    } else if (rssi < -65) {
      out.push({ key: 'mid', level: 'warn', title: `إشارة الواي فاي متوسطة (${rssi} dBm)`, why: 'قرّب من الراوتر شوي، أو ارفعه ووسّطه في البيت.', fix: 'closer' });
    } else {
      out.push({ key: 'strong', level: 'ok', title: `إشارة الواي فاي قوية (${rssi} dBm) ✓`, why: 'المسافة تمام.' });
    }
  }

  // ٤) التداخل/الزحمة: الإشارة قوية (أو ما نعرف) بس البنق للراوتر عالي أو متذبذب
  if (i.lan && i.lan.samples > 0) {
    const bad = wifiWeak(i.lan);
    const strongSig = rssi === undefined || rssi >= -67;
    if (bad && strongSig) {
      out.push({
        key: 'busy', level: 'bad', title: 'الواي فاي متذبذب — غالباً قناة مزحومة',
        why: `البنق للراوتر ${Math.round(i.lan.median)}ms وفيه تذبذب — شبكات الجيران على نفس القناة.`,
        ...(i.can?.channel ? { fix: 'channel' as const, fixLabel: 'دوّر على أنظف قناة' } : { fix: 'reboot' as const }),
      });
    } else if (bad) {
      out.push({ key: 'lanbad', level: 'warn', title: 'الاتصال بالراوتر متقطع', why: `البنق للراوتر ${Math.round(i.lan.median)}ms مع فقد ${Math.round(i.lan.lossPct)}٪.`, fix: 'rooms', fixLabel: 'افحص الغرف' });
    } else {
      out.push({ key: 'lanok', level: 'ok', title: 'الاتصال بالراوتر ثابت ✓', why: `البنق للراوتر ${Math.round(i.lan.median)}ms.` });
    }
  }

  // ٥) قناة 2.4 من الراوتر: 12/13 بعض الأجهزة ما تشوفها · غير 1/6/11 تتداخل مع الجيران
  const ch24 = i.radios?.find(r => r.band === '2.4')?.channel;
  const n = Number(ch24);
  if (ch24 && ch24 !== '0' && Number.isFinite(n) && n > 0) {
    if (n >= 12) {
      out.push({
        key: 'ch-high', level: 'warn', title: `قناة 2.4 جيجا على ${n}`,
        why: 'القنوات ١٢ و١٣ بعض الأجهزة (خصوصاً المستوردة) ما تشوفها، وتتداخل مع الجيران. الأفضل ١ أو ٦ أو ١١.',
        ...(i.can?.channel ? { fix: 'channel' as const, fixLabel: 'دوّر على أنظف قناة' } : {}),
      });
    } else if (![1, 6, 11].includes(n)) {
      out.push({
        key: 'ch-overlap', level: 'warn', title: `قناة 2.4 جيجا على ${n}`,
        why: 'القنوات غير ١ و٦ و١١ تتداخل مع قنوات الجيران اللي جنبها.',
        ...(i.can?.channel ? { fix: 'channel' as const, fixLabel: 'دوّر على أنظف قناة' } : {}),
      });
    }
  }

  // ٦) سرعة الربط أقل من الباقة (أندرويد)
  const link = i.phone?.linkSpeed ?? undefined;
  if (link && i.plan && link * 0.65 < i.plan * 0.8) {
    out.push({
      key: 'link', level: 'warn', title: `ربط جوالك بالراوتر ${link} ميقا بس`,
      why: `فعلياً يوصل حوالي ${Math.round(link * 0.65)} ميقا — أقل من باقتك (${i.plan}). قرّب أو اتصل بـ 5 جيجا.`,
    });
  }
  // ترتيب: الأسوأ أول
  const rank: Record<BoostLevel, number> = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** اسم شبكة 5 جيجا بعد الفصل (حد اسم الواي فاي ٣٢ حرف) */
export function splitName(name: string): string {
  const base = name.trim().replace(/[-_ ]?5G$/i, '');
  return (base.length > 29 ? base.slice(0, 29) : base) + '-5G';
}

/** نصائح ثابتة (ما نقدر نقرأها من أغلب الرواترات) */
export const BOOST_TIPS = [
  'عرض قناة 5 جيجا خلّه 80 ميقاهيرتز (أو 160 لو راوترك يدعم) — يضاعف سرعة الواي فاي',
  'جهاز اللعب أو التلفزيون القريب: وصّله بكيبل — سرعة الخط كاملة وبنق أقل',
  'أعد تشغيل الراوتر لو صار له أسابيع شغال، وحدّث برنامجه من صفحته',
  'الراوتر يكون مرتفع ووسط البيت، بعيد عن المطبخ والمرايا والخزائن الحديد',
];
