import app from '../../api/app';
import { initDb } from '../../api/db';


async function start() {
  await initDb();
  app.listen(3001, () => {
    console.log('Server running on http://localhost:3001');
  });
}

start();
