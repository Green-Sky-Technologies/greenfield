import { runMigrations } from './admin';

await runMigrations(
  process.env.DATABASE_URL ?? 'postgres://greenfield:greenfield@localhost:5433/greenfield',
);
console.log('migrations applied');
