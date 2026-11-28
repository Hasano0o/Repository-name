#!/bin/bash
# موصّل Claude للرسيفر — قراءة بس لملفات Bandly (bandly_mcp.py).
#   التركيب/التحديث:  bash /root/router-manager/mobile/live-server/mcp/install.sh
#   تغيير الرمز:       bash …/install.sh --rotate     (الرابط القديم يوقف — حدّثه في claude.ai)
#   الحالة:            bash …/install.sh --status
#   الإزالة:           bash …/install.sh --uninstall  (يوقف الخدمة ويشيل مسار nginx)
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR=/root/bandly-mcp
TOK="$DIR/token"
UNIT=/etc/systemd/system/bandly-mcp.service
SNIP=/etc/nginx/snippets/claude-mcp.conf
INC='    include snippets/claude-mcp.conf;'
PORT=8094

site_conf() {
  local f
  for f in /etc/nginx/sites-enabled/*; do
    f=$(readlink -f "$f")
    grep -qE 'server_name[^;]*[[:space:]]has-host\.com' "$f" 2>/dev/null && grep -q 'listen 443' "$f" && { echo "$f"; return; }
  done
}

url() { echo "https://has-host.com/claude-mcp/$(cat "$TOK")"; }

case "$1" in
  --status)
    systemctl is-active bandly-mcp && echo "✓ الخدمة شغالة" || echo "✗ الخدمة طافية"
    [ -f "$SNIP" ] && grep -q 'claude-mcp.conf' "$(site_conf)" && echo "✓ مسار nginx موجود" || echo "✗ مسار nginx ناقص"
    [ -f "$TOK" ] && echo "الرابط: $(url)"
    journalctl -u bandly-mcp -n 8 --no-pager -o cat 2>/dev/null | grep '\[mcp\]' || true
    exit 0 ;;
  --rotate)
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOK"; chmod 600 "$TOK"
    systemctl restart bandly-mcp
    echo "✓ رمز جديد — حدّث الرابط في claude.ai (الإعدادات ← Connectors):"; url; exit 0 ;;
  --uninstall)
    C=$(site_conf)
    if [ -n "$C" ] && grep -q 'claude-mcp.conf' "$C"; then
      cp -a "$C" "/root/nginx-bak-mcp-$(date +%m%d-%H%M).conf"
      sed -i '/include snippets\/claude-mcp.conf;/d' "$C"
      nginx -t && systemctl reload nginx
    fi
    systemctl disable --now bandly-mcp 2>/dev/null || true
    rm -f "$UNIT" "$SNIP"; systemctl daemon-reload
    echo "✓ انشال الموصّل (الرمز باقي في $TOK — احذفه لو تبي)"; exit 0 ;;
esac

# ── ١) الملفات والرمز ──
mkdir -p "$DIR"
cp -f "$SRC/bandly_mcp.py" "$DIR/bandly_mcp.py"
[ -s "$TOK" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOK"; }
chmod 600 "$TOK"
python3 -c "import ast,sys; ast.parse(open('$DIR/bandly_mcp.py').read())"

# ── ٢) خدمة systemd (ما تقدر تكتب ولا شي: /root قراءة بس) ──
cat > "$UNIT" <<EOF
[Unit]
Description=Bandly receiver MCP for Claude (read-only)
After=network.target

[Service]
ExecStart=/usr/bin/python3 $DIR/bandly_mcp.py
Restart=on-failure
RestartSec=5
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
NoNewPrivileges=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable bandly-mcp >/dev/null 2>&1
systemctl restart bandly-mcp
sleep 2
T=$(cat "$TOK")
R=$(curl -s -m 5 -X POST "http://127.0.0.1:$PORT/$T" -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' || true)
echo "$R" | grep -q search_files && echo "✓ الخدمة ترد محلياً" || { echo "✗ الخدمة ما ردت:"; journalctl -u bandly-mcp -n 15 --no-pager -o cat; exit 1; }

# ── ٣) مسار nginx: /claude-mcp/ ← 127.0.0.1:8094 ──
cat > "$SNIP" <<EOF
location ^~ /claude-mcp/ {
    proxy_pass http://127.0.0.1:$PORT/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_buffering off;
    proxy_read_timeout 120s;
    client_max_body_size 1m;
    access_log off;
}
EOF
C=$(site_conf)
[ -n "$C" ] || { echo "✗ ما لقيت ملف nginx حق has-host.com (443)"; exit 1; }
if ! grep -q 'claude-mcp.conf' "$C"; then
  B="/root/nginx-bak-mcp-$(date +%m%d-%H%M).conf"
  cp -a "$C" "$B"
  python3 - "$C" "$INC" <<'PYEOF'
import sys
p, inc = sys.argv[1], sys.argv[2]
s = open(p).read()
for a in ('location /bandly/', 'location /dapi/', 'location /quran/', 'location /delivery/'):
    if s.count(a) == 1:
        i = s.index(a)
        i = s.rindex('\n', 0, i) + 1
        s = s[:i] + inc + '\n' + s[i:]
        open(p, 'w').write(s)
        print('✓ انضاف قبل «' + a + '»')
        break
else:
    sys.exit('✗ ما لقيت مكان مناسب في ملف nginx')
PYEOF
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "✓ nginx (نسخة احتياطية: $B)"
  else
    cp -a "$B" "$C"; nginx -t; echo "✗ nginx رفض — رجّعت الملف كما كان"; exit 1
  fi
fi

# ── ٤) فحص من برا ──
sleep 1
R=$(curl -s -m 10 -X POST "https://has-host.com/claude-mcp/$T" -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"install","version":"1"}}}' || true)
echo "$R" | grep -q bandly-receiver && echo "✓ يرد من برا (https)" || echo "⚠️ ما رد من برا — شيّك: bash $0 --status"
curl -s -o /dev/null -w "بدون الرمز: %{http_code} (لازم 404)\n" -m 5 -X POST https://has-host.com/claude-mcp/x -d '{}' || true

echo
echo "════ أضف هذا الرابط في claude.ai ← الإعدادات ← Connectors ← إضافة موصّل مخصص ════"
url
echo "(الاسم: الرسيفر · لا تنشر الرابط — الرمز هو القفل)"
