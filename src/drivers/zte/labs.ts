/**
 * ZTE — «مزايا تجريبية» (٢٨ نوفمبر). كل الأوامر والحقول من service.js في ملفات «مو مدعوم؟» لعضوين
 * (dumps/mwjbsgc36pquqv · mwqpc8524zk9yg) — لسا ما انجرّبت على راوتر حقيقي، وأي رفض يطلع باسم الأمر ورده.
 *
 *  أولوية السرعة لكل جهاز (getAccessManagedDevicesMac / setWifiSpeedControl):
 *    قراءة  wifi_speed_control_enable · wifi_speed_high_mac_list · wifi_speed_low_mac_list
 *    كتابة  goformId=SET_WIFI_SPEED + نفس الثلاث حقول
 *  تبديل الأنتنا (getAntennaControlSetting / setAntennaControlSetting):
 *    قراءة  ant_switch_enable · ant_switch_idx · ant_switch_state_1 · ant_switch_state_2
 *    كتابة  goformId=WAN_ANT_SWITCH_SET + ant_switch_enable
 *  اختيار الشبكة يدوي (scanForNetwork / setNetwork / getNetSelectInfo):
 *    بحث    goformId=SCAN_NETWORK ← m_netselect_status لين ما يكون manual_selecting ← (network_)m_netselect_contents
 *           الصيغة «حالة,الاسم,الرقم,التقنية;…» (الصفحة: /([^,;]*),([^,]*),([^,]*),([^,;]*)/g)
 *    اختيار goformId=SET_NETWORK NetworkNumber + Rat (0 · 2 · 7 · 12) ← m_netselect_result manual_success/manual_fail (لين ١٢٠ث)
 *    تلقائي goformId=SET_BEARER_PREFERENCE بنفس net_select الحالي (نفس زر «تطبيق» في وضع تلقائي)
 */
import type { LabItem } from '../types';
import { tryVariants, type LabResult } from '../labVariants';

export interface ZteLabIo {
  get(fields: string[]): Promise<Record<string, string>>;
  act(body: Record<string, string>): Promise<string>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ok = (out: string) => /success/i.test(out);
const fail = (cmd: string, out: string) => new Error(`${cmd}: الراوتر رفض (${String(out || 'بدون رد').replace(/\s+/g, ' ').slice(0, 80)})`);

export const RAT_LABEL: Record<string, string> = { '0': '2G', '2': '3G', '7': '4G', '12': '5G' };

export interface NetChoice { state: number; name: string; numeric: string; rat: number }
/** نفس regex الصفحة */
export function parseNetList(raw: string): NetChoice[] {
  const out: NetChoice[] = [];
  const re = /([^,;]*),([^,]*),([^,]*),([^,;]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(raw ?? '')))) {
    const numeric = m[3].replace(/\D/g, '');
    const rat = parseInt(m[4], 10);
    if (!numeric || isNaN(rat)) continue;
    out.push({ state: parseInt(m[1], 10), name: m[2].replace(/"/g, '').trim(), numeric, rat });
  }
  return out;
}

/** قائمة MAC — الصفحة تحفظها نص؛ نحافظ على نفس الفاصل اللي يرجعه الراوتر (الافتراضي ;) */
export function macList(raw: string): string[] {
  return String(raw ?? '').split(/[;,]/).map(x => x.trim().toUpperCase()).filter(x => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(x));
}
export function joinMacs(list: string[], sample: string, force?: 'semi' | 'comma' | 'semiEnd'): string {
  const sep = force === 'comma' ? ',' : force ? ';' : /,/.test(sample) && !/;/.test(sample) ? ',' : ';';
  const end = force === 'semiEnd' || (!force && sep === ';' && /;\s*$/.test(sample));
  return list.length ? list.join(sep) + (end ? ';' : '') : '';
}
/** صيغ قائمة الأجهزة — child_mac_N في نفس الصفحة بفاصل ; ، فنبدأ فيها */
export const SPEED_VARIANTS = ['auto', 'semi', 'semiEnd', 'comma'];

export class ZteLabs {
  /** آخر بحث شبكات (يبقى بالذاكرة لين يطلع العضو من الشاشة) */
  private nets: NetChoice[] = [];
  constructor(private io: ZteLabIo, private devices: () => Promise<{ mac: string; name?: string }[]>) {}

  async list(): Promise<LabItem[]> {
    const out: LabItem[] = [];
    const r = await this.io.get([
      'wifi_speed_control_enable', 'wifi_speed_high_mac_list', 'wifi_speed_low_mac_list',
      'ant_switch_enable', 'ant_switch_idx', 'ant_switch_state_1', 'ant_switch_state_2',
      'network_net_select_mode', 'net_select_mode', 'net_select', 'network_net_select', 'network_provider', 'network_type',
    ]).catch(() => ({} as Record<string, string>));

    // ── أولوية السرعة ──
    if (r.wifi_speed_control_enable !== undefined && r.wifi_speed_control_enable !== '') {
      out.push({
        id: 'speed-on', group: 'أولوية السرعة', kind: 'toggle', cmd: 'SET_WIFI_SPEED',
        title: 'أولوية السرعة للأجهزة', desc: 'الجهاز «أولوية عالية» ياخذ السرعة قبل الباقي (مثل جوال اللعب).',
        value: r.wifi_speed_control_enable === '1' ? '1' : '0',
      });
      if (r.wifi_speed_control_enable === '1') {
        const hi = macList(r.wifi_speed_high_mac_list), lo = macList(r.wifi_speed_low_mac_list);
        const devs = await this.devices().catch(() => []);
        for (const d of devs.slice(0, 20)) {
          const mac = d.mac.toUpperCase();
          out.push({
            id: 'speed:' + mac, group: 'أولوية السرعة', kind: 'choice', cmd: 'SET_WIFI_SPEED',
            title: d.name || mac, desc: d.name ? mac : undefined,
            value: hi.includes(mac) ? 'high' : lo.includes(mac) ? 'low' : 'normal',
            options: [{ value: 'high', label: 'عالية' }, { value: 'normal', label: 'عادي' }, { value: 'low', label: 'منخفضة' }],
          });
        }
      }
    }

    // ── تبديل الأنتنا ──
    if (r.ant_switch_enable !== undefined && r.ant_switch_enable !== '') {
      const rows = [
        { label: 'ant_switch_idx', value: r.ant_switch_idx },
        { label: 'ant_switch_state_1', value: r.ant_switch_state_1 },
        { label: 'ant_switch_state_2', value: r.ant_switch_state_2 },
      ].filter(x => x.value);
      out.push({
        id: 'ant-switch', group: 'الأنتنا', kind: 'toggle', cmd: 'WAN_ANT_SWITCH_SET',
        title: 'تبديل الأنتنا (داخلي/خارجي)', desc: 'من إعدادات الأنتنا في صفحة راوترك — شغّله لو ركّبت أنتنا خارجي.',
        value: r.ant_switch_enable === '1' ? '1' : '0', rows,
        confirm: 'الراوتر ممكن يقطع النت ثواني وهو يبدّل الأنتنا. نكمل؟',
      });
    }

    // ── اختيار الشبكة ──
    const mode = r.network_net_select_mode || r.net_select_mode;
    if (mode !== undefined && mode !== '') {
      out.push({
        id: 'net-info', group: 'اختيار الشبكة', kind: 'info', title: 'الشبكة الحالية',
        rows: [
          { label: 'الشركة', value: r.network_provider || '—' },
          { label: 'التقنية', value: r.network_type || '—' },
          { label: 'الاختيار', value: /manual/i.test(mode) ? 'يدوي' : 'تلقائي' },
        ],
      });
      out.push({
        id: 'net-scan', group: 'اختيار الشبكة', kind: 'action', cmd: 'SCAN_NETWORK',
        title: 'دوّر على الشبكات', desc: 'يبحث عن كل الشركات والتقنيات حولك (ياخذ لين دقيقتين، والنت ممكن يفصل وقت البحث).',
        confirm: 'وقت البحث النت ممكن يفصل لين دقيقتين. نكمل؟',
      });
      if (this.nets.length) {
        out.push({
          id: 'net-pick', group: 'اختيار الشبكة', kind: 'choice', cmd: 'SET_NETWORK',
          title: 'اختر الشبكة', desc: 'الراوتر يثبت على الشبكة اللي تختارها. «تلقائي» يرجّعه يختار بنفسه.',
          confirm: 'الراوتر بيعيد الاتصال على الشبكة اللي اخترتها (النت يفصل شوي). نكمل؟',
          options: [
            { value: 'auto', label: 'تلقائي' },
            ...this.nets.map(n => ({ value: `${n.numeric}|${n.rat}`, label: `${n.name || n.numeric} · ${RAT_LABEL[String(n.rat)] ?? n.rat}${n.state === 3 ? ' (ممنوعة)' : n.state === 2 ? ' ✓' : ''}` })),
          ],
          value: this.nets.find(n => n.state === 2) ? `${this.nets.find(n => n.state === 2)!.numeric}|${this.nets.find(n => n.state === 2)!.rat}` : undefined,
        });
      }
    }
    return out;
  }

  async run(id: string, value?: string, prefer?: string): Promise<string | void | LabResult> {
    if (id === 'speed-on' || id.startsWith('speed:')) return tryVariants(SPEED_VARIANTS, prefer, v => this.setSpeed(id, value, v));
    if (id === 'ant-switch') {
      const out = await this.io.act({ goformId: 'WAN_ANT_SWITCH_SET', ant_switch_enable: value === '1' ? '1' : '0' });
      if (!ok(out)) throw fail('WAN_ANT_SWITCH_SET', out);
      await sleep(2000);
      const r = await this.io.get(['ant_switch_enable']);
      if ((r.ant_switch_enable === '1' ? '1' : '0') !== (value === '1' ? '1' : '0')) throw new Error(`WAN_ANT_SWITCH_SET: الراوتر قبل الأمر بس القراءة بعده ${r.ant_switch_enable ?? 'فاضية'}`);
      return 'تم';
    }
    if (id === 'net-scan') return this.scan();
    if (id === 'net-pick') return this.pick(value ?? '');
    throw new Error('ميزة غير معروفة: ' + id);
  }

  private async setSpeed(id: string, value?: string, variant = 'auto'): Promise<string> {
    const force = variant === 'auto' ? undefined : variant as 'semi' | 'comma' | 'semiEnd';
    const r = await this.io.get(['wifi_speed_control_enable', 'wifi_speed_high_mac_list', 'wifi_speed_low_mac_list']);
    let enable = r.wifi_speed_control_enable === '1' ? '1' : '0';
    let hi = macList(r.wifi_speed_high_mac_list), lo = macList(r.wifi_speed_low_mac_list);
    if (id === 'speed-on') enable = value === '1' ? '1' : '0';
    else {
      const mac = id.slice('speed:'.length).toUpperCase();
      hi = hi.filter(x => x !== mac); lo = lo.filter(x => x !== mac);
      if (value === 'high') hi.push(mac);
      if (value === 'low') lo.push(mac);
      enable = '1';
    }
    const body = {
      goformId: 'SET_WIFI_SPEED', wifi_speed_control_enable: enable,
      wifi_speed_high_mac_list: joinMacs(hi, r.wifi_speed_high_mac_list ?? '', force),
      wifi_speed_low_mac_list: joinMacs(lo, r.wifi_speed_low_mac_list ?? '', force),
    };
    const out = await this.io.act(body);
    if (!ok(out)) throw fail('SET_WIFI_SPEED', out);
    await sleep(1500);
    const a = await this.io.get(['wifi_speed_control_enable', 'wifi_speed_high_mac_list', 'wifi_speed_low_mac_list']);
    const same = (x: string[], y: string[]) => x.length === y.length && x.every(v => y.includes(v));
    if ((a.wifi_speed_control_enable === '1' ? '1' : '0') !== enable || (enable === '1' && (!same(macList(a.wifi_speed_high_mac_list), hi) || !same(macList(a.wifi_speed_low_mac_list), lo)))) {
      throw new Error(`SET_WIFI_SPEED: الراوتر قبل الأمر بس القراءة بعده مختلفة (${a.wifi_speed_control_enable}|${a.wifi_speed_high_mac_list}|${a.wifi_speed_low_mac_list})`);
    }
    return 'تم';
  }

  private async scan(): Promise<string> {
    const out = await this.io.act({ goformId: 'SCAN_NETWORK' });
    if (!ok(out)) throw fail('SCAN_NETWORK', out);
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const s = await this.io.get(['m_netselect_status']).catch(() => ({} as Record<string, string>));
      if (s.m_netselect_status !== 'manual_selecting') break;
    }
    const r = await this.io.get(['network_m_netselect_contents', 'm_netselect_contents']);
    const raw = r.network_m_netselect_contents || r.m_netselect_contents || '';
    this.nets = parseNetList(raw);
    if (!this.nets.length) throw new Error(`SCAN_NETWORK: البحث خلص بدون شبكات (${raw.slice(0, 60) || 'فاضي'})`);
    return `لقينا ${this.nets.length} شبكة — اختر من القائمة`;
  }

  private async pick(v: string): Promise<string> {
    if (v === 'auto') {
      const r = await this.io.get(['net_select', 'network_net_select']);
      const pref = r.net_select || r.network_net_select;
      if (!pref) throw new Error('SET_BEARER_PREFERENCE: ما قرينا وضع الشبكة الحالي — ما غيّرنا شي');
      const out = await this.io.act({ goformId: 'SET_BEARER_PREFERENCE', BearerPreference: pref });
      if (!ok(out)) throw fail('SET_BEARER_PREFERENCE', out);
      return 'رجع الاختيار تلقائي';
    }
    const [num, rat] = v.split('|');
    if (!num || !(rat in RAT_LABEL)) throw new Error('اختيار غير صحيح');
    const out = await this.io.act({ goformId: 'SET_NETWORK', NetworkNumber: num, Rat: rat });
    if (!ok(out)) throw fail('SET_NETWORK', out);
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const r = await this.io.get(['m_netselect_result']).catch(() => ({} as Record<string, string>));
      if (r.m_netselect_result === 'manual_success') return 'ثبت على الشبكة';
      if (r.m_netselect_result === 'manual_fail') throw new Error('SET_NETWORK: الراوتر ما قدر يتصل بالشبكة اللي اخترتها (manual_fail) — اختر «تلقائي»');
    }
    throw new Error('SET_NETWORK: ما وصلنا رد خلال دقيقتين (m_netselect_result)');
  }
}
