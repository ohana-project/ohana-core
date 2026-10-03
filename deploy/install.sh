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
# Run on a terminal without a mode flag, the script is a small wizard
# (issue #51): it asks whether to enable the bundled Caddy and installs
# accordingly. It talks to the terminal itself, so it asks under
# `curl ... | sh` too; without a terminal, or with --yes, nothing is asked
# and the default shape is installed.
#
# The release workflow rewrites OHANA_INSTALL_VERSION and
# OHANA_INSTALL_REPO below to the release's tag and repository and attaches
# this script to the release, so the downloaded copy installs exactly its
# own release's files. Run straight from a repository checkout the version
# is empty and the latest release is installed instead.

set -eu

# Ranges like [a-z0-9] in case patterns and tr must not pick up locale
# surprises; every name this script validates is plain ASCII.
LC_ALL=C
export LC_ALL

# Secret-bearing files (.env, the .env backup of a --force rewrite) are
# created readable by their owner only, whatever the caller's umask was.
umask 077

OHANA_INSTALL_VERSION=''
OHANA_INSTALL_REPO=ohana-project/ohana-core

program() {
	case "${0##*/}" in
	*install*) printf '%s\n' "${0##*/}" ;;
	*) printf 'install.sh\n' ;;
	esac
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
                     [--port <port>] [--yes] [--force]

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
  -y, --yes       ask nothing: install the default mode without the wizard
  --force         overwrite an existing .env, compose.yaml, and
                  compose.override.yaml; keeps the previous secrets
                  (POSTGRES_PASSWORD, the storage keys, and
                  ADMIN_INITIAL_PASSWORD — the data volumes are keyed by
                  the first two) and the Compose project name, and leaves
                  the previous .env as a .env.bak copy
                  (.env.bak.<timestamp> when one already exists); every
                  other setting must be copied back from there

Environment:

  COMPOSE_PROJECT_NAME   pin the Compose project name the data volumes
                         belong to (lowercase letters, digits, '-' and
                         '_', starting with a letter or digit); a name
                         already in the previous .env survives a --force
                         rewrite

Run on a terminal without --caddy-domain, --external-network, --port, or
--yes, the script is a wizard: it asks whether to enable the bundled Caddy
and, if so, for the domain. It asks on the terminal itself, so piping the
script to sh still gets the questions. Without a terminal (CI, cron, output
redirected to a file) it installs the default mode without asking.

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
# script piped into sh must not consume its own stdin. A terminal that
# stops answering (it was closed, or end-of-file was typed) gets the flag
# advice instead of a hang.
ask() {
	printf '%s' "$1"
	ask_reply=
	if ! read -r ask_reply < /dev/tty; then
		say ''
		die 'no answer from the terminal; run again with --caddy-domain <domain>, or with --yes to install the default mode without questions'
	fi
}

# normalize_domain <value>: accept the shapes a browser's address bar
# suggests and keep the bare domain — Caddy's site address is a host name.
normalize_domain() {
	normalized=${1#http://}
	normalized=${normalized#https://}
	normalized=${normalized%/}
	printf '%s\n' "$normalized"
}

valid_domain() {
	case "$1" in
	'' | *[!A-Za-z0-9.-]* | [!A-Za-z0-9]*) return 1 ;;
	esac
}

check_domain() {
	valid_domain "$1" ||
		die "'$1' does not look like a domain name (example: ohana.example.com)"
}

check_port() {
	case "$1" in
	'' | *[!0-9]*)
		die "'$1' is not a port number between 1 and 65535"
		;;
	esac
	# The length cap keeps the numeric tests below from overflowing on
	# absurdly long input.
	if [ "${#1}" -gt 5 ] || [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then
		die "'$1' is not a port number between 1 and 65535"
	fi
}

check_network_name() {
	case "$1" in
	'' | bridge | host | none | default | [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*)
		die "'$1' does not look like a usable Docker network name (example: caddy_proxy)"
		;;
	esac
}

domain=
domain_set=0
external_network=
network_set=0
port=3000
port_set=0
assume_yes=0
force=0
# A Compose project name set in the caller's environment pins the project
# the same way it does for every later docker compose call.
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--caddy-domain)
		[ "$#" -ge 2 ] || die '--caddy-domain needs a value'
		[ "$domain_set" -eq 0 ] || die '--caddy-domain cannot be used twice'
		[ -n "$2" ] || die '--caddy-domain needs a value'
		domain=$2
		domain_set=1
		shift 2
		;;
	--caddy-domain=*)
		[ "$domain_set" -eq 0 ] || die '--caddy-domain cannot be used twice'
		domain=${1#*=}
		[ -n "$domain" ] || die '--caddy-domain needs a value'
		domain_set=1
		shift
		;;
	--external-network)
		[ "$#" -ge 2 ] || die '--external-network needs a value'
		[ "$network_set" -eq 0 ] || die '--external-network cannot be used twice'
		[ -n "$2" ] || die '--external-network needs a value'
		external_network=$2
		network_set=1
		shift 2
		;;
	--external-network=*)
		[ "$network_set" -eq 0 ] || die '--external-network cannot be used twice'
		external_network=${1#*=}
		[ -n "$external_network" ] || die '--external-network needs a value'
		network_set=1
		shift
		;;
	--port)
		[ "$#" -ge 2 ] || die '--port needs a value'
		port=$2
		check_port "$port"
		port_set=1
		shift 2
		;;
	--port=*)
		port=${1#*=}
		check_port "$port"
		port_set=1
		shift
		;;
	-y | --yes)
		assume_yes=1
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

if [ "$domain_set" -eq 1 ]; then
	domain=$(normalize_domain "$domain")
	check_domain "$domain"
fi
check_port "$port"
if [ "$network_set" -eq 1 ]; then
	check_network_name "$external_network"
fi

if [ "$domain_set" -eq 1 ] && [ "$network_set" -eq 1 ]; then
	die '--caddy-domain and --external-network cannot be combined'
fi

# A Compose project name set in the caller's environment pins the project
# the same way it does for every later docker compose call. Compose
# rejects names that are not already normalised, and the value ends up in
# the label filter and in .env, so it is checked here — before the
# operator answers any prompt and before anything else runs.
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
	case "$COMPOSE_PROJECT_NAME" in
	[!a-z0-9]* | *[!a-z0-9_-]*)
		die "COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}' is not a usable Compose project name (lowercase letters, digits, '-' and '_', starting with a letter or digit)"
		;;
	esac
fi

# The wizard (issue #51). It runs when no flag has already chosen the
# shape and a terminal can both show the questions and answer them: the
# answers come from /dev/tty, not stdin, so `curl ... | sh` is asked too.
# Without a terminal — CI, cron, output captured or redirected — the
# default is installed without asking. New questions belong here.
if [ "$domain_set" -eq 0 ] && [ "$network_set" -eq 0 ] && [ "$port_set" -eq 0 ] &&
	[ "$assume_yes" -eq 0 ] && [ -t 1 ] && (: < /dev/tty) 2> /dev/null; then
	say 'Ohana installer'
	say ''
	say 'The bundled Caddy web server can serve Ohana on a domain name with'
	say "automatic Let's Encrypt HTTPS. Without it, Ohana answers plain HTTP on"
	say "port ${port} of this machine."
	say ''
	while :; do
		ask 'Enable Caddy? [y/N]: '
		case "$ask_reply" in
		[Yy] | [Yy][Ee][Ss])
			domain_set=1
			break
			;;
		'' | [Nn] | [Nn][Oo])
			break
			;;
		*)
			say 'Please answer y or n.'
			;;
		esac
	done
	if [ "$domain_set" -eq 1 ]; then
		say ''
		say "Point the domain's DNS at this machine first: Caddy obtains the"
		say 'certificate as soon as it starts.'
		while :; do
			ask 'Domain name (example: ohana.example.com): '
			domain=$(normalize_domain "$ask_reply")
			if valid_domain "$domain"; then
				break
			fi
			say "'${ask_reply}' does not look like a domain name."
		done
		say ''
		say "Caddy will serve https://${domain}."
	else
		say ''
		say "Caddy stays off: plain HTTP on port ${port}."
	fi
	say ''
fi

# An explicit --port 3000 is rejected here too.
if [ "$domain_set" -eq 1 ] && [ "$port_set" -eq 1 ]; then
	die '--port does not apply to --caddy-domain; Caddy publishes OHANA_HTTP_PORT and OHANA_HTTPS_PORT instead'
fi

if [ "$domain_set" -eq 1 ]; then
	shape=caddy
elif [ "$network_set" -eq 1 ]; then
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

if [ "$shape" = external ]; then
	# `external: true` in the generated compose.override.yaml makes Compose
	# refuse to start when the network is missing; checking here — before
	# any file is written — says what to do instead.
	docker network inspect "$external_network" > /dev/null 2>&1 ||
		die "the Docker network '${external_network}' does not exist on this machine; create it (docker network create ${external_network}) or check the name (docker network ls)"
fi

# A --force rewrite of an existing installation keeps its secrets: the
# postgres and rustfs volumes still hold data keyed by them, and fresh
# ones would lock the stack out of its own data.
had_env=0
old_postgres_password=
old_storage_access_key=
old_storage_secret_key=
old_admin_password=
old_compose_project_name=
if [ -e .env ]; then
	had_env=1
	# The last occurrence wins, the way Compose reads an env file — a
	# file assembled by appending real values to the example starts with
	# an empty assignment of the same name. Leading whitespace, an export
	# prefix, and a Windows carriage return are tolerated too.
	old_postgres_password=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}POSTGRES_PASSWORD=//p' .env | tr -d '\r' | sed -n '$p')
	old_storage_access_key=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}STORAGE_ACCESS_KEY=//p' .env | tr -d '\r' | sed -n '$p')
	old_storage_secret_key=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}STORAGE_SECRET_KEY=//p' .env | tr -d '\r' | sed -n '$p')
	old_admin_password=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}ADMIN_INITIAL_PASSWORD=//p' .env | tr -d '\r' | sed -n '$p')
	old_compose_project_name=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}COMPOSE_PROJECT_NAME=//p' .env | tr -d '\r' | sed -n '$p')
fi

# Installing with fresh secrets while a data volume of this directory
# survives — its .env was deleted, or never held the password — would lock
# that data away forever: Postgres keeps the password it was initialised
# with. There is no override short of erasing the data, so this comes
# before the overwrite refusal below. The project name from the .env is
# normalised for the label lookup only: surrounding whitespace, quotes as
# a matched pair, and comments after a space are valid to Compose but
# never appear in a label. A value Compose itself would reject is refused
# here — it would only fail later, after the files have been rewritten.
# (A name glued to its comment, "install"#pinned, is refused although
# Compose accepts it; the safe side of the two.)
old_project_lookup=$(printf '%s' "$old_compose_project_name" | sed 's/^[[:space:]]*//; s/[[:space:]]* #.*//; s/[[:space:]]*$//; s/^"\(.*\)"$/\1/; s/^'\''\(.*\)'\''$/\1/')
case "$old_project_lookup" in
'') ;;
[!a-z0-9]* | *[!a-z0-9_-]*)
	die "the COMPOSE_PROJECT_NAME in .env ('${old_compose_project_name}') is not a usable Compose project name (lowercase letters, digits, '-' and '_', starting with a letter or digit); fix or remove that line"
	;;
esac
dir_project=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[_-]*//')
previous_project=${old_project_lookup:-$dir_project}
project=${COMPOSE_PROJECT_NAME:-$previous_project}
data_volume=$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter 'label=com.docker.compose.volume=postgres-data' | sed -n '1p')
media_volume=$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter 'label=com.docker.compose.volume=rustfs-data' | sed -n '1p')
locked_volume=
if [ -n "$data_volume" ] && [ -z "$old_postgres_password" ]; then
	locked_volume=$data_volume
elif [ -n "$media_volume" ] && { [ -z "$old_storage_access_key" ] || [ -z "$old_storage_secret_key" ]; }; then
	locked_volume=$media_volume
fi
if [ -n "$locked_volume" ]; then
	# The same project name can be claimed by an installation in another
	# directory; the erase advice must never reach that one. Ownership is
	# read off the project's containers; with none, nothing attributes
	# the volume to this directory and no erase command is printed. A
	# failing docker ps lands on that same arm, which is the safe side.
	here_logical=$PWD
	here=$(pwd -P)
	has_ours=0
	has_foreign=0
	while IFS= read -r owner_dir; do
		[ -z "$owner_dir" ] && continue
		if [ "$owner_dir" = "$here" ] || [ "$owner_dir" = "$here_logical" ]; then
			has_ours=1
		else
			has_foreign=1
		fi
	done <<EOF
$(docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u)
EOF
	if [ "$has_foreign" -eq 1 ]; then
		if [ -n "$COMPOSE_PROJECT_NAME" ] && [ "$COMPOSE_PROJECT_NAME" != "$previous_project" ]; then
			remedy='choose a different COMPOSE_PROJECT_NAME (or unset it)'
		elif [ -n "$COMPOSE_PROJECT_NAME" ] && [ -n "$old_project_lookup" ]; then
			remedy='change the COMPOSE_PROJECT_NAME line in .env and the COMPOSE_PROJECT_NAME in the environment'
		elif [ -n "$COMPOSE_PROJECT_NAME" ]; then
			remedy='choose a different COMPOSE_PROJECT_NAME (unsetting it is not enough: this directory name yields the same project)'
		elif [ -n "$old_project_lookup" ]; then
			remedy='change the COMPOSE_PROJECT_NAME line in .env'
		else
			remedy='install into a differently named directory, or set COMPOSE_PROJECT_NAME to a name of its own'
		fi
		die "a data volume of the Compose project '${project}' still exists, but its secret is not available here — and that project also belongs to an installation in another directory, so it must not be erased from here; ${remedy}, or restore the old .env (at least its POSTGRES_PASSWORD, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY lines)"
	fi
	if [ "$has_ours" -eq 1 ]; then
		die "a data volume of the Compose project '${project}' (${locked_volume}) still exists, but its secret is not available here; installing would lock that data away — restore the old .env (at least its POSTGRES_PASSWORD, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY lines), or erase this installation's data for good (this also stops its containers): docker compose -p ${project} down --volumes"
	fi
	die "a data volume of the Compose project '${project}' (${locked_volume}) still exists, but its secret is not available here, and with the project's containers gone this script cannot tell whether that volume is this directory's — restore the old .env (at least its POSTGRES_PASSWORD, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY lines), or, only if you are certain the Compose project '${project}' belongs to this directory, inspect and erase the volume yourself: docker volume inspect ${locked_volume}, then docker volume rm ${locked_volume}"
fi

# A --force rewrite under a different project name than the previous
# installation's would leave it untouched and come up on empty volumes —
# or clash with its ports. Refused only on evidence: an explicit name in
# the previous .env. A directory rename with no pin is exactly the case
# where COMPOSE_PROJECT_NAME reattaches the old volumes.
if [ "$had_env" -eq 1 ] && [ -n "$old_project_lookup" ] && [ -n "$COMPOSE_PROJECT_NAME" ] && [ "$COMPOSE_PROJECT_NAME" != "$previous_project" ]; then
	die "this directory's .env pins the Compose project '${previous_project}', but the environment says COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}'; running would move it to a different, empty set of volumes — unset COMPOSE_PROJECT_NAME, change COMPOSE_PROJECT_NAME in .env, or install elsewhere"
fi

for file in .env compose.yaml compose.override.yaml; do
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

# Only reached on a real rewrite (the download succeeded): keep the
# previous .env as a backup — only the secrets are carried over; other
# operator-written settings must be copied back from it by hand. A second
# rewrite must not destroy the first backup, so an existing one gets a
# timestamped name.
if [ "$had_env" -eq 1 ]; then
	backup=.env.bak
	if [ -e "$backup" ]; then
		backup=".env.bak.$(date +%Y%m%d%H%M%S)"
	fi
	cp .env "$backup"
	say "Only the secrets and the Compose project name are carried over from the previous .env; its unmodified copy is kept as ${backup} — copy any other settings you had back from there (STORAGE_ENDPOINT and STORAGE_BUCKET in particular, if you used external object storage)."
fi

# A compose.override.yaml left behind by an earlier --external-network
# install would still be merged by docker compose in the other modes, so a
# --force run in them removes it. Only after the download succeeded, so a
# failed download still leaves the directory untouched.
if [ "$shape" != external ] && [ "$force" -eq 1 ] && [ -e compose.override.yaml ]; then
	rm compose.override.yaml
	say 'Removed the compose.override.yaml of an earlier external-network install.'
fi

postgres_password=${old_postgres_password:-$(random_secret)}
storage_access_key=${old_storage_access_key:-$(random_secret)}
storage_secret_key=${old_storage_secret_key:-$(random_secret)}
admin_password=${old_admin_password:-$(random_secret)}

up_command='docker compose up -d --wait'

say 'Writing .env'

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
# ${external_network}, where your reverse proxy reaches it under the name
# "ohana". Removing this file detaches Ohana again.
services:
  api:
    networks:
      default: null
      ${external_network}:
        aliases:
          - ohana

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

# Pin the Compose project name, so the data volumes stay with this
# directory: from the install's environment, or carried from the previous
# .env. Without one the directory name decides, which a rename would
# silently change.
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
	printf '\n# From the environment the installer ran with: the Compose project\n# name the data volumes belong to.\nCOMPOSE_PROJECT_NAME=%s\n' "$COMPOSE_PROJECT_NAME" >> .env
elif [ -n "$old_project_lookup" ]; then
	printf '\n# Kept from the previous .env: the Compose project name the existing\n# data volumes belong to.\nCOMPOSE_PROJECT_NAME=%s\n' "$old_compose_project_name" >> .env
fi

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
	say '           reverse_proxy ohana:3000'
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

if [ "$shape" = bare ]; then
	say ''
	say 'Two things to know about this mode:'
	say '  - Signing in sets Secure cookies, which browsers keep off plain'
	say '    HTTP. Reach Ohana through an SSH tunnel from your machine —'
	say '    some browsers refuse even that on localhost — or serve HTTPS'
	say '    with --caddy-domain or your own reverse proxy'
	say '    (--external-network).'
	say '  - The port is published on all interfaces, and Docker publishes'
	say '    ports past common firewall rules (ufw, firewalld).'
fi

if [ "$had_env" -eq 1 ]; then
	say ''
	say 'The initial password above is used only while no administrator exists'
	say 'yet; if one already exists, sign in with the password you set then.'
else
	say ''
	say 'The password above is for the first sign-in. Change it in the'
	say 'administrative area; after that the ADMIN_INITIAL_PASSWORD line in'
	say '.env is safe to remove.'
fi
