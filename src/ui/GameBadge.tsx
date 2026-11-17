/**
 * بطاقة «لعبتك» فوق مُحسّن الألعاب (١٧ نوفمبر): اللعبة اللي اختارها العضو بألوانها،
 * وش يهمها (البنق)، هدفها، آخر بنق قسناه لسيرفرها، ونصيحة خاصة فيها. «غيّر» يفتح «وش بتلعب؟».
 * الكونسول ← زر لفحص NAT في «تعزيز اللعب».
 */
import { View, Text, Pressable } from '../i18n/rn';
import { LinearGradient } from 'expo-linear-gradient';
import { GameDef, SENSE_WORD, pingWord } from '../utils/games';
import { C } from './theme';
import { sheet } from '../i18n';

const WORD = { great: 'ممتاز', ok: 'مقبول', bad: 'عالي' } as const;
const DOT = { great: '#4ade80', ok: '#fde047', bad: '#fca5a5' } as const;

export function GameBadge({ game, pingMs, regionName, onChange, onNat, disabled }: {
  game?: GameDef;
  /** آخر بنق لسيرفر المنطقة المختارة (من «أي سيرفر أقرب؟») */
  pingMs?: number;
  regionName?: string;
  onChange: () => void;
  onNat?: () => void;
  disabled?: boolean;
}) {
  if (!game) {
    return (
      <Pressable onPress={onChange} disabled={disabled} style={({ pressed }) => [s.wrap, pressed && s.pressed]}>
        <LinearGradient colors={['#7c3aed', '#2f6bff']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.card}>
          <View style={s.row}>
            <View style={s.emojiBox}><Text style={s.emoji}>🎮</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>وش تلعب؟</Text>
              <Text style={s.kind}>اختار لعبتك ونرتّب لك السيرفرات والنصايح</Text>
            </View>
            <View style={s.change}><Text style={s.changeTxt}>اختار</Text></View>
          </View>
        </LinearGradient>
      </Pressable>
    );
  }
  const w = typeof pingMs === 'number' ? pingWord(game, pingMs) : null;
  return (
    <View style={[s.wrap, { shadowColor: game.colors[1] }]}>
      <LinearGradient colors={game.colors} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={s.card}>
        <View style={s.row}>
          <View style={s.emojiBox}><Text style={s.emoji}>{game.emoji}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>لعبتك</Text>
            <Text style={s.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{game.name}</Text>
          </View>
          <Pressable onPress={onChange} disabled={disabled} hitSlop={8} style={({ pressed }) => [s.change, pressed && s.pressed]}>
            <Text style={s.changeTxt}>غيّر</Text>
          </Pressable>
        </View>

        <View style={s.chips}>
          <View style={s.chip}><Text style={s.chipTxt}>{SENSE_WORD[game.sense]}</Text></View>
          <View style={s.chip}><Text style={s.chipTxt}>هدفك أقل من {game.goodMs}ms</Text></View>
          {w && (
            <View style={s.chip}>
              <View style={[s.dot, { backgroundColor: DOT[w] }]} />
              <Text style={s.chipTxt}>{pingMs}ms · {WORD[w]}</Text>
            </View>
          )}
        </View>

        <View style={s.tip}>
          <Text style={s.tipTxt}>💡 {game.tip}</Text>
          {!!regionName && game.regions.length > 0 && <Text style={s.tipSub}>السيرفر المختار: {regionName}</Text>}
        </View>

        {game.console && onNat && (
          <Pressable onPress={onNat} disabled={disabled} style={({ pressed }) => [s.nat, pressed && s.pressed]}>
            <Text style={s.natTxt}>🔓 افحص NAT وافتحه</Text>
            <Text style={s.natArrow}>‹</Text>
          </Pressable>
        )}
      </LinearGradient>
    </View>
  );
}

const s = sheet({
  wrap: { borderRadius: 24, shadowColor: '#5b21b6', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  card: { borderRadius: 24, padding: 14, gap: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  emojiBox: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  emoji: { fontSize: 28 },
  label: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 11.5, textAlign: 'right' },
  name: { color: '#fff', fontWeight: '900', fontSize: 19, textAlign: 'right' },
  kind: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 12, textAlign: 'right', marginTop: 2 },
  change: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  changeTxt: { color: C.violetBright, fontWeight: '900', fontSize: 13 },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipTxt: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tip: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 14, padding: 10, gap: 3 },
  tipTxt: { color: '#fff', fontWeight: '700', fontSize: 12.5, textAlign: 'right', lineHeight: 19 },
  tipSub: { color: 'rgba(255,255,255,0.78)', fontWeight: '700', fontSize: 11, textAlign: 'right' },
  nat: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  natTxt: { color: '#0e7490', fontWeight: '900', fontSize: 14 },
  natArrow: { color: '#0e7490', fontWeight: '900', fontSize: 20 },
});
