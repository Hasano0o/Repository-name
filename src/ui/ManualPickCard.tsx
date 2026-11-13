/**
 * «✋ اختار بنفسي» — بطاقة مشتركة لشاشات الفحص التلقائي للترددات (دمج 4G+5G، مختبر الدمج، المُحسّن).
 * العضو يختار ترددات 4G و5G (ترددات شركته اللي يدعمها راوتره + «اعرض كل الترددات»)،
 * وبعدها «جرّب اختياري» (الشاشة تبني التركيبات منها) أو «ثبّت على طول» (safeApply في الشاشة).
 */
import { useState } from 'react';
import { View, Text, Pressable } from '../i18n/rn';
import type { BandConfig } from '../drivers/types';
import { useOperatorBands } from '../store/operator';
import { freqLabel } from '../utils/bands';
import { C, R, S } from './theme';
import { sheet } from '../i18n';

export interface ManualPickProps {
  routerId: string;
  cfg: BandConfig;
  /** ترددات الشاشة اختارتها تلقائياً — تطلع دايم حتى لو مو من ترددات الشركة */
  lteTop: number[];
  nrTop: number[];
  pickLte: number[];
  pickNr: number[];
  setPickLte: (v: number[]) => void;
  setPickNr: (v: number[]) => void;
  running: boolean;
  intro: string;
  /** سطر يوضح وش بنجرب (أو null لو الاختيار ناقص) */
  preview: string | null;
  /** لو الاختيار ناقص */
  needHint: string;
  onTry?: () => void;
  onApply?: () => void;
  /** لون الشاشة */
  accent: string;
  /** يطلع قسم 5G؟ (المُحسّن يقدر يجرّب 4G بس) */
  showNr?: boolean;
}

export function ManualPickCard(p: ManualPickProps) {
  const op = useOperatorBands(p.routerId);
  const [open, setOpen] = useState(false);
  const [allBands, setAllBands] = useState(false);
  const nrPool = p.cfg.nrPreferred?.length ? p.cfg.nrPreferred : p.cfg.nrSupported;
  const keepLte = (b: number) => allBands || !op || op.bands.lte.includes(b) || p.lteTop.includes(b) || p.pickLte.includes(b);
  const keepNr = (b: number) => allBands || !op || op.bands.nr.includes(b) || p.nrTop.includes(b) || p.pickNr.includes(b);
  const lteChoices = [...p.cfg.supported].sort((a, b) => a - b).filter(keepLte);
  const nrChoices = (p.showNr === false ? [] : [...nrPool].sort((a, b) => a - b)).filter(keepNr);
  const hidden = op && !allBands
    ? (p.cfg.supported.length - lteChoices.length) + (p.showNr === false ? 0 : nrPool.length - nrChoices.length)
    : 0;
  const toggle = (list: number[], set: (v: number[]) => void, b: number) =>
    set(list.includes(b) ? list.filter(x => x !== b) : [...list, b]);

  return (
    <View style={s.card}>
      <Pressable onPress={() => setOpen(v => !v)} hitSlop={6} style={s.head}>
        <Text style={s.title}>✋ اختار بنفسي</Text>
        <Text style={[s.toggle, { color: p.accent }]}>{open ? 'اخفِ' : 'افتح'}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.body}>{p.intro}</Text>
          <Text style={s.pickTitle}>4G</Text>
          <View style={s.chips}>
            {lteChoices.map(b => {
              const on = p.pickLte.includes(b);
              return (
                <Pressable key={'l' + b} disabled={p.running} onPress={() => toggle(p.pickLte, p.setPickLte, b)} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipTxt, on && s.chipTxtOn]}>B{b}</Text>
                  {!!freqLabel('LTE', b) && <Text style={[s.chipSub, on && s.chipTxtOn]}>{freqLabel('LTE', b)}</Text>}
                </Pressable>
              );
            })}
          </View>
          {nrChoices.length > 0 && (
            <>
              <Text style={s.pickTitle}>5G</Text>
              <View style={s.chips}>
                {nrChoices.map(b => {
                  const on = p.pickNr.includes(b);
                  return (
                    <Pressable key={'n' + b} disabled={p.running} onPress={() => toggle(p.pickNr, p.setPickNr, b)} style={[s.chip, on && s.chipOnNr]}>
                      <Text style={[s.chipTxt, on && s.chipTxtOn]}>n{b}</Text>
                      {!!freqLabel('NR', b) && <Text style={[s.chipSub, on && s.chipTxtOn]}>{freqLabel('NR', b)}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {!!op && (hidden > 0 || allBands) && (
            <Pressable onPress={() => setAllBands(v => !v)} hitSlop={6}>
              <Text style={[s.more, { color: p.accent }]}>{allBands ? `اعرض ترددات ${op.name} بس` : `معروض ترددات ${op.name} بس · اعرض كل ترددات الراوتر (+${hidden})`}</Text>
            </Pressable>
          )}
          {p.preview ? (
            <>
              <Text style={s.meta}>{p.preview}</Text>
              <View style={s.btnRow}>
                {!!p.onTry && (
                  <Pressable style={[s.btn, { backgroundColor: p.accent }, p.running && s.off]} disabled={p.running} onPress={p.onTry}>
                    <Text style={s.btnText}>▶ جرّب اختياري</Text>
                  </Pressable>
                )}
                {!!p.onApply && (
                  <Pressable style={[s.btn, { backgroundColor: C.green }, p.running && s.off]} disabled={p.running} onPress={p.onApply}>
                    <Text style={s.btnText}>ثبّت على طول</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : (
            <Text style={s.note}>{p.needHint}</Text>
          )}
        </>
      )}
    </View>
  );
}

const s = sheet({
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1.5, borderRadius: R.lg, padding: S.lg, gap: S.sm },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 17, textAlign: 'right' },
  toggle: { fontWeight: '800', fontSize: 13 },
  body: { color: C.sub, fontSize: 13, lineHeight: 21, textAlign: 'right' },
  meta: { color: C.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  pickTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right', marginTop: 4 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', minWidth: 58, backgroundColor: C.card },
  chipOn: { backgroundColor: '#2f6bff', borderColor: '#2f6bff' },
  chipOnNr: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  chipTxt: { color: C.text, fontWeight: '800', fontSize: 13 },
  chipSub: { color: C.muted, fontSize: 10 },
  chipTxtOn: { color: '#ffffff' },
  more: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
  btnRow: { flexDirection: 'row-reverse', gap: 8 },
  btn: { flex: 1, borderRadius: R.md, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnText: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  off: { opacity: 0.5 },
  note: { color: C.muted, fontSize: 11.5, textAlign: 'right', lineHeight: 17 },
});
