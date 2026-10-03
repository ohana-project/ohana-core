#!/bin/sh
# Ohana installer (ADR-0018). Downloads the release's pinned compose.yaml,
# generates the secrets, asks how the installation is reached, and starts
# the stack — the one-command install from a release page (issue #49).
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
Usage: sh install.sh [--domain <domain> | --no-domain] [--port <port>] [--force]

  --domain <domain>  serve https://<domain> through Caddy with automatic
                     Let's Encrypt HTTPS (the `caddy` Compose profile)
  --no-domain        serve plain HTTP on a port of this machine
  --port <port>      the port for --no-domain (default: 3000)
  --force            overwrite an existing .env and compose.yaml

Without --domain or --no-domain the script asks on the terminal. When
there is no terminal — piping this script to sh, for example — pass a
flag.

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
		die 'no terminal to answer; run again with --domain <domain> or --no-domain'
	fi
}

domain=
port=3000
force=0
shape=

while [ "$#" -gt 0 ]; do
	case "$1" in
	--domain)
		[ "$#" -ge 2 ] || die '--domain needs a value'
		[ "$shape" != bare ] || die '--domain and --no-domain cannot be combined'
		domain=$2
		shift 2
		;;
	--domain=*)
		domain=${1#*=}
		shift
		;;
	--no-domain)
		[ -z "$domain" ] || die '--domain and --no-domain cannot be combined'
		shape=bare
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
	shape=domain
fi

case "$port" in
'' | *[!0-9]*)
	die "'$port' is not a port number between 1 and 65535"
	;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
	die "'$port' is not a port number between 1 and 65535"
fi

# The deployment shape: a domain (HTTPS through Caddy) or a bare port.
if [ -z "$shape" ]; then
	say 'How should Ohana be reached?'
	say "  1. A domain name of this machine (automatic HTTPS through Let's Encrypt)"
	say '  2. Plain HTTP on a port of this machine'
	ask 'Choose 1 or 2 [2]: '
	case "$ask_reply" in
	1)
		ask 'Domain name (example: ohana.example.com): '
		case "$ask_reply" in
		'' | *[!A-Za-z0-9.-]* | [!A-Za-z0-9]*)
			die "'$ask_reply' does not look like a domain name"
			;;
		esac
		domain=$ask_reply
		shape=domain
		;;
	2 | '')
		ask 'Port to publish Ohana on [3000]: '
		if [ -n "$ask_reply" ]; then
			port=$ask_reply
		fi
		case "$port" in
		'' | *[!0-9]*)
			die "'$port' is not a port number between 1 and 65535"
			;;
		esac
		shape=bare
		;;
	*)
		die 'please answer 1 or 2 (or run again with --domain <domain> or --no-domain)'
		;;
	esac
fi

command -v docker > /dev/null 2>&1 ||
	die 'Docker is not installed. Install Docker Engine and the Compose plugin first: https://docs.docker.com/engine/install/'

docker compose version > /dev/null 2>&1 ||
	die 'the Docker Compose plugin is not available. Install it: https://docs.docker.com/compose/install/'

docker info > /dev/null 2>&1 ||
	die 'Docker is installed but not running. Start it (for example: sudo systemctl start docker)'

for file in .env compose.yaml; do
	if [ -e "$file" ] && [ "$force" -ne 1 ]; then
		die "$file already exists here; refusing to overwrite it (run with --force to overwrite, or install elsewhere)"
	fi
done

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

if [ "$shape" = domain ]; then
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

# The whole application is served from this port.
OHANA_PORT=${port}
ENV
	up_command='docker compose up -d --wait'
	url="http://localhost:${port}"
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

say ''
say 'Ohana is up and healthy.'
say ''
say "  Open:                   ${url}"
say "  Instance administrator: ${url}/admin"
say "  Password:               ${admin_password}"
say ''
say 'The password above is for the first sign-in. Change it in the'
say 'administrative area; after that the ADMIN_INITIAL_PASSWORD line in'
say '.env is safe to remove.'
