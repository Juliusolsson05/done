# The hosted web app as one small image: the interface is built first, then
# built into the server program, and only that program is shipped.

FROM node:22-slim AS ui
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Bookworm, the same Debian as the image it runs in below: built on a newer one,
# the program asks for a C runtime the running image does not have.
FROM rust:1-slim-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY --from=ui /src/ui/dist ./ui/dist
# Only the server: the desktop app needs macOS and is not part of the image.
RUN cargo build --release -p done-server

# No shell and no package manager in what runs: there is nothing in it to use
# once inside. The server needs no system libraries beyond the C runtime
# (SQLite and TLS are compiled in).
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /src/target/release/done-server /done-server
ENV DONE_MODE=cloud
ENTRYPOINT ["/done-server"]
