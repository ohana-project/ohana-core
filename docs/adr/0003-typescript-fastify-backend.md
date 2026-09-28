# Use TypeScript and Fastify for the backend

Use TypeScript with Fastify for the Ohana backend. The maintainer has similar experience with Python/FastAPI and TypeScript/Fastify, so the deciding benefit is keeping application development in the same language as the React frontend ([ADR-0012](0012-static-react-spa-client.md)). FastAPI was a viable alternative, including through an OpenAPI-generated TypeScript client; the choice is about maintenance preferences rather than a missing capability.

Use Node.js 24 as the runtime for the TypeScript applications and use pnpm as the repository's package manager. Application responsibilities and the web/API boundary are defined in [ADR-0004](0004-api-owns-domain-logic-and-data-access.md). Runtime process boundaries and background execution are defined in [ADR-0009](0009-runtime-and-background-work.md); the API contract is defined in [ADR-0013](0013-typebox-openapi-api-contract.md).
