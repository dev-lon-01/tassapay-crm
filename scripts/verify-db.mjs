import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [[{ total }]] = await conn.execute('SELECT COUNT(*) AS total FROM customers');
console.log(`\nTotal customers in DB: ${total}`);

const [sample] = await conn.execute(
  'SELECT customer_id, full_name, email, phone_number, country, registration_date, kyc_completion_date, risk_status FROM customers LIMIT 3'
);
console.log('\nSample records:');
console.table(sample);

const [riskBreakdown] = await conn.execute(
  'SELECT risk_status, COUNT(*) AS count FROM customers GROUP BY risk_status ORDER BY count DESC LIMIT 5'
);
console.log('Risk breakdown:');
console.table(riskBreakdown);

const [[{ null_kyc }]] = await conn.execute(
  'SELECT COUNT(*) AS null_kyc FROM customers WHERE kyc_completion_date IS NULL'
);
console.log(`Customers with no KYC date (NULL): ${null_kyc}`);

await conn.end();
