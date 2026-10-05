import Svg, { Path, Circle, Rect, Polygon } from 'react-native-svg';
import { C } from './theme';

export type IconName =
  | 'home' | 'tower' | 'bands' | 'aim' | 'game' | 'folder' | 'report'
  | 'settings' | 'chevron' | 'down' | 'up' | 'phone' | 'tv' | 'refresh'
  | 'spark' | 'bulb' | 'lock' | 'sms' | 'speed' | 'chart' | 'user' | 'power'
  | 'eye' | 'eye-off'
  | 'antenna' | 'layers' | 'pin' | 'clock' | 'bell' | 'share'
  | 'trash' | 'plus' | 'compass' | 'check' | 'vibrate' | 'sound' | 'wifi' | 'login' | 'mic' | 'call' | 'hangup' | 'mic-off' | 'speaker' | 'earpiece'
  | 'video' | 'video-off' | 'flip' | 'camera' | 'star' | 'target' | 'send' | 'mail' | 'sun' | 'moon';

export function Icon({
  name, size = 20, color = C.sub, stroke = 2.0,
}: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const p = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && <><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} /><Path d="M9 22V12h6v10" {...p} /></>}
      {name === 'tower' && <><Path d="M12 20v-6" {...p} /><Path d="M6.3 17.7a8 8 0 0 1 0-11.4" {...p} /><Path d="M17.7 6.3a8 8 0 0 1 0 11.4" {...p} /><Path d="M3.5 20.5a12 12 0 0 1 0-17" {...p} /><Path d="M20.5 3.5a12 12 0 0 1 0 17" {...p} /></>}
      {name === 'bands' && <><Path d="M4 18v-5" {...p} /><Path d="M10 18V8" {...p} /><Path d="M16 18v-8" {...p} /><Path d="M22 18V5" {...p} /></>}
      {name === 'aim' && <><Circle cx={12} cy={12} r={9} {...p} /><Circle cx={12} cy={12} r={4} {...p} /><Circle cx={12} cy={12} r={1} fill={color} /></>}
      {name === 'game' && <><Path d="M6 11h4" {...p} /><Path d="M8 9v4" {...p} /><Circle cx={15} cy={11} r={1} fill={color} /><Circle cx={18} cy={13} r={1} fill={color} /><Rect x={2} y={6} width={20} height={12} rx={4} {...p} /></>}
      {name === 'folder' && <Path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" {...p} />}
      {name === 'report' && <><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" {...p} /><Path d="M14 2v6h6" {...p} /><Path d="M16 13H8" {...p} /><Path d="M16 17H8" {...p} /><Path d="M10 9H8" {...p} /></>}
      {name === 'settings' && <><Circle cx={12} cy={12} r={3} {...p} /><Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9" {...p} /></>}
      {name === 'chevron' && <Path d="M9 18l6-6-6-6" {...p} />}
      {name === 'down' && <><Path d="M12 5v14" {...p} /><Path d="M19 12l-7 7-7-7" {...p} /></>}
      {name === 'up' && <><Path d="M12 19V5" {...p} /><Path d="M5 12l7-7 7 7" {...p} /></>}
      {name === 'phone' && <><Rect x={5} y={2} width={14} height={20} rx={3} {...p} /><Path d="M12 18h.01" {...p} /></>}
      {name === 'tv' && <><Rect x={2} y={4} width={20} height={13} rx={2} {...p} /><Path d="M8 21h8" {...p} /><Path d="M12 17v4" {...p} /></>}
      {name === 'refresh' && <><Path d="M21 12a9 9 0 1 1-2.6-6.4" {...p} /><Path d="M21 3v6h-6" {...p} /></>}
      {name === 'spark' && <><Path d="M12 17v4" {...p} /><Path d="M9 21h6" {...p} /><Path d="M12 3 9.2 8.6 3 9.5l4.5 4.4L6.4 20 12 17.1 17.6 20l-1.1-6.1L21 9.5l-6.2-.9z" {...p} /></>}
      {name === 'bulb' && <><Path d="M9 18h6" {...p} /><Path d="M10 21h4" {...p} /><Path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" {...p} /></>}
      {name === 'lock' && <><Rect x={3} y={11} width={18} height={11} rx={2} {...p} /><Path d="M7 11V7a5 5 0 0 1 10 0v4" {...p} /></>}
      {name === 'eye' && <><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>}
      {name === 'eye-off' && <><Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" {...p} /><Path d="M1 1l22 22" {...p} /></>}
      {name === 'sms' && <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" {...p} />}
      {name === 'speed' && <><Path d="M12 14l4-4" {...p} /><Path d="M3.34 19a10 10 0 1 1 17.32 0" {...p} /></>}
      {name === 'chart' && <><Path d="M4 19V5" {...p} /><Path d="M4 19h16" {...p} /><Path d="M8 15l4-5 3 3 4-6" {...p} /></>}
      {name === 'user' && <><Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...p} /><Circle cx={12} cy={7} r={4} {...p} /></>}
      {name === 'power' && <><Path d="M18.36 6.64a9 9 0 1 1-12.73 0" {...p} /><Path d="M12 2v10" {...p} /></>}
      {name === 'trash' && <><Path d="M3 6h18" {...p} /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" {...p} /><Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...p} /></>}
      {name === 'antenna' && <><Path d="M12 20V10" {...p} /><Path d="M8 20h8" {...p} /><Circle cx={12} cy={7} r={2} {...p} /><Path d="M7.8 11.2a6 6 0 0 1 0-8.4" {...p} /><Path d="M16.2 2.8a6 6 0 0 1 0 8.4" {...p} /></>}
      {name === 'layers' && <><Path d="M12 2L2 7l10 5 10-5-10-5z" {...p} /><Path d="M2 17l10 5 10-5" {...p} /><Path d="M2 12l10 5 10-5" {...p} /></>}
      {name === 'pin' && <><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" {...p} /><Circle cx={12} cy={10} r={3} {...p} /></>}
      {name === 'clock' && <><Circle cx={12} cy={12} r={10} {...p} /><Path d="M12 6v6l4 2" {...p} /></>}
      {name === 'bell' && <><Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" {...p} /><Path d="M13.73 21a2 2 0 0 1-3.46 0" {...p} /></>}
      {name === 'share' && <><Circle cx={18} cy={5} r={3} {...p} /><Circle cx={6} cy={12} r={3} {...p} /><Circle cx={18} cy={19} r={3} {...p} /><Path d="M8.59 13.51l6.83 3.98" {...p} /><Path d="M15.41 6.51l-6.82 3.98" {...p} /></>}
      {name === 'plus' && <><Path d="M12 5v14" {...p} /><Path d="M5 12h14" {...p} /></>}
      {name === 'compass' && <><Circle cx={12} cy={12} r={10} {...p} /><Path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" {...p} /></>}
      {name === 'check' && <Path d="M20 6L9 17l-5-5" {...p} />}
      {name === 'vibrate' && <><Rect x={8} y={3} width={8} height={18} rx={2} {...p} /><Path d="M3 8v8" {...p} /><Path d="M21 8v8" {...p} /></>}
      {name === 'sound' && <><Path d="M11 5L6 9H2v6h4l5 4V5z" {...p} /><Path d="M15.54 8.46a5 5 0 0 1 0 7.07" {...p} /><Path d="M19.07 4.93a10 10 0 0 1 0 14.14" {...p} /></>}
      {name === 'wifi' && <><Path d="M5 12.55a11 11 0 0 1 14 0" {...p} /><Path d="M1.42 9a16 16 0 0 1 21.16 0" {...p} /><Path d="M8.53 16.11a6 6 0 0 1 6.95 0" {...p} /><Circle cx={12} cy={20} r={1} fill={color} /></>}
      {name === 'call' && <Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" {...p} />}
      {name === 'hangup' && <Path d="M3 14.5c5.3-4.7 12.7-4.7 18 0l-2.2 2.6-3.3-1.2-.5-2.6c-2-.7-4-.7-6 0l-.5 2.6-3.3 1.2z" {...p} />}
      {name === 'mic-off' && <><Path d="M1 1l22 22" {...p} /><Path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" {...p} /><Path d="M17 11a6 6 0 0 1-6 6m-3-1a6 6 0 0 1-3-5" {...p} /><Path d="M12 19v3" {...p} /></>}
      {name === 'speaker' && <><Path d="M4 10v4h4l5 4V6L8 10z" {...p} /><Path d="M16.5 9a4 4 0 0 1 0 6" {...p} /><Path d="M19 6.5a8 8 0 0 1 0 11" {...p} /></>}
      {name === 'earpiece' && <><Rect x={7} y={2} width={10} height={20} rx={3} {...p} /><Path d="M11 5h2" {...p} /></>}
      {name === 'mic' && <><Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" {...p} /><Path d="M19 10v2a7 7 0 0 1-14 0v-2" {...p} /><Path d="M12 19v3" {...p} /></>}
      {name === 'login' && <><Path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" {...p} /><Path d="M10 17l5-5-5-5" {...p} /><Path d="M15 12H3" {...p} /></>}
      {name === 'video' && <><Polygon points="23 7 16 12 23 17 23 7" {...p} /><Rect x={1} y={5} width={15} height={14} rx={2} {...p} /></>}
      {name === 'video-off' && <><Path d="M15.5 13v2a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h1M10 6h2.5a3 3 0 0 1 3 3v1.5L21 7v10" {...p} /><Path d="M3 3l18 18" {...p} /></>}
      {name === 'flip' && <><Path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" {...p} /><Path d="M20 4v4.5h-4.5" {...p} /><Path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" {...p} /><Path d="M4 20v-4.5h4.5" {...p} /></>}
      {name === 'camera' && <><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p} /><Circle cx={12} cy={13} r={4} {...p} /></>}
      {name === 'star' && <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" {...p} />}
      {name === 'sun' && <><Circle cx={12} cy={12} r={5} {...p} /><Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" {...p} /></>}
      {name === 'moon' && <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" {...p} />}
      {name === 'send' && <><Path d="M22 2L11 13" {...p} /><Path d="M22 2l-7 20-4-9-9-4 20-7z" {...p} /></>}
      {name === 'mail' && <><Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" {...p} /><Path d="M22 6l-10 7L2 6" {...p} /></>}
      {name === 'target' && <><Circle cx={12} cy={12} r={10} {...p} /><Circle cx={12} cy={12} r={6} {...p} /><Circle cx={12} cy={12} r={2} fill={color} /></>}
    </Svg>
  );
}
