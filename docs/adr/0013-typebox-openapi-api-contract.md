# Define the API contract with TypeBox and publish it as OpenAPI

API routes declare request and response schemas with TypeBox, using `@fastify/type-provider-typebox`. TypeBox produces standard JSON Schema, so Fastify's native validation and serialisation remain in charge at runtime while handlers get inferred TypeScript types. `@fastify/swagger` generates an OpenAPI document from the same route schemas.

OpenAPI is the only shared contract between the API and its clients. The web client uses types generated from it (`openapi-typescript` with `openapi-fetch`) rather than importing backend code, the same way future native iOS and Android clients will. Zod through a Fastify type provider was rejected because it replaces Fastify's native JSON Schema compilers; tRPC and oRPC were rejected because they suit TypeScript-only clients and would leave native clients without a first-class contract.
