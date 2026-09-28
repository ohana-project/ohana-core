# Foundation constraints checked during discovery

Checked on 2026-09-28 against the primary sources below. These are research notes; recommendations here are not accepted architecture decisions.

## HTTPS and offline access

Service workers require a secure context. HTTPS is the standard deployment path; localhost and loopback addresses have development exceptions, but ordinary HTTP on a public server IP does not. A VPN alone does not change this requirement. An IP address is not inherently disallowed if the connection provides trusted HTTPS.

Sources: [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API), [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).

Browser-managed storage is best-effort by default and can be evicted under storage pressure. Persistent storage can be requested, but availability must be checked, and a user can still clear site data. Download status and actual local availability need to be visible; a previously visited document is not a guarantee of durable offline access.

Source: [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

The accepted offline product behavior is recorded in [ADR-0002](../adr/0002-offline-reading-is-a-product-requirement.md). Persistence mechanisms and the scope of automatic caching still require design.

## Calendar reminders with Web Push

The Push API can deliver messages to a service worker while the web page is not open. This supports reminders outside an open Ohana tab on compatible browsers; it does not promise delivery after a force-stop, when the device is switched off, or when permissions or operating-system policy prevent delivery.

Sources: [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [Next.js: Progressive Web Applications](https://nextjs.org/docs/app/guides/progressive-web-apps). The Next.js guide was checked through Context7 using library resolution followed by a documentation query.

On iOS and iPadOS, Web Push support starts with version 16.4 for web apps added to the Home Screen. The permission request must follow a user action. On Apple devices, delivery uses Apple Push Notification service; enrollment in the Apple Developer Program is not required.

Sources: [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [WebKit: Safari 16.4 release](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/).

The Web Push route is application server -> browser or operating-system push service -> device. For Ohana this leaves the core self-hosted but requires external push infrastructure and network access. Message expiration and device availability mean that a scheduled server send is not a guarantee of display at an exact time. Read-only offline calendar access is a separate capability from receiving a newly sent reminder.

Sources: [RFC 8030: message time to live](https://www.rfc-editor.org/rfc/rfc8030#section-5.2), [RFC 8030: expiration](https://www.rfc-editor.org/rfc/rfc8030#section-7.2), and the WebKit and Next.js guides above.

Notifications can appear on a lock screen or a paired watch. This screen-privacy question is separate from transport confidentiality: the Web Push standard requires end-to-end protection of message content. The accepted Ohana delivery and notification-content policy is recorded in [ADR-0006](../adr/0006-web-push-calendar-reminders.md).

Sources: the WebKit guide above and [RFC 8030: confidentiality](https://www.rfc-editor.org/rfc/rfc8030#section-8.1).

## Backend options

FastAPI uses Pydantic models for request validation and generates OpenAPI descriptions. Its official documentation covers generating a TypeScript SDK from that description, so a Python backend can provide a typed client for a TypeScript frontend.

Sources: [FastAPI: Request body](https://fastapi.tiangolo.com/tutorial/body/), [FastAPI: Generating SDKs](https://fastapi.tiangolo.com/advanced/generate-clients/).

Fastify uses route JSON Schemas for request validation and response serialization. Type providers can infer handler types from schemas; those types do not themselves perform runtime validation or generate a frontend SDK.

Sources: [Fastify: Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify: Type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/).

Both frameworks were checked with Context7 using library resolution followed by a documentation query. The accepted backend and package-manager decision is recorded in [ADR-0003](../adr/0003-typescript-fastify-backend.md).

Drizzle's official documentation covers PostgreSQL table declarations, type-safe SQL-like queries, transaction APIs, and Drizzle Kit SQL migration generation and application. The selected library ID was `/drizzle-team/drizzle-orm-docs`, resolved through Context7 before the documentation query.

Sources: [Drizzle overview](https://orm.drizzle.team/docs/overview), [Drizzle PostgreSQL migrations](https://orm.drizzle.team/docs/migrations), [Drizzle PostgreSQL transactions](https://orm.drizzle.team/docs/transactions).

## Runtime candidates

Checked on 2026-09-28. These candidates support [the proposed runtime decision](../adr/0009-runtime-and-background-work.md); the final queue and deployment contract still require an integration run.

The official pg-boss README requires Node.js 22.12 or newer and PostgreSQL 13 or newer. The selected Node.js 24 and PostgreSQL 18 runtimes satisfy those stated minimums, but the pinned library/database combination still needs an integration run. pg-boss documents PostgreSQL-persisted jobs, transaction-aware submission, delayed work, retries, and concurrent workers. Ohana selects pg-boss for version 1.0 so the home installation uses one worker without adding Redis. Exactly-once external effects are not inferred from queue delivery claims; notification handlers need an explicit duplicate/retry policy.

Source: [pg-boss official repository](https://github.com/timgit/pg-boss#readme). Context7 library resolution and documentation lookup were performed; its pg-boss result was DeepWiki, so these findings rely on the primary repository instead.

RustFS documents a standalone single-node, single-drive deployment and an official Docker image with persistent data under /data. The current single-drive mode cannot be expanded in place to multiple drives or pools; such growth requires a new deployment and a transfer. Its compatibility matrix includes the basic object operations Ohana needs, but does not promise support for every AWS S3 feature.

Sources: [RustFS Docker deployment](https://docs.rustfs.com/en/installation/container/docker), [RustFS repository and standalone mode](https://github.com/rustfs/rustfs#readme), [S3 compatibility matrix](https://github.com/rustfs/rustfs/blob/main/docs/architecture/s3-compatibility-matrix.md). RustFS was also checked through Context7 using library resolution followed by a documentation query.

RustFS hardware guidance distinguishes a testing minimum of one CPU core and 1 GB RAM from much larger distributed-production recommendations. Neither is a measured capacity statement for a small Ohana household deployment. Benchmark the complete proposed Compose stack before claiming a supported VPS size.

Source: [RustFS hardware guidance](https://docs.rustfs.com/en/installation/requirement/checklists/hardware-selection).
