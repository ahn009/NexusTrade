// scripts/dev-all.mjs
import { spawn } from 'node:child_process';

const services = [
  '@nexus/auth-service',
  '@nexus/user-service',
  '@nexus/trading-service',
  '@nexus/wallet-service',
  '@nexus/market-data-service',
  '@nexus/risk-engine',
  '@nexus/deposit-service',
  '@nexus/withdrawal-service',
  '@nexus/compliance-service',
  '@nexus/notification-service',
  '@nexus/api-gateway'
];

const children = services.map((workspace) => {
  const child = spawn('npm', ['run', 'start:dev', '-w', workspace], {
    stdio: 'inherit',
    env: { ...process.env }
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`${workspace} exited with code ${code ?? signal}`);
    }
  });
  return child;
});

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
