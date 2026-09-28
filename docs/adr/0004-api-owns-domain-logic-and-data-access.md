# Keep domain logic and data access in one modular backend

Use apps/web for the React single-page client ([ADR-0012](0012-static-react-spa-client.md)) and apps/api for the Fastify backend. Authentication, authorization, domain rules, and database and object-storage operations belong to the API; the web client obtains and changes domain data through that API rather than accessing the database or RustFS directly. The journal, calendar, and wishlist are internal modules of the same backend.

This boundary provides one implementation of space permissions and domain rules for the web client and future mobile clients, at the cost of maintaining an explicit API contract ([ADR-0013](0013-typebox-openapi-api-contract.md)). It does not require a separate service per feature. Background execution and the deployment process layout are defined in [ADR-0009](0009-runtime-and-background-work.md).

The API authorizes member actions using the independent member model in [ADR-0005](0005-independent-space-accounts.md). A client switching between retained sign-ins does not widen the authorization of any individual session.

Version 1.0 accepts image uploads through the API. The API checks the selected member's permissions and streams or stores the file through the S3 storage adapter before returning the result to the client; direct browser access to object storage is deferred.

Expose the API under the same public origin as the web client, using the `/api/` path behind Caddy or another reverse proxy. This keeps browser requests same-origin and avoids a separate web-to-API CORS boundary in the standard deployment.
