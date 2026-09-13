const { spawnSync } = require('child_process');
const path = require('path');

console.log('⚡ Delegating database seed to prisma/seed.ts...');
const rootDir = path.resolve(__dirname, '../..');
const seedTsPath = path.resolve(rootDir, 'prisma/seed.ts');
const tsConfigPath = path.resolve(rootDir, 'server/tsconfig.json');

const res = spawnSync(
  'npx',
  ['ts-node', '--project', tsConfigPath, '--transpile-only', seedTsPath],
  {
    cwd: path.resolve(rootDir, 'server'),
    stdio: 'inherit',
    env: process.env,
  }
);

if (res.status !== 0) {
  process.exit(res.status || 1);
}
