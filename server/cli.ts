// Admin commands: npm run backup | restore <file> | create-user <email> <password> [--admin]
import fs from 'node:fs';
import path from 'node:path';
import { createUser } from './auth.js';
import { createBackup, listBackups, restoreBackupFile } from './backup.js';
import { config } from './config.js';
import { db } from './db.js';

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'backup': {
    db();
    const b = createBackup('manual');
    console.log(`Wrote ${path.join(config.backupDir, b.name)} (${(b.size / 1024).toFixed(1)} KB)`);
    break;
  }
  case 'restore': {
    const target = args[0];
    if (!target) {
      console.log('Usage: npm run restore -- <backup file or name>\n\nAvailable backups:');
      for (const b of listBackups()) console.log(`  ${b.name}  ${(b.size / 1024).toFixed(1)} KB`);
      process.exit(1);
    }
    const file = fs.existsSync(target) ? target : path.join(config.backupDir, target);
    if (!fs.existsSync(file)) {
      console.error(`Not found: ${target}`);
      process.exit(1);
    }
    if (fs.existsSync(config.dbPath)) {
      db();
      const safety = createBackup('pre-restore');
      db().close();
      console.log(`Saved the current database first as ${safety.name}`);
    }
    restoreBackupFile(file);
    console.log(`Restored ${path.basename(file)}. Start the server again to use it.`);
    break;
  }
  case 'create-user': {
    const [email, password] = args;
    if (!email || !password) {
      console.log('Usage: npm run create-user -- <email> <password> [--admin]');
      process.exit(1);
    }
    db();
    const u = createUser({ email, password, name: '', isAdmin: args.includes('--admin') });
    console.log(`Created ${u.email}${u.isAdmin ? ' (admin)' : ''}`);
    break;
  }
  default:
    console.log('Commands: backup, restore <file>, create-user <email> <password> [--admin]');
    process.exit(cmd ? 1 : 0);
}
