#!/usr/bin/env bash
# تثبيت/تحديث Bandly Live (وضع الفني) على السيرفر — آمن للتكرار.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DST=/root/bandly-live
DOMAIN=has-host.com
UNIT=bandly-live
ok(){ echo "  ✓ $*"; }
die(){ echo "  ✗ $*"; exit 1; }

echo "📦 نسخ الملفات..."
mkdir -p "$DST/data"
cp "$SRC/app.py" "$SRC/viewer.html" "$SRC/admin.py" "$SRC/requirements.txt" "$DST/"
ok "$DST"

echo "🎙  ffmpeg (للرسائل الصوتية)..."
if ! command -v ffmpeg >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg >/dev/null 2>&1 || true
fi
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg موجود" || echo "  ⚠ ffmpeg غير مثبت — الصوت يشتغل بدون تحويل"

echo "🐍 البيئة..."
[ -x "$DST/venv/bin/python" ] || python3 -m venv "$DST/venv"
"$DST/venv/bin/pip" install -q --upgrade pip >/dev/null
"$DST/venv/bin/pip" install -q -r "$DST/requirements.txt"
"$DST/venv/bin/python" -c "import fastapi, uvicorn, websockets" && ok "fastapi + uvicorn + websockets"

echo "🔌 المنفذ..."
PORT=""
if [ -f "/etc/systemd/system/$UNIT.service" ]; then
  PORT=$(grep -oP -- '--port \K[0-9]+' "/etc/systemd/system/$UNIT.service" || true)
fi
if [ -z "$PORT" ]; then
  for p in $(seq 8098 8130); do
    if ! ss -ltn | awk '{print $4}' | grep -qE "[:.]$p\$"; then PORT=$p; break; fi
  done
fi
[ -n "$PORT" ] || die "ما لقينا منفذ فاضي"
ok "$PORT"

echo "⚙️  خدمة systemd..."
cat > "/etc/systemd/system/$UNIT.service" <<EOF
[Unit]
Description=Bandly Live (technician mode relay)
After=network.target

[Service]
WorkingDirectory=$DST
Environment=BANDLY_PUBLIC_URL=https://$DOMAIN
ExecStart=$DST/venv/bin/uvicorn app:app --host 127.0.0.1 --port $PORT --proxy-headers --ws-ping-interval 20 --ws-ping-timeout 20
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q "$UNIT"
systemctl restart "$UNIT"
sleep 3
systemctl is-active -q "$UNIT" || { journalctl -u "$UNIT" -n 20 --no-pager; die "الخدمة ما اشتغلت"; }
curl -fsS "http://127.0.0.1:$PORT/live-api/health" >/dev/null && ok "الخدمة شغالة محلياً"

echo "🌐 nginx..."
SNIP=/etc/nginx/snippets/bandly-live.conf
mkdir -p /etc/nginx/snippets
cat > "$SNIP" <<EOF
# Bandly Live — وضع الفني
location /live-api/ {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 2m;
}
location /live/ {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
}
location = /live { return 301 /live/; }
EOF
ok "$SNIP"

CONF=$(grep -lE "server_name[^;]*[[:space:]]$DOMAIN([[:space:]]|;)" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1 || true)
[ -n "$CONF" ] || die "ما لقينا ملف nginx فيه server_name $DOMAIN"
CONF=$(readlink -f "$CONF")
ok "ملف الموقع: $CONF"

if grep -q "snippets/bandly-live.conf" "$CONF"; then
  ok "الـ include موجود من قبل"
  nginx -t 2>/dev/null && systemctl reload nginx && ok "أعدنا تحميل nginx"
else
  # النسخة الاحتياطية برّا sites-enabled — وإلا nginx يحمّلها كإعداد ثاني
  mkdir -p "$DST/nginx-backup"
  BK="$DST/nginx-backup/$(basename "$CONF").bak-$(date +%s)"
  cp "$CONF" "$BK"
  python3 - "$CONF" "$DOMAIN" <<'PYEOF'
import re, sys
path, domain = sys.argv[1], sys.argv[2]
src = open(path, encoding="utf-8").read()
# نقسم الملف لبلوكات server ونختار اللي فيه الدومين و 443
blocks = []
idx = 0
while True:
    m = re.search(r"(^|\n)\s*server\s*\{", src[idx:])
    if not m:
        break
    start = idx + m.start()
    brace = src.index("{", start)
    depth, j = 0, brace
    while j < len(src):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0: break
        j += 1
    blocks.append((start, j))
    idx = j + 1
target = None
for (s, e) in blocks:
    b = src[s:e]
    names = re.search(r"server_name\s+([^;]+);", b)
    if not names or domain not in names.group(1).split():
        continue
    if re.search(r"listen\s+[^;]*443", b):
        target = (s, e); break
if target is None:
    for (s, e) in blocks:
        names = re.search(r"server_name\s+([^;]+);", src[s:e])
        if names and domain in names.group(1).split():
            target = (s, e); break
if target is None:
    print("NO_BLOCK"); sys.exit(2)
s, e = target
b = src[s:e]
m = re.search(r"server_name\s+[^;]+;[^\n]*\n", b)
ins = s + m.end()
src = src[:ins] + "    include /etc/nginx/snippets/bandly-live.conf;\n" + src[ins:]
open(path, "w", encoding="utf-8").write(src)
print("INSERTED")
PYEOF
  if nginx -t 2>/tmp/bandly-nginx.log; then
    systemctl reload nginx
    ok "أضفنا الـ include وتم إعادة تحميل nginx (نسخة احتياطية: $BK)"
  else
    cp "$BK" "$CONF"
    cat /tmp/bandly-nginx.log
    die "nginx رفض الإعداد — رجعنا الملف الأصلي"
  fi
fi

echo "🔎 فحص من الإنترنت..."
sleep 1
if curl -fsS "https://$DOMAIN/live-api/health"; then
  echo
  ok "https://$DOMAIN/live/ شغال"
else
  echo "  ⚠ الخدمة شغالة بس الرابط العام ما رد — أرسل النتيجة"
fi
echo
echo "════════════════════════════════════════"
echo "✅ Bandly Live جاهز"
echo "   صفحة الفني:  https://$DOMAIN/live/"
echo "   إدارة الفنيين: python3 $DST/admin.py"
echo "════════════════════════════════════════"
