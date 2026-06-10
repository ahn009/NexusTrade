-- packages/database/src/migrations/1717900000000-initial-schema.sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('PENDING_EMAIL', 'ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE account_tier AS ENUM ('RETAIL', 'VIP_1', 'VIP_2', 'INSTITUTIONAL');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT', 'IOC', 'FOK', 'POST_ONLY');
CREATE TYPE order_status AS ENUM ('NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'TRIGGERED');
CREATE TYPE wallet_type AS ENUM ('HOT', 'WARM', 'COLD', 'USER');
CREATE TYPE tx_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED');
CREATE TYPE tx_type AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_SETTLEMENT', 'INTERNAL_TRANSFER', 'FEE');
CREATE TYPE kyc_status AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'ENHANCED_DUE_DILIGENCE');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status user_status NOT NULL DEFAULT 'PENDING_EMAIL',
  kyc_level int NOT NULL DEFAULT 0,
  account_tier account_tier NOT NULL DEFAULT 'RETAIL',
  referral_code varchar(32) NOT NULL UNIQUE,
  totp_secret text,
  webauthn_credentials jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  first_name varchar(120) NOT NULL,
  last_name varchar(120) NOT NULL,
  country varchar(2) NOT NULL,
  date_of_birth date,
  phone_number varchar(40)
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  account_type varchar(16) NOT NULL,
  tier account_tier NOT NULL DEFAULT 'RETAIL',
  is_frozen boolean NOT NULL DEFAULT false
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol varchar(24) NOT NULL,
  side order_side NOT NULL,
  type order_type NOT NULL,
  price numeric(38,18),
  stop_price numeric(38,18),
  quantity numeric(38,18) NOT NULL CHECK (quantity > 0),
  filled_quantity numeric(38,18) NOT NULL DEFAULT 0,
  status order_status NOT NULL DEFAULT 'NEW',
  client_order_id varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol varchar(24) NOT NULL,
  maker_order_id uuid NOT NULL,
  taker_order_id uuid NOT NULL,
  maker_user_id uuid NOT NULL,
  taker_user_id uuid NOT NULL,
  price numeric(38,18) NOT NULL,
  quantity numeric(38,18) NOT NULL,
  fee_asset varchar(16) NOT NULL,
  maker_fee numeric(38,18) NOT NULL,
  taker_fee numeric(38,18) NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset varchar(16) NOT NULL,
  wallet_type wallet_type NOT NULL DEFAULT 'USER',
  available numeric(38,18) NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked numeric(38,18) NOT NULL DEFAULT 0 CHECK (locked >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset, wallet_type)
);

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset varchar(16) NOT NULL,
  type tx_type NOT NULL,
  status tx_status NOT NULL,
  amount numeric(38,18) NOT NULL,
  balance_after numeric(38,18) NOT NULL,
  reference_id varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  level int NOT NULL,
  status kyc_status NOT NULL,
  provider varchar(80) NOT NULL,
  risk_score int NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  reviewed_by uuid,
  encrypted_payload bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset varchar(16) NOT NULL,
  network varchar(32) NOT NULL,
  address varchar(180) NOT NULL,
  tx_hash varchar(180),
  amount numeric(38,18) NOT NULL DEFAULT 0,
  confirmations int NOT NULL DEFAULT 0,
  required_confirmations int NOT NULL,
  status tx_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  asset varchar(16) NOT NULL,
  network varchar(32) NOT NULL,
  address varchar(180) NOT NULL,
  amount numeric(38,18) NOT NULL,
  fee numeric(38,18) NOT NULL,
  approval_tier varchar(24) NOT NULL,
  status tx_status NOT NULL,
  tx_hash varchar(180),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id varchar(120) NOT NULL,
  action varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL,
  device_fingerprint varchar(180),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_symbol_status_created_idx ON orders(symbol, status, created_at);
CREATE INDEX orders_user_created_idx ON orders(user_id, created_at);
CREATE INDEX orders_client_order_id_idx ON orders(client_order_id);
CREATE INDEX trades_symbol_executed_idx ON trades(symbol, executed_at);
CREATE INDEX user_profiles_user_id_idx ON user_profiles(user_id);
CREATE INDEX accounts_user_id_idx ON accounts(user_id);
CREATE INDEX ledger_user_created_idx ON ledger_transactions(user_id, created_at);
CREATE INDEX deposits_user_created_idx ON deposits(user_id, created_at);
CREATE INDEX deposits_tx_hash_idx ON deposits(tx_hash);
CREATE INDEX withdrawals_user_created_idx ON withdrawals(user_id, created_at);
CREATE INDEX audit_aggregate_created_idx ON audit_logs(aggregate_id, created_at);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
