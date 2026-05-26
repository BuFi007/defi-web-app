FROM rust:1.93-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler ca-certificates pkg-config && \
    rm -rf /var/lib/apt/lists/*
COPY services/matcher/ .
RUN cargo build --release -p bufi-matcher-server

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /build/target/release/bufi-matcher /usr/local/bin/bufi-matcher
COPY services/matcher/deployments/ /opt/deployments/
ENV FX_TELARANA_DEPLOYMENTS=/opt/deployments
EXPOSE 3005 3006 3007
USER nonroot
ENTRYPOINT ["/usr/local/bin/bufi-matcher"]
