#!/bin/sh
# Switch the deployment to a domain: writes the .env that docker-compose.yml
# reads, validates it, and prints the DNS records and commands that remain.
#
#   sh scripts/set-domain.sh play.example.com \
#     --source-url https://github.com/you/your-fork \
#     --operator-name "Your Studio" --operator-contact you@example.com
#
# Options:
#   --source-url URL          public repository of THIS build (AGPL section 13)
#   --operator-name NAME      who runs the site (printed on /privacy and /terms)
#   --operator-contact VALUE  e-mail or URL players can reach you at
#   --workers N               game worker processes (1-64, default 2)
#   --multiplayer true|false  public lobbies + private lobby flow (default true)
#   --lobby-interval SECONDS  seconds between public lobbies (15-3600, default 30)
#   --env-file PATH           file to write (default ./.env next to docker-compose.yml)
#   --dry-run                 print the resulting file instead of writing it
#   --check                   after writing, resolve the domain and probe https
#   -h, --help                this text
#
# Values not given on the command line are kept from an existing env file, so
# a later domain change only needs the new hostname. Nothing here touches DNS,
# certificates or a running container.
set -eu

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

domain=""
source_url=""
operator_name=""
operator_contact=""
workers=""
multiplayer=""
lobby_interval=""
env_file=".env"
dry_run=0
check=0

while [ $# -gt 0 ]; do
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
        --source-url)
            source_url="$2"
            shift 2
            ;;
        --operator-name)
            operator_name="$2"
            shift 2
            ;;
        --operator-contact)
            operator_contact="$2"
            shift 2
            ;;
        --workers)
            workers="$2"
            shift 2
            ;;
        --multiplayer)
            multiplayer="$2"
            shift 2
            ;;
        --lobby-interval)
            lobby_interval="$2"
            shift 2
            ;;
        --env-file)
            env_file="$2"
            shift 2
            ;;
        --dry-run)
            dry_run=1
            shift
            ;;
        --check)
            check=1
            shift
            ;;
        -*)
            echo "unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            if [ -n "$domain" ]; then
                echo "only one domain, got '$domain' and '$1'" >&2
                exit 1
            fi
            domain="$1"
            shift
            ;;
    esac
done

if [ -z "$domain" ]; then
    echo "usage: sh scripts/set-domain.sh <domain> [options]  (see --help)" >&2
    exit 1
fi

# Accept a bare hostname; strip a pasted scheme or trailing slash first.
domain=$(printf '%s' "$domain" | sed -e 's#^https\{0,1\}://##' -e 's#/*$##' | tr 'A-Z' 'a-z')
case "$domain" in
    */* | *:* | *" "*)
        echo "invalid domain '$domain': give the hostname only, e.g. play.example.com" >&2
        exit 1
        ;;
esac
if ! printf '%s' "$domain" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'; then
    echo "invalid domain '$domain': expected a fully qualified hostname such as play.example.com" >&2
    exit 1
fi

# Existing values are the defaults for anything not passed on the command line.
existing() {
    [ -f "$env_file" ] || return 0
    grep -E "^$1=" "$env_file" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}
[ -n "$source_url" ] || source_url=$(existing SOURCE_URL || true)
[ -n "$operator_name" ] || operator_name=$(existing OPERATOR_NAME || true)
[ -n "$operator_contact" ] || operator_contact=$(existing OPERATOR_CONTACT || true)
[ -n "$workers" ] || workers=$(existing NUM_WORKERS || true)
[ -n "$workers" ] || workers=2
[ -n "$multiplayer" ] || multiplayer=$(existing MULTIPLAYER || true)
[ -n "$multiplayer" ] || multiplayer=true
[ -n "$lobby_interval" ] || lobby_interval=$(existing PUBLIC_LOBBY_INTERVAL_SECONDS || true)
[ -n "$lobby_interval" ] || lobby_interval=30

missing=""
[ -n "$source_url" ] || missing="$missing --source-url"
[ -n "$operator_name" ] || missing="$missing --operator-name"
[ -n "$operator_contact" ] || missing="$missing --operator-contact"
if [ -n "$missing" ]; then
    echo "the hosted profile needs$missing (the container refuses to start without them; see DEPLOY.md)" >&2
    exit 2
fi
case "$source_url" in
    http://* | https://*) ;;
    *)
        echo "invalid --source-url '$source_url': expected an http(s) URL" >&2
        exit 1
        ;;
esac
case "$source_url" in
    *openfrontio/OpenFrontIO*)
        echo "note: SOURCE_URL points at the upstream project; the AGPL offer must point at the repository of THIS build (your fork)." >&2
        ;;
esac
if ! printf '%s' "$workers" | grep -Eq '^[0-9]+$' || [ "$workers" -lt 1 ] || [ "$workers" -gt 64 ]; then
    echo "invalid --workers '$workers': expected 1-64" >&2
    exit 1
fi
case "$multiplayer" in
    true | false) ;;
    *)
        echo "invalid --multiplayer '$multiplayer': expected true or false" >&2
        exit 1
        ;;
esac
if ! printf '%s' "$lobby_interval" | grep -Eq '^[0-9]+$' || [ "$lobby_interval" -lt 15 ] || [ "$lobby_interval" -gt 3600 ]; then
    echo "invalid --lobby-interval '$lobby_interval': expected 15-3600 seconds" >&2
    exit 1
fi

git_commit=$(git rev-parse HEAD 2> /dev/null || echo unknown)
generated=$(date -u +%Y-%m-%dT%H:%M:%SZ)

managed="SITE_ADDRESS PUBLIC_ORIGIN SOURCE_URL OPERATOR_NAME OPERATOR_CONTACT WS_ALLOWED_ORIGINS NUM_WORKERS MULTIPLAYER PUBLIC_LOBBY_INTERVAL_SECONDS GIT_COMMIT"
render() {
    cat << EOT
# Written by scripts/set-domain.sh on $generated for $domain.
# Re-run the script to change the domain; edit by hand for anything else.
SITE_ADDRESS=$domain
PUBLIC_ORIGIN=https://$domain
SOURCE_URL=$source_url
OPERATOR_NAME="$operator_name"
OPERATOR_CONTACT=$operator_contact
WS_ALLOWED_ORIGINS=same-origin
NUM_WORKERS=$workers
MULTIPLAYER=$multiplayer
PUBLIC_LOBBY_INTERVAL_SECONDS=$lobby_interval
GIT_COMMIT=$git_commit
EOT
    # Keep every other key the operator added (SUBDOMAIN, BIND_HOST, ...).
    if [ -f "$env_file" ]; then
        grep -Ev '^\s*(#|$)' "$env_file" | while IFS= read -r line; do
            key=${line%%=*}
            keep=1
            for m in $managed; do [ "$key" = "$m" ] && keep=0; done
            [ "$keep" -eq 1 ] && printf '%s\n' "$line"
        done
    fi
}

if [ "$dry_run" -eq 1 ]; then
    render
    exit 0
fi

if [ -f "$env_file" ]; then
    cp "$env_file" "$env_file.bak"
fi
tmp=$(mktemp)
render > "$tmp"
mv "$tmp" "$env_file"
chmod 600 "$env_file" 2> /dev/null || true

cat << EOT
Wrote $env_file for https://$domain (previous copy: ${env_file}.bak if it existed).

Next steps:
  1. DNS: create an A record (and AAAA if you have IPv6) for $domain pointing at
     this server's public IP. Wait until 'nslookup $domain' returns it.
  2. Firewall: open TCP 80 and 443 (and UDP 443 for HTTP/3) on the server.
  3. Publish the source of this build at $source_url (AGPL section 13).
  4. Start or update the stack:
       docker compose up -d --build
     Caddy requests the certificate for $domain on the first request.
  5. Verify:
       sh scripts/set-domain.sh $domain --check
     or by hand: curl -fsS https://$domain/api/health

Rollback: restore ${env_file}.bak and run 'docker compose up -d' again.
EOT

if [ "$check" -eq 1 ]; then
    echo
    echo "DNS answers for $domain:"
    if command -v nslookup > /dev/null 2>&1; then
        nslookup "$domain" 2>&1 | grep -E 'Address|Name' | grep -v '#' || echo "  (no answer yet)"
    else
        echo "  nslookup not available on this machine"
    fi
    echo "Probes over https://$domain:"
    status=0
    for path in /api/health /sitemap.xml /privacy /manifest.webmanifest; do
        code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$domain$path" || echo 000)
        echo "  $path -> HTTP $code"
        [ "$path" = "/api/health" ] && [ "$code" != "200" ] && status=3
    done
    if [ "$status" -ne 0 ]; then
        echo "health is not answering yet: DNS may still be propagating or the stack is not up" >&2
        exit "$status"
    fi
fi
