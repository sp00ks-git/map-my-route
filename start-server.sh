#!/bin/bash
# Start the mapmyroute local dev file server on 127.0.0.1:8080.
#
# NOTE: production traffic goes through Apache (sp00ks.ddns.net/route/),
# which serves this directory DIRECTLY via Alias — the python server is only
# a local-dev convenience and must NOT bind to the LAN IP (the old
# 192.168.1.122 binding was unreachable externally anyway and needlessly
# exposed the directory on the LAN).
cd "$(dirname "$0")"
exec python3 -m http.server 8080 --bind 127.0.0.1
