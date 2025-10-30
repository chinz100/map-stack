import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const repoRoot = resolve(process.cwd(), '../../');

config({ path: resolve(repoRoot, '.env'), override: false });

const port = process.env.WEB_PORT || '3000';
process.env.PORT = port;
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const startProcess = spawn('next', ['start', '--port', port], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

startProcess.on('exit', code => {
  process.exit(code ?? 0);
});
