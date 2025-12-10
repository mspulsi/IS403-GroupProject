require('dotenv').config();
const knex = require('knex');

// Centralized database connection using Knex + PostgreSQL
const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  },
  pool: { min: 0, max: 10 },
});

module.exports = db;

