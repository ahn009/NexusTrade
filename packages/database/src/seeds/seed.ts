// packages/database/src/seeds/seed.ts
export const currencies = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'MATIC', 'DOT', 'LINK'];

export const tradingPairs = [
  'BTC-USDT',
  'ETH-USDT',
  'SOL-USDT',
  'BNB-USDT',
  'XRP-USDT',
  'ADA-USDT',
  'DOGE-USDT',
  'MATIC-USDT',
  'DOT-USDT',
  'LINK-USDT',
  'BTC-USDC',
  'ETH-USDC',
  'SOL-USDC',
  'BNB-BTC',
  'ETH-BTC',
  'SOL-BTC',
  'ADA-BTC',
  'XRP-BTC',
  'LINK-ETH',
  'DOT-ETH'
];

export const feeSchedules = [
  { tier: 'RETAIL', makerBps: '10', takerBps: '10' },
  { tier: 'VIP_1', makerBps: '8', takerBps: '9' },
  { tier: 'VIP_2', makerBps: '6', takerBps: '8' },
  { tier: 'INSTITUTIONAL', makerBps: '2', takerBps: '5' }
];

export const sampleUsers = [
  { email: 'retail@nexustrade.local', kycLevel: 1, accountTier: 'RETAIL' },
  { email: 'vip@nexustrade.local', kycLevel: 3, accountTier: 'VIP_2' },
  { email: 'institution@nexustrade.local', kycLevel: 4, accountTier: 'INSTITUTIONAL' }
];

if (require.main === module) {
  console.log(JSON.stringify({ currencies, tradingPairs, feeSchedules, sampleUsers }, null, 2));
}
