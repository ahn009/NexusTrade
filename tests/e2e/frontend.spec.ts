// tests/e2e/frontend.spec.ts
import { expect, test } from '@playwright/test';

const routes = [
  ['/dashboard', 'Dashboard'],
  ['/users', 'Users'],
  ['/trading', 'Trading'],
  ['/wallets', 'Wallets'],
  ['/deposits', 'Deposits'],
  ['/withdrawals', 'Withdrawals'],
  ['/risk', 'Risk'],
  ['/compliance', 'Compliance'],
  ['/settings', 'Settings']
] as const;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v3/health', async (route) => {
    await route.fulfill({ json: { status: 'ok', service: 'api-gateway' } });
  });
  await page.route('**/api/v3/ticker/24hr?symbol=BTC-USDT', async (route) => {
    await route.fulfill({ json: { symbol: 'BTC-USDT', lastPrice: '100.00', volume: '12.5' } });
  });
  await page.route('**/api/v3/depth?symbol=BTCUSDT', async (route) => {
    await route.fulfill({ json: { symbol: 'BTC-USDT', bids: [['99', '1']], asks: [['101', '2']] } });
  });
  await page.route('**/api/v3/account?userId=demo-user', async (route) => {
    await route.fulfill({ json: [{ asset: 'USDT', available: '1000', locked: '0' }] });
  });
  await page.route('**/api/v3/exchangeInfo', async (route) => {
    await route.fulfill({ json: { symbols: ['BTC-USDT', 'ETH-USDT'] } });
  });
});

test('root redirects to dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

for (const [path, heading] of routes) {
  test(`${path} renders without browser errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('login stores tokens and navigates to dashboard', async ({ page }) => {
  await page.route('**/api/v3/auth/login', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ email: 'operator@nexustrade.local', password: 'super-secret-password' });
    await route.fulfill({ json: { accessToken: 'access-token', refreshToken: 'refresh-token', sessionId: 'session-1' } });
  });

  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('operator@nexustrade.local');
  await page.getByPlaceholder('Password').fill('super-secret-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('accessToken'))).toBe('access-token');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('refreshToken'))).toBe('refresh-token');
});

test('login displays API errors', async ({ page }) => {
  await page.route('**/api/v3/auth/login', async (route) => {
    await route.fulfill({ status: 401, json: { message: 'invalid credentials' } });
  });

  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('operator@nexustrade.local');
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('invalid credentials')).toBeVisible();
});

test('register submits to API and shows user id', async ({ page }) => {
  await page.route('**/api/v3/auth/register', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ email: 'new@nexustrade.local', password: 'super-secret-password' });
    await route.fulfill({ json: { userId: 'user-123' } });
  });

  await page.goto('/register');
  await page.getByPlaceholder('Email').fill('new@nexustrade.local');
  await page.getByPlaceholder('Password').fill('super-secret-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Registered user-123')).toBeVisible();
});
