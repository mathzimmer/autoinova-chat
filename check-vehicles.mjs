import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await createConnection(url);

const [cats] = await conn.execute('SELECT category, COUNT(*) as cnt FROM vehicles WHERE available = 1 GROUP BY category ORDER BY cnt DESC');
console.log('=== CATEGORIES ===');
console.table(cats);

const [trans] = await conn.execute('SELECT transmission, COUNT(*) as cnt FROM vehicles WHERE available = 1 GROUP BY transmission ORDER BY cnt DESC');
console.log('=== TRANSMISSIONS ===');
console.table(trans);

const [picapes] = await conn.execute("SELECT brand, model, category, transmission FROM vehicles WHERE available = 1 AND (model LIKE '%S10%' OR model LIKE '%Ranger%' OR model LIKE '%Hilux%' OR model LIKE '%Toro%' OR model LIKE '%Saveiro%' OR model LIKE '%Strada%' OR model LIKE '%L200%' OR model LIKE '%D-20%') LIMIT 20");
console.log('=== PICAPES/CAMIONETES ===');
console.table(picapes);

const [hatches] = await conn.execute("SELECT brand, model, category, transmission FROM vehicles WHERE available = 1 AND (model LIKE '%Gol%' OR model LIKE '%Onix%' OR model LIKE '%Ka%' OR model LIKE '%Palio%' OR model LIKE '%HB20%' OR model LIKE '%Fit%') LIMIT 20");
console.log('=== HATCHES ===');
console.table(hatches);

await conn.end();
