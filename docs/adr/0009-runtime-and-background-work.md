---
status: accepted
---

# Run one API and one worker per installation

Ohana is designed primarily as a home self-hosted service. Version 1.0 therefore runs one api container, one worker container, PostgreSQL 18, and RustFS per installation. The web client is a static build ([ADR-0012](0012-static-react-spa-client.md)) with no server process of its own; the api process serves its files alongside `/api/`, so a single port exposes the whole application. Caddy is an optional additional service for installations that want Ohana to terminate HTTPS and reverse-proxy that port; operators may disable it and point an existing proxy at the api port instead. The administrative interface remains part of apps/web, and journal, calendar, and wishlist remain internal backend modules rather than separate services.

The TypeScript applications use Node.js 24. The api and worker use the same backend codebase and Docker image with different entrypoints.

The worker is a separate process for responsibility and failure isolation, not for horizontal scaling. It handles delayed calendar reminders, image-derivative work, and permanent trash purges while the API continues serving requests. Use pg-boss as the PostgreSQL-backed job library: the API writes jobs to PostgreSQL, and the worker claims and executes them. This keeps jobs across an API or worker restart without adding Redis or another queue server. Keep job submission aligned with committed domain changes and make retryable work safe to repeat; do not assume exactly-once external notification delivery. Calendar recurrence and exceptions remain Ohana domain logic.

The supported deployment target is one instance of each; running multiple replicas is outside the home-installation goal and is not part of version 1.0.

PostgreSQL stores application records and jobs; RustFS stores original images and derivatives using an S3-compatible storage adapter. Both use persistent storage. Database and object-storage services remain internal to the deployment; clients access application data through the API. Start with a single RustFS node and drive, validating the selected image and required S3 operations during foundation implementation. The backend depends only on the S3 API, not on RustFS specifics, so operators with large photo libraries can point Ohana at a distributed RustFS deployment or another S3-compatible store instead of the bundled node; a single-drive RustFS node cannot be expanded in place, so growth means moving objects to the new target.

The selected queue version must be integration-tested with PostgreSQL 18, Caddy must be tested both enabled and disabled, and the whole deployment measured on the target host before publishing resource recommendations. Current primary-source findings are recorded in [the foundation research](../research/foundation-constraints.md#runtime-candidates).
