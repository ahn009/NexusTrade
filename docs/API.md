# docs/API.md

## REST

All REST APIs are versioned under `/api/v3` at the API gateway.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v3/account` | JWT or HMAC | Account profile and balance entry point |
| POST | `/orders` | JWT or HMAC trade permission | Place order through trading service |
| DELETE | `/orders/:orderId` | JWT or HMAC trade permission | Cancel open order |
| GET | `/klines/:symbol` | Public | OHLCV candles |
| GET | `/ticker/:symbol` | Public | 24 hour ticker |
| GET | `/depth/:symbol` | Public | Order book depth |
| POST | `/withdrawals` | JWT, 2FA | Create withdrawal request |

## WebSocket

- `/market`: public streams for trades, depth, klines, tickers.
- `/user-stream`: authenticated user order and balance updates.

## gRPC

`MatchingEngine` exposes `SubmitOrder`, `CancelOrder`, `GetOrderBook`, and `GetOrderStatus`. Proto files live in `packages/shared/src/proto/matching.proto` and `services/matching-engine/proto/matching.proto`.

## Event Envelope

Every Kafka event has:

- `eventId`
- `eventType`
- `timestamp`
- `aggregateId`
- `payload`
- `metadata`
