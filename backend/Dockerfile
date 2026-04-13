FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git gcc musl-dev

WORKDIR /app
COPY go.mod ./
# Generate go.sum and download dependencies at build time
RUN go mod tidy && go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o openproxy ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wireguard-tools

WORKDIR /app
COPY --from=builder /app/openproxy .
COPY migrations/ ./migrations/

EXPOSE 8080
ENTRYPOINT ["./openproxy"]
