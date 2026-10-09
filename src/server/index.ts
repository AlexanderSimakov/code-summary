import { createReviewServer } from './http.js';
const port = Number(process.env.PORT ?? 4310);
createReviewServer().listen(port, '127.0.0.1', () => console.log(`Code Summary server: http://127.0.0.1:${port}`));
