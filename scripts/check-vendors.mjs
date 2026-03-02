import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [members] = await conn.execute('SELECT id, name, email, cargo FROM teamMembers ORDER BY id');
console.log('=== Team Members ===');
console.table(members);

const [keys] = await conn.execute('SELECT id, teamMemberId, name, CONCAT(LEFT(apiKey, 8), "...") as keyPreview, active, lastUsedAt, createdAt FROM vendorApiKeys ORDER BY id');
console.log('\n=== Vendor API Keys ===');
console.table(keys);

await conn.end();
