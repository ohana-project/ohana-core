# Publish tagged releases as prebuilt multi-architecture images

Operators install Ohana by downloading the release's Compose file and pulling prebuilt images; building from source is for contributors only. Every change to `main` runs CI (lint, type check, tests, and the OpenAPI drift check) without publishing anything.

A release happens only when the maintainer pushes a semantic version tag such as `v1.2.0`. The release workflow then builds the Ohana image for `linux/amd64` and `linux/arm64` on native GitHub-hosted runners, pushes it to GHCR under the version tag, and creates a GitHub Release with generated notes and the `compose.yaml` and `.env.example` attached. That Compose file pins the Ohana image to the release version and PostgreSQL, RustFS, and Caddy to tested versions; it never uses `latest`. Ohana publishes a single application image: api, worker, and migrate are entrypoints of it, and the built web client is included in it and served by the api process ([ADR-0009](0009-runtime-and-background-work.md)). Everything else in the deployment is an upstream image.

arm64 is supported from the first release because small home servers such as the Raspberry Pi 5 commonly use it, and native dependencies (image decoding in particular) are cheaper to validate now than to retrofit.
