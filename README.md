# NexusTrade Exchange

Enterprise cryptocurrency exchange monorepo based on `NexusTrade_Exchange_SRD.docx`.

## Repository Layout

- `packages/shared`: domain contracts, Kafka event envelopes, proto definitions, decimal utilities, gRPC client wrappers.
- `packages/database`: TypeORM entities, migrations, and seed data.
- `services/*`: NestJS microservices and the Rust matching engine.
- `apps/frontend`: Next.js 15 admin dashboard.
- `infra`: Docker, Kubernetes, Terraform, Prometheus/Grafana, and Fluentd assets.

## Local Development

1. Install Node 22+, npm 10+, Rust stable, Docker, and Docker Compose.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start local infrastructure:

   ```bash
   npm run dev:infra
   ```

4. Build packages:

   ```bash
   npm run build
   ```

5. Run tests:

   ```bash
   npm test
   cargo test --manifest-path services/matching-engine/Cargo.toml
   ```

## Core Runtime Ports

- API Gateway: `3000`
- Auth Service: `3001`
- User Service: `3002`
- Trading Service: `3003`
- Wallet Service: `3004`
- Market Data Service: `3005`
- Risk Engine: `3006`
- Deposit Service: `3007`
- Withdrawal Service: `3008`
- Compliance Service: `3009`
- Notification Service: `3010`
- Frontend Admin: `3020`
- Matching Engine gRPC: `50051`

## Security Notes

All monetary values are represented as decimal strings and parsed through `decimal.js` in TypeScript or `rust_decimal` in Rust. Balance mutations are modeled as transactional ledger movements. HSM, MPC, sanctions, SMS, and push integrations are explicit adapter boundaries so production providers can be wired without changing the service contracts.
