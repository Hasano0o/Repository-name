/**
 * ZTE TopFlow MU5252 — «مركز التحكم» من صفحة الجهاز نفسه (FULL ٩ نوفمبر، فيرموير BD_ENCNMU5252V1.0.0B24).
 * منطق صافي عشان ينختبر. كل أمر هنا موجود في صفحة من قائمة الجهاز (menu.js):
 *  • الكهرباء المباشرة (power_supply.js): قراءة zwrt_deviceui.zwrt_deviceui_direct_power_mode_get {moduleName:"web"} ← enable
 *    كتابة zwrt_bsp.charger.set {direct_power_supply_mode:"enable"|"disable"}
 *  • إعادة التشغيل المجدولة (system_setting.js): قراءة uci zwrt_zte_mc/reboot_schedule ·
 *    كتابة zwrt_mc.device.manager.set_device_info {deviceInfoList:{reboot_schedule_enable, reboot_schedule_mode, …}}
 *    الوضع: "1" أسبوعي (reboot_dow + hour1:min1) · "2" يومي (hour2:min2)
 *  • مراقبة الاتصال watchdog (system_setting.js): قراءة uci zwrt_router/watchdog ·
 *    كتابة zwrt_router.api.router_set_watchdog {enable, url, url2, ping_times, time_gap} (الإطفاء = {enable:0} بس، مثل الصفحة)
 */

export interface RebootSchedule {
  enable: string; mode: string; hour1: string; min1: string; hour2: string; min2: string;
  th1: string; th2: string; dow: string; dod: string;
}
export interface Watchdog { on: boolean; url: string; url2: string; pingTimes: string; timeGap: string }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const i = (v: string, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

export function parseRebootSchedule(v: Record<string, unknown> | null | undefined): RebootSchedule | null {
  if (!v || (v.reboot_schedule_enable === undefined && v.reboot_schedule_mode === undefined)) return null;
  return {
    enable: s(v.reboot_schedule_enable), mode: s(v.reboot_schedule_mode),
    hour1: s(v.reboot_hour1), min1: s(v.reboot_min1), hour2: s(v.reboot_hour2), min2: s(v.reboot_min2),
    th1: s(v.reboot_timeframe_hours1), th2: s(v.reboot_timeframe_hours2), dow: s(v.reboot_dow), dod: s(v.reboot_dod),
  };
}

/** للعرض في مركز التحكم (autoReboot): أسبوعي = كل ٧ أيام · يومي = كل يوم — from/to بالدقائق من منتصف الليل */
export function rebootView(r: RebootSchedule): { on: boolean; everyDays: number; from: number; to: number } {
  const weekly = r.mode === '1';
  const from = weekly ? i(r.hour1) * 60 + i(r.min1) : i(r.hour2) * 60 + i(r.min2);
  return { on: r.enable === '1', everyDays: weekly ? 7 : 1, from, to: from };
}

/** نفس الجسم اللي ترسله الصفحة (setRebootScheduleFixTime) — بس نبدّل التشغيل، والباقي كما قرأناه */
export function rebootBody(r: RebootSchedule, on: boolean): Record<string, string> {
  return {
    reboot_schedule_enable: on ? '1' : '0', reboot_schedule_mode: r.mode,
    reboot_hour1: r.hour1, reboot_min1: r.min1, reboot_hour2: r.hour2, reboot_min2: r.min2,
    reboot_timeframe_hours1: r.th1, reboot_timeframe_hours2: r.th2, reboot_dow: r.dow, reboot_dod: r.dod,
  };
}

/** التشغيل يحتاج جدول مضبوط قبل (وضع ووقت) — ما نخترع وقت للعضو */
export const rebootReady = (r: RebootSchedule) => (r.mode === '1' || r.mode === '2') && (r.mode === '1' ? r.hour1 !== '' : r.hour2 !== '');

export function parseWatchdog(v: Record<string, unknown> | null | undefined): Watchdog | null {
  if (!v || v.enable === undefined) return null;
  return { on: s(v.enable) === '1', url: s(v.url), url2: s(v.url2), pingTimes: s(v.ping_times), timeGap: s(v.time_gap) };
}

/** نفس setWatchDogSetting في الصفحة: الإطفاء {enable:0} بس، والتشغيل مع الرابط والمرات والفاصل كما هي */
export function watchdogBody(w: Watchdog, on: boolean): Record<string, unknown> {
  if (!on) return { enable: 0 };
  return { enable: 1, url: w.url, url2: w.url2, ping_times: i(w.pingTimes, 3), time_gap: i(w.timeGap, 60) };
}

export const watchdogReady = (w: Watchdog) => w.url !== '' && i(w.pingTimes) > 0 && i(w.timeGap) > 0;

/** direct_power_mode_get ← enable "1"/"0" */
export function parseDirectPower(v: Record<string, unknown> | null | undefined): boolean | undefined {
  if (!v || v.enable === undefined) return undefined;
  return s(v.enable) === '1';
}
