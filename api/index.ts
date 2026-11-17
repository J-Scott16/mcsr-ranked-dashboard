import app from '../server/src/app';
import { initDb } from '../server/src/db';

let dbReady: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  if (!dbReady) {
    dbReady = initDb();
  }
  await dbReady;
  return (app as any)(req, res);
}
