#!/bin/bash
# تركيب سيرفر مسرّع Bandly (المرحلة ١) على سيرفر Ubuntu جديد.
#   bash /root/accel/install.sh [الدومين]
# بدون دومين نستخدم <IP>.sslip.io (يشتغل بدون أي إعداد DNS).
set -e
cd /root/accel
IP=$(curl -4 -s --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN="${1:-${IP//./-}.sslip.io}"
echo "IP: $IP  ·  الدومين: $DOMAIN"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq caddy python3 ufw >/dev/null
timedatectl set-timezone Asia/Riyadh || true

cat > /etc/systemd/system/bandly-accel.service << UNIT
[Unit]
Description=Bandly accelerator probe
After=network-online.target
[Service]
ExecStart=/usr/bin/python3 /root/accel/probe.py
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile << CADDY
$DOMAIN {
	reverse_proxy 127.0.0.1:8099
}
CADDY

# الجدار: SSH (المنفذ الحالي) + 80/443 بس (51820 UDP للمرحلة ٢ — WireGuard)
SSHP=$(ss -tlnp | awk '/sshd/ {split($4,a,":"); print a[length(a)]; exit}')
ufw allow 22/tcp >/dev/null; ufw allow "${SSHP:-22}"/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now bandly-accel >/dev/null 2>&1
systemctl restart bandly-accel caddy
sleep 8
echo "$DOMAIN" > /root/accel/domain.txt
if curl -s --max-time 15 "https://$DOMAIN/ping" | grep -q ok; then
  echo "✓ السيرفر شغال: https://$DOMAIN"
else
  echo "✗ HTTPS ما اشتغل للحين — الشهادة ممكن تاخذ دقيقة. جرّب: curl https://$DOMAIN/ping"
  journalctl -u caddy -n 5 --no-pager
fi
