# Google Play — Data Safety Form

استخدم هذا الملف لملء نموذج Data Safety في Google Play Console.

## Data Collection & Sharing

**Does your app collect or share any of the required user data types?**
➡️ **Yes** (collected only — nothing is shared with third parties)

> ⚠️ تحديث 17 أكتوبر 2026: النسخة السابقة من هذا الملف قالت «No»، لكن التطبيق يرسل إحصائية يومية مجهولة.
> لازم الإجابة تكون **Yes** وإلا Google Play ممكن يرفض التطبيق أو يوقفه.

## Data Types

| Category | Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|---|
| Location | Approximate location (المدينة اللي يختارها المستخدم بنفسه) | ✅ | ❌ | Optional | Analytics |
| App activity | App interactions (عدد مرات فتح كل شاشة) | ✅ | ❌ | Required | Analytics |
| App info & performance | Crash logs, Diagnostics (أخطاء التطبيق تنرسل تلقائياً + تقرير التشخيص اللي يرسله المستخدم بضغطة) | ✅ | ❌ | Required | App functionality, Analytics |
| Device or other IDs | Device or other IDs (معرّف عشوائي يتولد داخل التطبيق) | ✅ | ❌ | Required | Analytics |
| Personal info (Name, Email, Address, Phone) | — | ❌ | ❌ | | |
| Financial info, Health, Messages, Photos, Audio, Files, Calendar, Contacts, Web browsing | — | ❌ | ❌ | | |

- **Is data processed ephemerally?** ➡️ No
- نوع الجوال ونسخة النظام ونسخة التطبيق ونوع الراوتر تنرسل مع نفس الإحصائية (تدخل تحت Device or other IDs / App info).

## Security Practices

- **Data encrypted in transit?** ➡️ **Yes** — HTTPS for external, WPA2/3 for local
- **Data encrypted at rest?** ➡️ **Yes** — Keychain/SecureStore
- **Data deletion mechanism?** ➡️ **Yes** — "Delete Router" button in-app
- **Committed to Google Play Families Policy?** ➡️ **Yes**
- **Independent security review?** ➡️ **No**
- **Data transfer compliant with policy?** ➡️ **Yes**

## Notes to add in Google Play

> Bandly does not collect any personal data (no name, phone number, email or GPS location). Router passwords, signal history and preferences stay on the user's device. Once a day the app sends anonymous usage statistics (a random app-generated ID, the city the user chose, phone model, OS and app version, router types, and how often each screen was opened) to improve the app.

