# infra/docker/rust-matching.Dockerfile
FROM rust:1.78-bookworm AS builder
WORKDIR /app/services/matching-engine
COPY services/matching-engine .
RUN apt-get update && apt-get install -y protobuf-compiler && cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/services/matching-engine/target/release/nexus-matching-engine /usr/local/bin/nexus-matching-engine
EXPOSE 50051
CMD ["nexus-matching-engine"]
