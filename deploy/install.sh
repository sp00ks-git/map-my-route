#!/bin/bash
# Privileged installer: SSL on port 8080 for mapmyroute.ddns.net.
# Run as: sudo bash /var/www/mapy-my-route/deploy/install.sh
#
#   1. :80 vhost (ACME only — Let's Encrypt requires port 80 for issuance;
#      serves nothing else, other hostnames on 80 untouched)
#   2. Issue LE cert via webroot (as sp00ks, not root)
#   3. HTTPS vhost ON PORT 8080 serving the site (no 443 involved)
# Re-runnable: skips work already done.
set -euo pipefail

SRC=/var/www/mapy-my-route/deploy
DOMAIN=mapmyroute.ddns.net
CERTDIR=/home/sp00ks/.certbot/config/live/$DOMAIN

# --- 1: :80 vhost for ACME challenges ---
install -m 644 "$SRC/mapmyroute-lan.conf" /etc/apache2/sites-available/mapmyroute-lan.conf
ln -sfn /etc/apache2/sites-available/mapmyroute-lan.conf /etc/apache2/sites-enabled/mapmyroute-lan.conf
apache2ctl configtest
systemctl reload apache2
echo "[ok] :80 ACME path live"

# --- 2: issue cert if missing (as sp00ks) ---
if [ ! -f "$CERTDIR/fullchain.pem" ]; then
    echo "[..] issuing certificate via webroot"
    sudo -u sp00ks /usr/bin/certbot certonly \
        --config-dir /home/sp00ks/.certbot/config \
        --work-dir /home/sp00ks/.certbot/work \
        --logs-dir /home/sp00ks/.certbot/logs \
        --webroot -w /home/sp00ks/.certbot/webroot \
        -d "$DOMAIN" \
        --non-interactive --agree-tos --no-eff-email \
        --cert-name "$DOMAIN"
else
    echo "[ok] cert already present"
fi

# Open perms so Apache (www-data) can traverse/read the cert files.
chmod 755 /home/sp00ks/.certbot/config/live /home/sp00ks/.certbot/config/archive
chmod 755 "$CERTDIR" "/home/sp00ks/.certbot/config/archive/$DOMAIN" 2>/dev/null || true
chmod 644 "/home/sp00ks/.certbot/config/archive/$DOMAIN"/privkey*.pem 2>/dev/null || true

# --- 3: HTTPS on 8080 ---
install -m 644 "$SRC/mapmyroute-8080.conf" /etc/apache2/sites-available/mapmyroute-8080.conf
ln -sfn /etc/apache2/sites-available/mapmyroute-8080.conf /etc/apache2/sites-enabled/mapmyroute-8080.conf
apache2ctl configtest
systemctl reload apache2

echo "[done] listeners:"
ss -tlnp | grep -E ':(80|8080)\b' || true
echo "Verify: curl -I https://$DOMAIN:8080/"
