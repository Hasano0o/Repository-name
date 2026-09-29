import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { checkManual } from '../utils/arfcn';
import { bandLabel, freqLabel } from '../utils/bands';
import { SeenCell, seenKey } from '../store/seenCells';
import { C } from './theme';
import { GlassCard } from './GlassCard';

export interface ManualTarget { tech: 'LTE' | 'NR'; band: number; arfcn: string; pci: string }

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return m <= 1 ? 'الحين' : `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return `قبل ${Math.round(h / 24)} يوم`;
}

/** القفل اليدوي: تكتب رقم القناة والخلية، أو تختار من خلايا شفناها قبل */
export function ManualLock({ seen, visible, busy, onLock, initial }: {
  /** أرقام منسوخة من برج في القائمة */
  initial?: { tech: 'LTE' | 'NR'; arfcn: string; pci: string };
  seen: SeenCell[];
  /** مفاتيح الخلايا الظاهرة الحين — ما نكررها في «شفتها قبل» */
  visible: Set<string>;
  busy: boolean;
  onLock: (t: ManualTarget) => void;
}) {
  const [tech, setTech] = useState<'LTE' | 'NR'>(initial?.tech ?? 'LTE');
  const [arfcn, setArfcn] = useState(initial?.arfcn ?? '');
  const [pci, setPci] = useState(initial?.pci ?? '');
  const chk = checkManual(tech, arfcn, pci);

  const past = useMemo(
    () => seen
      .filter(c => !visible.has(seenKey(c)))
      .sort((a, b) => (b.bestRsrp ?? -999) - (a.bestRsrp ?? -999))
      .slice(0, 8),
    [seen, visible],
  );

  const fill = (c: SeenCell) => {
    setTech(c.tech);
    setArfcn(c.arfcn);
    setPci(c.pci);
  };

  return (
    <GlassCard title="القفل اليدوي" icon="🔐" tint={C.violetSoft} defaultOpen={!!initial}>
      {!!initial && <Text style={s.copied}>📋 نسخنا أرقام برج {initial.pci} — راجعها واضغط «ثبّت»، أو عدّلها</Text>}
      <Text style={s.hint}>
        تقفل على خلية تعرف أرقامها، حتى لو ما هي ظاهرة في القائمة الحين. اكتب رقم القناة والخلية، والتردد يطلع لحاله.
      </Text>

      <View style={s.seg}>
        {(['NR', 'LTE'] as const).map(t => (
          <Pressable key={t} style={[s.segBtn, tech === t && s.segOn]} onPress={() => setTech(t)}>
            <Text style={[s.segTxt, tech === t && { color: C.onAccent }]}>{t === 'NR' ? '5G' : '4G'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.row}>
        <View style={s.field}>
          <Text style={s.lbl}>رقم الخلية (PCI)</Text>
          <TextInput style={s.input} value={pci} onChangeText={setPci} keyboardType="number-pad" placeholder="مثلاً 217" placeholderTextColor={C.muted} maxLength={4} />
        </View>
        <View style={s.field}>
          <Text style={s.lbl}>{tech === 'NR' ? 'رقم القناة (NR-ARFCN)' : 'رقم القناة (EARFCN)'}</Text>
          <TextInput style={s.input} value={arfcn} onChangeText={setArfcn} keyboardType="number-pad" placeholder={tech === 'NR' ? 'مثلاً 632448' : 'مثلاً 500'} placeholderTextColor={C.muted} maxLength={6} />
        </View>
      </View>

      {chk.band !== undefined && (
        <Text style={s.band}>
          التردد: {bandLabel(tech, chk.band)} {freqLabel(tech, chk.band) ? `(${freqLabel(tech, chk.band)})` : ''} ✓
        </Text>
      )}
      {!!chk.error && <Text style={s.err}>{chk.error}</Text>}

      <Pressable
        style={[s.btn, (!chk.ok || busy) && s.dim]}
        disabled={!chk.ok || busy}
        onPress={() => chk.ok && onLock({ tech, band: chk.band!, arfcn: arfcn.trim(), pci: String(Number(pci.trim())) })}
      >
        <Text style={s.btnTxt}>ثبّت على هذي الخلية</Text>
      </Pressable>
      <Text style={s.hint}>التثبيت آمن: نقيس قبل وبعد، ولو الخلية ما اتصلت أو صارت أسوأ نرجّع إعدادك لحاله.</Text>

      {past.length > 0 && (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={s.sec}>خلايا شفتها قبل</Text>
          {past.map(c => (
            <Pressable key={seenKey(c)} style={s.past} onPress={() => fill(c)}>
              <Text style={s.use}>استخدم ‹</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.pastTitle, c.tech === 'NR' && { color: C.violet }]}>
                  {c.band ? bandLabel(c.tech, c.band) : c.tech === 'NR' ? '5G' : '4G'} · خلية {c.pci} · قناة {c.arfcn}
                </Text>
                <Text style={s.pastSub}>
                  {c.bestRsrp !== undefined ? `أقوى إشارة ${c.bestRsrp}` : ''}{c.bestSinr !== undefined ? ` · نقاء ${c.bestSinr}` : ''} · شفناها {c.times} مرة · آخرها {ago(c.lastSeen)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </GlassCard>
  );
}

const s = StyleSheet.create({
  copied: { color: C.violet, fontWeight: '800', fontSize: 12, textAlign: 'right', backgroundColor: C.card, borderRadius: 10, padding: 8 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'right', lineHeight: 19 },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: C.rowBg, borderWidth: 1, borderColor: C.cardBorder },
  segOn: { backgroundColor: C.blue, borderColor: C.blue },
  segTxt: { color: C.text, fontWeight: '800', fontSize: 14 },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, gap: 4 },
  lbl: { color: C.sub, fontSize: 11, textAlign: 'right' },
  input: { backgroundColor: C.rowBg, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  band: { color: C.green, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  err: { color: C.red, fontWeight: '700', fontSize: 12, textAlign: 'right' },
  btn: { backgroundColor: C.blue, borderRadius: 14, padding: 13, alignItems: 'center' },
  btnTxt: { color: C.onAccent, fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.45 },
  sec: { color: C.text, fontWeight: '800', fontSize: 14, textAlign: 'right' },
  past: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.rowBg, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 10 },
  use: { color: C.blue, fontWeight: '800', fontSize: 12 },
  pastTitle: { color: C.text, fontWeight: '800', fontSize: 13, textAlign: 'right' },
  pastSub: { color: C.sub, fontSize: 11, textAlign: 'right', marginTop: 2 },
});
