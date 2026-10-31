@AGENTS.md

# Bandly — دليل العمل لأي جلسة Claude

## المستخدم
- حسن، يكلّمك باللهجة السعودية — رد عليه بالعربي وبنفس اللهجة، مختصر وواضح.
- يشتغل **من الجوال عبر SSH** وما يفتح محررات ملفات أبداً. أي شي ينفّذه على السيرفر لازم يكون **أمر واحد جاهز للنسخ واللصق**، ما تقول له «عدّل الملف الفلاني».
- قبل أي تغيير كبير أو شي يحذف، وضّح وش بيصير.

## التطبيق
Bandly: تطبيق Expo (SDK 57، expo-router، TypeScript strict) يدير راوترات 4G/5G (هواوي و ZTE): توجيه الأنتنا، الأبراج وتثبيت الخلية، الترددات، مُحسّن الألعاب، كاشف اللاق، وضع الفني، المراقبة بالخلفية.
- الدرايفرات: `src/drivers/{huawei,zte,...}` — الواجهة الموحدة في `src/drivers/types.ts`.
- الدرايفرات المسجّلة في `src/drivers/registry.ts`: هواوي، ZTE (goform)، ZTE الجيل الجديد (ubus)، زيكسل (NR5103E و FWA505 مؤكدين ٣١ أكتوبر؛ من ملفات FULL انضاف في `zyxel/extra.ts`: اسم وكلمة الواي فاي وتشغيل كل نطاق (oid=wlan)، الرسائل (cellwan_sms)، حظر الأجهزة (macfilter: ADD/EDIT/DELE)، بوصلة FWA505 (azimuth — تطلع في «توجيه الأنتنا»)؛ قناة الواي فاي (doWifiApply — كل إعدادات الشبكة تنرسل كما هي مع القناة؛ بس NR5103E و FWA505 لأن صيغتهم تختلف، وبعدها نتأكد إن الاسم والحماية ما تغيّرت)؛ ما فيه تثبيت برج في صفحته)، **FiberHome** (`src/drivers/fiberhome/`، من ٢٦ أكتوبر — LG6121D اشتغل عند عضو؛ مركز التحكم في `fiberhome/extras.ts` من ٢٦ أكتوبر — لسا ما انجرّب ميداني)، **OPPO 5G CPE** (`src/drivers/oppo/`، T1a زين، من ٢٦ أكتوبر — تشفير AES-CTR + RSA-OAEP مع رجوع لـ PKCS#1؛ إشارة، وضع الشبكة، أجهزة وحظر، رسائل، مركز التحكم، قناة الواي فاي. **ما فيه تثبيت ترددات ولا برج في صفحته** — setBand يوقف بـ noChange، وشاشة الترددات تعرض وضع الشبكة بس. لسا ما انجرّب ميداني)، **Green Packet 5G CPE** (`src/drivers/greenpacket/`، E5-250MK زين، ٢٦ أكتوبر — REST عادي `/web/v1` + رأس authorization؛ إشارة ودمج، **تثبيت ترددات 4G/5G** (LookBand)، **تثبيت برج** (Cell Selection ← Preferred Listing)، وضع الشبكة، لقطة وإرجاع، أجهزة وحظر، رسائل، مركز التحكم، قناة الواي فاي. لسا ما انجرّب ميداني)، **ZTE جيب 4G القديم «UFI»** (`src/drivers/zteufi/`، ٢٦ أكتوبر — بدون wa_inner_version فدرايفر ZTE ما يتعرّف عليه؛ درايفر لحاله ما يلمس MU5001: دخول username+password base64، إشارة nv_rsrp/lte_sinr/nv_pci، تثبيت ترددات SET_BAND_LOCK (فك = كل المتاح مفعّل)، آي بي جديد، أجهزة وحظر. لسا ما انجرّب ميداني)، **Nokia FastMile 5G Gateway 3.1** (`src/drivers/nokia/`، ٣١ أكتوبر — من ملفات صفحة ٣ أعضاء: دخول nonce + sha256 (crypto_page.js)، كوكي + csrf_token؛ إشارة 4G/5G والدمج، معلومات الجهاز، الأجهزة، الاستهلاك، إعادة التشغيل. **ما فيه تثبيت ترددات ولا برج ولا وضع شبكة في صفحته**. لسا ما انجرّب ميداني)، **Nokia FastMile 6.1** (`src/drivers/nokia/fwa.ts`، درايفر لحاله، ٣١ أكتوبر — صفحة Angular جديدة: دخول nonce ← salt (alati) ← sha256 مكرر؛ «ubus» JSON على service_function_web_app.cgi؛ POST_CSRF مشفّر بـ pubkey. إشارة (status_get) والدمج (GetCAState)، **تثبيت ترددات 4G/5G** (SetSupportedCellularBands — بس String_based)، **وضع الشبكة** (SetCellularAccessConfig)، إعادة التشغيل. تثبيت الأبراج (cell_management) موجود بصفحته وما انضاف. لسا ما انجرّب ميداني).
- **ZTE U30 Pro**: القراءة شغالة، والكتابة موقوفة عمداً (`writeUnverified` في `models.ts`) لين يوصل `service.js` من «مو مدعوم؟». لا ترسل أوامر تخمينية لراوتر عضو.
- «مو مدعوم؟» (`app/newdevice.tsx` + `src/services/routerDump.ts`): يجمع ملفات صفحة الراوتر ويرسلها zip للبوت؛ لو فشل الإرسال يوصل تقرير `newdevice-dump`. الحزم على السيرفر في `/root/bandly-live/data/dumps/`.
- الاختبارات: `node tests/run.cjs` (لازم كلها تنجح قبل الدمج).
- الشاشات: `app/<name>/[id].tsx` — وعناوينها في مصفوفة `SCREENS` داخل `app/_layout.tsx` (أي شاشة جديدة تنضاف هناك).
- البنق: `src/utils/latency.ts` — يقيس لدولة سيرفر اللعبة المختارة (المفتاح `bandly.gameRegion`). **منطقة AWS البحرين (me-south-1) متوقفة** — لا ترجعها.
- المجتمع والإحصائيات: `src/services/community.ts` + السيرفر `live-server/community.py`.
- المراقبة بالخلفية: `src/tasks/monitor.ts` (ومعها الوضع الذكي والصيانة الليلية في `src/tasks/automation.ts`).

## طريقة الشغل (مهم)
1. انسخ المستودع وعدّل فيه مباشرة، وتأكد قبل الرفع:
   - `npx tsc --noEmit -p .` (يحتاج مهلة طويلة ~5 دقائق)
   - `npx expo export --platform android --output-dir /tmp/exp` للتأكد إن الحزمة تتجمع
2. اعمل commit وارفع على `main` مباشرة:
   `git -c user.name=Hasano0o -c user.email=sham3a.com3@gmail.com commit ...` ثم `git push origin HEAD:main`
3. بعدها أعطِ المستخدم **أمر التحديث المناسب** (تحت).

## إيصال التعديل للجوالات
### تعديل JS/TS فقط (واجهة، منطق، نصوص) ← تحديث عن بُعد، بدون بناء
المستخدم يشغّل على السيرفر:
```
/root/bandly-update.sh "وصف التعديل"
```
السكربت يسحب من GitHub ويرسل التحديث على قناة `preview`. بعدها يقفل التطبيق ويفتحه مرتين.

### تعديل أصلي (مكتبة native جديدة، صلاحيات، أيقونة، app.json plugins) ← بناء APK جديد (~20 دقيقة)
```
cd /root/router-manager/mobile && git checkout -- package-lock.json 2>/dev/null; git pull --ff-only origin main && git --no-pager log --oneline -1 && touch /tmp/bandly-start && (nohup bash -c '/root/build-bandly.sh > /root/bandly-build.log 2>&1; [ /root/bandly.apk -nt /tmp/bandly-start ] && cp -f /root/bandly.apk /var/www/has-host.com/dl/bandly.apk' >/dev/null 2>&1 &) ; sleep 3; pgrep -f build-bandly.sh >/dev/null && echo "✓ البناء شغال" || echo "✗ ما اشتغل"
```
التأكد من انتهاء البناء:
```
grep -aE "BUILD (SUCCESSFUL|FAILED)" /root/bandly-build.log | tail -1; ls -l --time-style=+"%d/%m %H:%M" /var/www/has-host.com/dl/bandly.apk
```
رابط التحميل الثابت: https://has-host.com/dl/bandly.apk

### ⚠️ تنبيهات
- `runtimeVersion` = `appVersion` (حالياً 1.0.0). **تغيير `version` في app.json يقطع التحديثات عن كل الأجهزة المثبتة** لين يثبتون APK جديد.
- أي مكتبة جديدة لازم تنضاف بـ `npm install` عشان يتحدث `package-lock.json` — البناء يستخدم `npm ci` ويفشل لو اختلفوا.
- البناء محصور على `arm64-v8a` و `armeabi-v7a` (في expo-build-properties) — لا ترجع x86.

## السيرفر (Contabo VPS)
- مشروع البناء: `/root/router-manager/mobile`
- خدمة وضع الفني والمجتمع: `/root/bandly-live` (systemd: `bandly-live`)، تحديثها:
  ```
  cd /root/router-manager/mobile && git pull -q --ff-only origin main && cp live-server/app.py live-server/community.py live-server/stats.py /root/bandly-live/ && systemctl restart bandly-live
  ```
- بوت التطبيق: `@NetGuide1_bot` — ملفاته في `/root/netguide/`.

## نسخة الويندوز (desktop/)
- برنامج Electron يلف نسخة الويب من نفس الكود (`BANDLY_DESKTOP=1` في app.config.js ← web output = single).
- `src/desktop/install.ts`: في الويندوز يوجّه fetch عبر البرنامج (بدون CORS، مع كوكيز وReferer)، ويحوّل Alert لنافذة ويندوز وShare للحافظة. في الجوال ما يسوي شي.
- كلمات المرور: `src/desktop/secret.ts` (SecureStore بالجوال، safeStorage بالويندوز).
- البناء على السيرفر (يحتاج wine — السكربت يثبته أول مرة):
  ```
  cd /root/router-manager/mobile && git pull --ff-only origin main && nohup bash desktop/build-windows.sh > /root/bandly-win.log 2>&1 &
  ```
  الناتج: https://has-host.com/dl/Bandly-Setup.exe
- **التحديث:** كل بناء ياخذ رقم نسخة جديد (`1.2.<تاريخ>`) وينشر `dl/bandly-desktop.json` (نسخة + sha256 + ملاحظات = عنوان آخر commit).
  البرنامج المثبت يشيك بعد ما يفتح وكل 6 ساعات، ويعرض «حدّث الحين» ← يحمّل المثبّت ويتحقق منه ويثبّته. (نسخة 1.0/1.1 ما فيها التحديث — تحتاج تثبيت يدوي مرة وحدة.)
  تغيير `version` في `desktop/package.json` (مثل 1.2 ← 1.3) فقط لما تبي ترقّم إصدار كبير.
- **وضع الفني في الويندوز:** يفتح صفحة الفني من السيرفر (`live-server/viewer.html` على has-host.com/live) في نافذة مستقلة — فيها المكالمة والكاميرا والرسائل. أي تحسين لوضع الفني على الويب يوصل للويندوز تلقائياً بدون بناء.
- الشبكة: `src/ui/DesktopNet.tsx` (بطاقة الشبكة + إصلاح الاتصال) و`net:diag`/`net:repair` في desktop/main.js.
