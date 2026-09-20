import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { C } from './theme';

export type IconName =
  | 'home' | 'tower' | 'bands' | 'aim' | 'game' | 'folder' | 'report'
  | 'settings' | 'chevron' | 'down' | 'up' | 'phone' | 'tv' | 'refresh'
  | 'spark' | 'bulb' | 'lock' | 'sms' | 'speed' | 'chart' | 'user' | 'power'
  | 'eye' | 'eye-off'
  | 'antenna' | 'layers' | 'pin' | 'clock';

export function Icon({
  name, size = 20, color = C.sub, stroke = 1.9,
}: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const p = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && <><Path d="M3 10.5 12 3l9 7.5" {...p} /><Path d="M5 9.5V21h14V9.5" {...p} /></>}
      {name === 'tower' && <><Path d="M12 20v-6" {...p} /><Path d="M6.3 17.7a8 8 0 0 1 0-11.4" {...p} /><Path d="M17.7 6.3a8 8 0 0 1 0 11.4" {...p} /><Path d="M3.5 20.5a12 12 0 0 1 0-17" {...p} /><Path d="M20.5 3.5a12 12 0 0 1 0 17" {...p} /></>}
      {name === 'bands' && <><Path d="M4 18v-5" {...p} /><Path d="M10 18V8" {...p} /><Path d="M16 18v-8" {...p} /><Path d="M22 18V5" {...p} /></>}
      {name === 'aim' && <><Circle cx={12} cy={12} r={9} {...p} /><Circle cx={12} cy={12} r={4} {...p} /><Circle cx={12} cy={12} r={1} {...p} /></>}
      {name === 'game' && <><Path d="M6 11h4" {...p} /><Path d="M8 9v4" {...p} /><Circle cx={16} cy={11} r={1} {...p} /><Circle cx={18.5} cy={13.5} r={1} {...p} /><Rect x={2} y={6} width={20} height={12} rx={4} {...p} /></>}
      {name === 'folder' && <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} />}
      {name === 'report' && <><Path d="M14 3v5h5" {...p} /><Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" {...p} /><Path d="M9 13h6" {...p} /><Path d="M9 17h4" {...p} /></>}
      {name === 'settings' && <><Circle cx={12} cy={12} r={3} {...p} /><Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9" {...p} /></>}
      {name === 'chevron' && <Path d="M9 6l6 6-6 6" {...p} />}
      {name === 'down' && <><Path d="M12 5v14" {...p} /><Path d="M19 12l-7 7-7-7" {...p} /></>}
      {name === 'up' && <><Path d="M12 19V5" {...p} /><Path d="M5 12l7-7 7 7" {...p} /></>}
      {name === 'phone' && <><Rect x={6} y={2} width={12} height={20} rx={3} {...p} /><Path d="M11 18h2" {...p} /></>}
      {name === 'tv' && <><Rect x={2} y={4} width={20} height={13} rx={2} {...p} /><Path d="M8 21h8" {...p} /><Path d="M12 17v4" {...p} /></>}
      {name === 'refresh' && <><Path d="M21 12a9 9 0 1 1-2.6-6.4" {...p} /><Path d="M21 3v6h-6" {...p} /></>}
      {name === 'spark' && <><Path d="M12 17v4" {...p} /><Path d="M9 21h6" {...p} /><Path d="M12 3 9.2 8.6 3 9.5l4.5 4.4L6.4 20 12 17.1 17.6 20l-1.1-6.1L21 9.5l-6.2-.9z" {...p} /></>}
      {name === 'bulb' && <><Path d="M9 18h6" {...p} /><Path d="M10 21h4" {...p} /><Path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8.9.9 1.5h5.4c.1-.6.4-1.1.9-1.5A6 6 0 0 0 12 3z" {...p} /></>}
      {name === 'lock' && <><Rect x={4} y={10} width={16} height={11} rx={3} {...p} /><Path d="M8 10V7a4 4 0 0 1 8 0v3" {...p} /></>}
      {name === 'eye' && <><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>}
      {name === 'eye-off' && <><Path d="M2 12s3.5-7 10-7c2.2 0 4.1.7 5.7 1.7M22 12s-3.5 7-10 7c-2.2 0-4.1-.7-5.7-1.7" {...p} /><Path d="M4 4l16 16" {...p} /></>}
      {name === 'sms' && <><Path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" {...p} /></>}
      {name === 'speed' && <><Path d="M12 14l4-4" {...p} /><Path d="M4 18a9 9 0 1 1 16 0" {...p} /></>}
      {name === 'chart' && <><Path d="M4 19V5" {...p} /><Path d="M4 19h16" {...p} /><Path d="M8 15l4-5 3 3 4-6" {...p} /></>}
      {name === 'user' && <><Circle cx={12} cy={8} r={3.5} {...p} /><Path d="M5 20a7 7 0 0 1 14 0" {...p} /></>}
      {name === 'power' && <><Path d="M12 4v8" {...p} /><Path d="M6.5 7.5a8 8 0 1 0 11 0" {...p} /></>}
      {name === 'antenna' && <><Path d="M12 21V11" {...p} /><Path d="M8 21h8" {...p} /><Circle cx={12} cy={8.5} r={2} {...p} /><Path d="M7.8 12.7a6 6 0 0 1 0-8.4" {...p} /><Path d="M16.2 4.3a6 6 0 0 1 0 8.4" {...p} /></>}
      {name === 'layers' && <><Path d="M12 3 2 8l10 5 10-5z" {...p} /><Path d="M2 13l10 5 10-5" {...p} /></>}
      {name === 'pin' && <><Path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" {...p} /><Circle cx={12} cy={10} r={2.5} {...p} /></>}
      {name === 'clock' && <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M12 7v5l3 2" {...p} /></>}
    </Svg>
  );
}
