/* eslint-disable n/no-process-env */

import path from 'path';
import dotenv from 'dotenv';
import moduleAlias from 'module-alias';


// Check the env
const NODE_ENV = (process.env.NODE_ENV ?? 'development');

// Configure "dotenv" (prefer repo-level .env, fallback to legacy config path)
const envCandidates = [
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, `./config/.env.${NODE_ENV}`),
];

let envLoaded = false;
let lastError: Error | undefined;

for (const candidate of envCandidates) {
  const result = dotenv.config({ path: candidate });
  if (!result.error) {
    envLoaded = true;
    break;
  }
  lastError = result.error;
}

if (!envLoaded && lastError) {
  throw lastError;
}

// Default port when none is provided
if (!process.env.PORT) {
  process.env.PORT = '4000';
}

// Configure moduleAlias
if (__filename.endsWith('js')) {
  moduleAlias.addAlias('@src', __dirname + '/dist');
}
