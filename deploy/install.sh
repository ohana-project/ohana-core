#!/bin/sh
# Ohana installer (ADR-0018). Downloads the release's pinned compose.yaml,
# generates the secrets, and starts the stack — the one-command install
# from a release page (issue #49).
#
# Three shapes:
#   default:                 the api answers plain HTTP on a port of this
#                            machine; no reverse proxy is involved;
#   --caddy-domain <name>:   the bundled Caddy serves a domain with
#                            automatic Let's Encrypt HTTPS;
#   --external-network <n>:  the api joins an existing Docker network so a
#                            reverse proxy in another Compose project (the
#                            operator's own Caddy, Traefik, nginx) can reach
#                            it, through a generated compose.override.yaml
#                            — the release's compose.yaml is never edited.
#
# The release workflow rewrites OHANA_INSTALL_VERSION below to the release's
# tag and attaches this script to the release, so the downloaded copy
# installs exactly its own release's files. Run straight from a repository
# checkout the version is empty and the latest release is installed instead.

set -eu

OHANA_INSTALL_VERSION=''
OHANA_INSTALL_REPO=ohana-project/ohana-core

program() {
	basename "${0:-install.sh}"
}

say() {
	printf '%s\n' "$*"
}

die() {
	printf '%s: %s\n' "$(program)" "$*" >&2
	exit 1
}

usage() {
	cat <<'USAGE'
Usage: sh install.sh [--caddy-domain <domain> | --external-network <network>]
                     [--port <port>] [--force]

Modes, mutually exclusive:

  (default)                  serve plain HTTP on a port of this machine; no
                             reverse proxy is involved
  --caddy-domain <domain>    serve https://<domain> through the bundled
                             Caddy with automatic Let's Encrypt HTTPS (the
                             `caddy` Compose profile)
  --external-network <name>  attach the api to an existing Docker network so
                             a reverse proxy in another Compose project (an
                             own Caddy, Traefik, nginx) can reach it; writes
                             a compose.override.yaml and prints the proxy
                             configuration to add

Options:

  --port <port>   the host port publishing the api in the default and
                  --external-network modes (default: 3000); in
                  --external-network mode it is bound to 127.0.0.1, because
                  the proxy reaches the api over the shared network
  --force         overwrite an existing .env, compose.yaml, or
                  compose.override.yaml

Without a mode flag and run on a terminal, the script asks which mode to
use. Without a terminal — piping this script to sh, for example — it uses
the default mode, so the one-liner needs no flags.

The script downloads the release's compose.yaml, generates the secrets
into .env, and starts the stack with `docker compose up -d --wait`. The
generated .env and the release's env.production.example document every
setting.
USAGE
}

# 48 hexadecimal characters: safe inside DATABASE_URL (no URL escaping
# problem for the database password), inside .env, and inside a shell.
random_secret() {
	secret=
	if command -v openssl > /dev/null 2>&1; then
		secret=$(openssl rand -hex 24)
	elif [ -r /dev/urandom ]; then
		secret=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
	fi
	if [ "${#secret}" -ne 48 ]; then
		die 'cannot generate random secrets: neither openssl nor /dev/urandom is available'
	fi
	printf '%s\n' "$secret"
}

# ask <prompt>: read the answer from the terminal, never from stdin — a
# script piped into sh must not consume its own stdin, and an operator
# session without a terminal gets the flag advice instead of a hang.
ask() {
	printf '%s' "$1"
	ask_reply=
	if ! read -r ask_reply < /dev/tty; then
		die 'no terminal to answer; run again with --caddy-domain <domain> or --external-network <network>'
	fi
}

domain=
external_network=
port=3000
force=0

while [ "$#" -gt 0 ]; do
	case "$1" in
	--caddy-domain)
		[ "$#" -ge 2 ] || die '--caddy-domain needs a value'
		[ -z "$domain" ] || die '--caddy-domain cannot be used twice'
		domain=$2
		shift 2
		;;
	--caddy-domain=*)
		domain=${1#*=}
		shift
		;;
	--external-network)
		[ "$#" -ge 2 ] || die '--external-network needs a value'
		[ -z "$external_network" ] || die '--external-network cannot be used twice'
		external_network=$2
		shift 2
		;;
	--external-network=*)
		external_network=${1#*=}
		shift
		;;
	--port)
		[ "$#" -ge 2 ] || die '--port needs a value'
		port=$2
		shift 2
		;;
	--port=*)
		port=${1#*=}
		shift
		;;
	--force)
		force=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		die "unknown option: $1 (see $(program) --help)"
		;;
	esac
done

# Accept the shapes a browser's address bar suggests and keep the bare
# domain: Caddy's site address is a host name.
case "$domain" in
http://*) domain=${domain#http://} ;;
https://*) domain=${domain#https://} ;;
esac
domain=${domain%/}

if [ -n "$domain" ]; then
	case "$domain" in
	*[!A-Za-z0-9.-]* | [!A-Za-z0-9]*)
		die "'$domain' does not look like a domain name (example: ohana.example.com)"
		;;
	esac
fi

case "$port" in
'' | *[!0-9]*)
	die "'$port' is not a port number between 1 and 65535"
	;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
	die "'$port' is not a port number between 1 and 65535"
fi

if [ -n "$external_network" ]; then
	case "$external_network" in
	[!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*)
		die "'$external_network' does not look like a Docker network name (example: caddy_proxy)"
		;;
	esac
fi

if [ -n "$domain" ] && [ -n "$external_network" ]; then
	die '--caddy-domain and --external-network cannot be combined'
fi
if [ -n "$domain" ] && [ "$port" != 3000 ]; then
	die '--port does not apply to --caddy-domain; Caddy publishes OHANA_HTTP_PORT and OHANA_HTTPS_PORT instead'
fi

# The deployment shape. Interactive only when a terminal is on stdin:
# piped (curl | sh) or redirected runs take the default without asking,
# so the one-liner stays a one-liner.
if [ -z "$domain" ] && [ -z "$external_network" ] && [ -t 0 ]; then
	say 'How should Ohana be reached?'
	say '  1. Plain HTTP on a port of this machine (the default)'
	say "  2. A domain name of this machine (HTTPS through the bundled Caddy, Let's Encrypt)"
	say '  3. Behind my own reverse proxy in another Compose project (a shared Docker network)'
	ask 'Choose 1, 2, or 3 [1]: '
	case "$ask_reply" in
	1 | '')
		ask 'Port to publish Ohana on [3000]: '
		if [ -n "$ask_reply" ]; then
			port=$ask_reply
		fi
		case "$port" in
		'' | *[!0-9]*)
			die "'$port' is not a port number between 1 and 65535"
			;;
		esac
		;;
	2)
		ask 'Domain name (example: ohana.example.com): '
		case "$ask_reply" in
		'' | *[!A-Za-z0-9.-]* | [!A-Za-z0-9]*)
			die "'$ask_reply' does not look like a domain name"
			;;
		esac
		domain=$ask_reply
		;;
	3)
		ask 'Name of the Docker network shared with your reverse proxy: '
		case "$ask_reply" in
		'' | [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*)
			die "'$ask_reply' does not look like a Docker network name"
			;;
		esac
		external_network=$ask_reply
		;;
	*)
		die 'please answer 1, 2, or 3 (or run again with --caddy-domain <domain> or --external-network <network>)'
		;;
	esac
fi

if [ -n "$domain" ]; then
	shape=caddy
elif [ -n "$external_network" ]; then
	shape=external
else
	shape=bare
fi

command -v docker > /dev/null 2>&1 ||
	die 'Docker is not installed. Install Docker Engine and the Compose plugin first: https://docs.docker.com/engine/install/'

docker compose version > /dev/null 2>&1 ||
	die 'the Docker Compose plugin is not available. Install it: https://docs.docker.com/compose/install/'

docker info > /dev/null 2>&1 ||
	die 'Docker is installed but not running. Start it (for example: sudo systemctl start docker)'

for file in .env compose.yaml compose.override.yaml; do
	if [ -e "$file" ] && [ "$force" -ne 1 ]; then
		die "$file already exists here; refusing to overwrite it (run with --force to overwrite, or install elsewhere)"
	fi
done

# A compose.override.yaml left behind by an earlier --external-network
# install would still be merged by docker compose in the other modes, so
# --force removes it there rather than silently keeping it.
if [ "$shape" != external ] && [ "$force" -eq 1 ] && [ -e compose.override.yaml ]; then
	rm compose.override.yaml
	say 'Removed the compose.override.yaml of an earlier external-network install.'
fi

if [ -z "$OHANA_INSTALL_VERSION" ]; then
	assets_base="https://github.com/${OHANA_INSTALL_REPO}/releases/latest/download"
	display_version=latest
else
	assets_base="https://github.com/${OHANA_INSTALL_REPO}/releases/download/${OHANA_INSTALL_VERSION}"
	display_version=$OHANA_INSTALL_VERSION
fi

say "Installing Ohana ${display_version} into $(pwd)"

compose_tmp=.compose.yaml.$$
trap 'rm -f "$compose_tmp"' EXIT

# GitHub asset URLs answer 302, so -L is what turns the download into the
# file rather than a redirection page — a plain `curl -O` would save a
# zero-byte file; -f turns HTTP errors into a failed download instead of a
# saved error page.
curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 10 \
	"${assets_base}/compose.yaml" > "$compose_tmp" ||
	die 'downloading compose.yaml failed; check the network and that the release exists'

# A truncated or otherwise wrong body must never become the deployment.
if [ ! -s "$compose_tmp" ] || ! grep -q '^services:' "$compose_tmp"; then
	die 'the downloaded compose.yaml is empty or not a Compose file; nothing was changed'
fi
if ! grep -Eq "image: ghcr\\.io/${OHANA_INSTALL_REPO}[:@]" "$compose_tmp"; then
	die 'the downloaded compose.yaml does not pin the Ohana image; nothing was changed'
fi
mv "$compose_tmp" compose.yaml
trap - EXIT

postgres_password=$(random_secret)
storage_access_key=$(random_secret)
storage_secret_key=$(random_secret)
admin_password=$(random_secret)

up_command='docker compose up -d --wait'

if [ "$shape" = bare ]; then
	cat > .env <<ENV
# Ohana deployment environment, written by install.sh.
# The release's env.production.example documents every setting.

# The whole application is served from this port.
OHANA_PORT=${port}
ENV
	url="http://localhost:${port}"
elif [ "$shape" = caddy ]; then
	cat > .env <<ENV
# Ohana deployment environment, written by install.sh.
# The release's env.production.example documents every setting.

# The api stays on the loopback interface only; Caddy serves HTTPS.
OHANA_PORT=127.0.0.1:3000

# Caddy serves this domain with automatic Let's Encrypt HTTPS.
CADDY_ADDRESS=${domain}

# Host ports publishing Caddy.
OHANA_HTTP_PORT=80
OHANA_HTTPS_PORT=443
ENV
	up_command='docker compose --profile caddy up -d --wait'
	url="https://${domain}"
else
	cat > .env <<ENV
# Ohana deployment environment, written by install.sh.
# The release's env.production.example documents every setting.

# The api answers on the loopback interface only: your reverse proxy
# reaches it over the shared Docker network (see compose.override.yaml),
# and this published port stays a loopback-only convenience for trying
# the installation out and for debugging.
OHANA_PORT=127.0.0.1:${port}
ENV
	cat > compose.override.yaml <<EOF
# Written by install.sh. docker compose merges this over compose.yaml
# automatically; it attaches the api to the existing Docker network
# ${external_network} so the reverse proxy of another Compose project can
# reach it. Removing this file detaches Ohana again.
services:
  api:
    networks:
      - default
      - ${external_network}

networks:
  ${external_network}:
    external: true
EOF
	url="http://127.0.0.1:${port}"
fi

cat >> .env <<ENV

# Generated secrets. Changing POSTGRES_PASSWORD or the storage keys after
# the first start makes the existing data unreachable.
POSTGRES_PASSWORD=${postgres_password}
STORAGE_ACCESS_KEY=${storage_access_key}
STORAGE_SECRET_KEY=${storage_secret_key}

# Used only on the very first start: the api provisions the instance
# administrator from it. Sign in once, change the password in the
# administrative area, then this line is safe to remove.
ADMIN_INITIAL_PASSWORD=${admin_password}
ENV

# The file holds generated secrets; keep it to the operator who ran this.
chmod 600 .env

if [ "$shape" = external ]; then
	# `external: true` makes Compose refuse to start when the network is
	# missing; checking here says what to do instead.
	docker network inspect "$external_network" > /dev/null 2>&1 ||
		die "the Docker network '${external_network}' does not exist on this machine; create it (docker network create ${external_network}) or check the name (docker network ls)"
fi

say 'Writing .env'
say 'Starting the stack (this pulls the images; it can take a few minutes)...'

if ! $up_command; then
	say ''
	say 'The stack did not come up healthy. Inspect it with:'
	say '  docker compose ps'
	say '  docker compose logs'
	say 'and, once the problem is fixed, start it again with:'
	say "  ${up_command}"
	exit 1
fi

api_container=
if api_id=$(docker compose ps -q api | sed -n '1p') && [ -n "$api_id" ]; then
	api_container=$(docker inspect --format '{{.Name}}' "$api_id" 2> /dev/null || true)
	api_container=${api_container#/}
fi

say ''
say 'Ohana is up and healthy.'

if [ "$shape" = external ]; then
	say ''
	say "The api joined the Docker network '${external_network}'. Finish the"
	say 'installation in your own reverse proxy:'
	say ''
	say "  1. Join the proxy's container to the same network: in the"
	say "     proxy's Compose project, declare"
	say ''
	say '       networks:'
	say "         ${external_network}:"
	say '           external: true'
	say ''
	say '     and add the network to the proxy service.'
	say ''
	say '  2. Add a site that points at the api. In a Caddyfile:'
	say ''
	say '       <your Ohana domain> {'
	if [ -n "$api_container" ]; then
		say "           reverse_proxy ${api_container}:3000"
	else
		say '           reverse_proxy <the api container name>:3000'
		say ''
		say "     (find the api container's name with: docker compose ps)"
	fi
	say '       }'
	say ''
	say '  3. Reload the proxy. Serve Ohana through HTTPS: the sign-in'
	say '     cookies are Secure and need it off-localhost.'
	say ''
	say "Until then, Ohana answers on ${url} from this machine only."
	say ''
	say '  Instance administrator: <your Ohana domain>/admin'
	say "  Password:               ${admin_password}"
else
	say ''
	say "  Open:                   ${url}"
	say "  Instance administrator: ${url}/admin"
	say "  Password:               ${admin_password}"
fi

say ''
say 'The password above is for the first sign-in. Change it in the'
say 'administrative area; after that the ADMIN_INITIAL_PASSWORD line in'
say '.env is safe to remove.'
