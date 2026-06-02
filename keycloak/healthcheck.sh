#!/bin/sh
set -e
exec 3<>/dev/tcp/localhost/9000
printf 'GET /health/ready HTTP/1.0\r\n\r\n' >&3
IFS= read -r line <&3
case "$line" in *200*) exit 0 ;; *) exit 1 ;; esac
