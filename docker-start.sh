#!/bin/sh
set -eu

if [ "${LOCAL_ONLY:-true}" != "true" ]; then
    echo "This image contains the fail-closed local asset profile; LOCAL_ONLY must be true." >&2
    exit 64
fi
if [ -n "${CDN_BASE:-}" ]; then
    echo "This image is self-contained; CDN_BASE must be empty for the local asset profile." >&2
    exit 64
fi
if [ "${DOMAIN:-}" != "localhost" ]; then
    echo "This image is self-contained; DOMAIN must be localhost." >&2
    exit 64
fi
if [ "${GAME_ENV:-}" != "dev" ]; then
    echo "This image is self-contained; GAME_ENV must be dev." >&2
    exit 64
fi
case "${TRUST_PROXY_HOPS:-}" in
    1 | 2 | 3 | 4) ;;
    *)
        echo "This image trusts one hop per reverse proxy in front of it (nginx alone = 1, TLS proxy + nginx = 2); TRUST_PROXY_HOPS must be 1-4." >&2
        exit 64
        ;;
esac
if [ "${TURNSTILE_SITE_KEY:-}" != "1x00000000000000000000AA" ]; then
    echo "This image requires Cloudflare's public Turnstile test key." >&2
    exit 64
fi
if env | grep -Eq '^(ADMIN_BOT_API_KEY|API_DOMAIN|API_KEY|STRIPE_PUBLISHABLE_KEY|OTEL_[^=]*|TELEMETRY_[^=]*)=.+$'; then
    echo "This image rejects external integration credentials and telemetry settings." >&2
    exit 64
fi

if [ -n "${PUBLIC_ORIGIN:-}" ]; then
    case "${PUBLIC_ORIGIN}" in
        http://*/* | https://*/* | http:// | https://)
            echo "PUBLIC_ORIGIN must be an origin such as https://play.example.com (no path)." >&2
            exit 64
            ;;
        http://* | https://*) ;;
        *)
            echo "PUBLIC_ORIGIN must start with https:// (or http:// for a local probe)." >&2
            exit 64
            ;;
    esac
    for required in SOURCE_URL OPERATOR_NAME OPERATOR_CONTACT WS_ALLOWED_ORIGINS; do
        eval "value=\${${required}:-}"
        if [ -z "${value}" ]; then
            echo "Hosted profile (PUBLIC_ORIGIN) requires ${required}." >&2
            exit 64
        fi
    done
    case "${PUBLIC_ORIGIN}" in
        https://*)
            if [ "${ENABLE_HSTS:-}" != "true" ]; then
                echo "Hosted profile over https requires ENABLE_HSTS=true." >&2
                exit 64
            fi
            ;;
    esac
fi

mkdir -p /tmp/front-wars-nginx/conf.d
/usr/local/bin/generate-nginx-upstream.sh

if [ "${DOMAIN:-}" = "openfront.dev" ] && [ "${SUBDOMAIN:-}" != "main" ]; then
    exec timeout 25h /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
