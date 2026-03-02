import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'crypto';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const vendors = [
  { teamMemberId: 1, name: 'Matheus Zimmer - Chrome Extension' },
  { teamMemberId: 2, name: 'Sirlei Fritz - Chrome Extension' },
];

console.log('=== Criando chaves API para vendedores ===\n');

for (const vendor of vendors) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  await conn.execute(
    'INSERT INTO vendorApiKeys (teamMemberId, apiKey, name, active, createdAt) VALUES (?, ?, ?, 1, NOW())',
    [vendor.teamMemberId, apiKey, vendor.name]
  );
  console.log(`✅ ${vendor.name}`);
  console.log(`   Team Member ID: ${vendor.teamMemberId}`);
  console.log(`   API Key: ${apiKey}`);
  console.log('');
}

console.log('⚠️  IMPORTANTE: Anote as chaves acima! Elas não serão exibidas novamente.');

await conn.end();
