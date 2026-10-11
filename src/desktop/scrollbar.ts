/**
 * نسخة الويندوز (والويب): شريط تمرير ظاهر على طرف الشاشة تقدر تسحبه بالماوس.
 * React Native Web يخفي الشريط في أي ScrollView فيه showsVerticalScrollIndicator={false}،
 * فنرجّعه بـ CSS عام. في الجوال ما يسوي شي.
 */
import { Platform } from 'react-native';

const CSS = `
* { scrollbar-width: auto !important; scrollbar-color: rgba(47,107,255,.55) transparent !important; }
::-webkit-scrollbar { display: block !important; width: 14px !important; height: 10px !important; }
::-webkit-scrollbar-track { background: transparent !important; }
::-webkit-scrollbar-thumb {
  background-color: rgba(47,107,255,.40) !important; border-radius: 10px !important;
  border: 3px solid transparent !important; background-clip: content-box !important; min-height: 48px;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(47,107,255,.70) !important; }
::-webkit-scrollbar-thumb:active { background-color: rgba(47,107,255,.90) !important; }
::-webkit-scrollbar-corner { background: transparent !important; }
`;

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('bandly-scrollbar')) {
  const el = document.createElement('style');
  el.id = 'bandly-scrollbar';
  el.textContent = CSS;
  document.head.appendChild(el);
}
