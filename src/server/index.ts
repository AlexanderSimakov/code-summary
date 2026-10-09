import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
import { createReviewServer } from './http.js';
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4310);
createReviewServer().listen(port, '127.0.0.1', () => console.log(`Code Summary server: http://127.0.0.1:${port}`));
