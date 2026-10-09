#!/usr/bin/env python3
"""
يراقب تقييمات Bandly في App Store ويرسل للمالك على البوت أي تقييم جديد.
- المراجعات المكتوبة: من RSS أبل العام (بدون مفاتيح).
- التقييم بالنجوم بدون كتابة: من lookup (يتغير العدد والمتوسط).
يشتغل من cron كل ٣٠ دقيقة. أول تشغيل يحفظ الموجود بدون ما يرسله.
"""
import json
import os
import sys
import urllib.request
import urllib.parse

APP_ID = "6819877993"
COUNTRIES = ["sa", "ae", "kw", "qa", "bh", "om", "eg", "jo", "us", "gb"]
LIVE = "/root/bandly-live"
STATE = os.path.join(LIVE, "data", "reviews_state.json")
STORE_URL = f"https://apps.apple.com/sa/app/id{APP_ID}"
FLAG = {"sa": "🇸🇦", "ae": "🇦🇪", "kw": "🇰🇼", "qa": "🇶🇦", "bh": "🇧🇭", "om": "🇴🇲",
        "eg": "🇪🇬", "jo": "🇯🇴", "us": "🇺🇸", "gb": "🇬🇧"}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 BandlyReviews"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", "ignore") or "{}")


def send(text):
    tok = open(os.path.join(LIVE, "data", "bot_token")).read().strip()
    owner = json.load(open(os.path.join(LIVE, "data", "config.json"))).get("owner_id")
    if not owner:
        sys.exit("ما لقيت owner_id")
    data = urllib.parse.urlencode({"chat_id": owner, "text": text, "parse_mode": "HTML",
                                   "disable_web_page_preview": "true"}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data=data, timeout=20)


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def reviews(cc):
    url = f"https://itunes.apple.com/{cc}/rss/customerreviews/page=1/id={APP_ID}/sortby=mostrecent/json"
    try:
        entries = get_json(url).get("feed", {}).get("entry", [])
    except Exception:
        return []
    if isinstance(entries, dict):
        entries = [entries]
    out = []
    for e in entries:
        if "im:rating" not in e:      # أول عنصر أحياناً معلومات التطبيق نفسه
            continue
        out.append({
            "id": e.get("id", {}).get("label", ""),
            "stars": int(e["im:rating"]["label"]),
            "title": e.get("title", {}).get("label", ""),
            "body": e.get("content", {}).get("label", ""),
            "author": e.get("author", {}).get("name", {}).get("label", ""),
            "ver": e.get("im:version", {}).get("label", ""),
        })
    return out


def rating(cc):
    try:
        res = get_json(f"https://itunes.apple.com/lookup?id={APP_ID}&country={cc}").get("results", [])
    except Exception:
        return None
    if not res:
        return None
    r = res[0]
    return {"count": int(r.get("userRatingCountForCurrentVersion") or r.get("userRatingCount") or 0),
            "avg": float(r.get("averageUserRatingForCurrentVersion") or r.get("averageUserRating") or 0)}


def main():
    first = not os.path.exists(STATE)
    st = {"seen": [], "ratings": {}}
    if not first:
        try:
            st = json.load(open(STATE))
        except Exception:
            pass
    seen = set(st.get("seen", []))
    msgs = []

    for cc in COUNTRIES:
        for r in reviews(cc):
            if not r["id"] or r["id"] in seen:
                continue
            seen.add(r["id"])
            if first:
                continue
            msgs.append(
                f"📝 <b>مراجعة جديدة على App Store</b> {FLAG.get(cc, cc)}\n"
                f"{'⭐' * r['stars']}{'☆' * (5 - r['stars'])}\n"
                f"<b>{esc(r['title'])}</b>\n{esc(r['body'])[:1500]}\n\n"
                f"👤 {esc(r['author'])} · نسخة {esc(r['ver'])}"
            )

        cur = rating(cc)
        if cur is None:
            continue
        old = st.get("ratings", {}).get(cc)
        st.setdefault("ratings", {})[cc] = cur
        if first or not old or cur["count"] <= old.get("count", 0):
            continue
        n = cur["count"] - old.get("count", 0)
        msgs.append(
            f"⭐ <b>{'تقييم جديد' if n == 1 else f'{n} تقييمات جديدة'}</b> {FLAG.get(cc, cc)}\n"
            f"المتوسط الحين: <b>{cur['avg']:.1f}</b> من 5 · عدد التقييمات: {cur['count']}"
        )

    st["seen"] = list(seen)[-2000:]
    tmp = STATE + ".tmp"
    json.dump(st, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, STATE)

    if first:
        total = sum(v.get("count", 0) for v in st.get("ratings", {}).values())
        send(f"✅ مراقبة تقييمات App Store اشتغلت\nالتقييمات الحالية: {total} · مراجعات مكتوبة: {len(seen)}\n"
             f"بيوصلك أي تقييم جديد هنا 👌\n{STORE_URL}")
        return
    for m in msgs:
        send(m + f"\n\n{STORE_URL}")


if __name__ == "__main__":
    main()
