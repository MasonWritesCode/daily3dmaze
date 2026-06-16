FROM golang:1.26-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/daily3dmaze-api ./cmd/api

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata wget

WORKDIR /app

COPY --from=builder /out/daily3dmaze-api /app/daily3dmaze-api

USER nobody:nobody

EXPOSE 8080

ENTRYPOINT ["/app/daily3dmaze-api"]
