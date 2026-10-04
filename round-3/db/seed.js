// npm run seed
// Idempotent: safe to run more than once. Creates one admin, two normal
// users, and a handful of pins so frontend/tester have data to work against.
const bcrypt = require('bcryptjs');
const db = require('./connection');

const SALT_ROUNDS = 12;

function upsertUser(email, password, role) {
  const normalized = email.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
    .run(normalized, hash, role);
  return info.lastInsertRowid;
}

function seedPinsIfNone(userId, pins) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM pins WHERE user_id = ?').get(userId).n;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO pins (user_id, place_name, latitude, longitude, visited_on, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const pin of pins) {
    insert.run(userId, pin.place_name, pin.latitude, pin.longitude, pin.visited_on, pin.note ?? null);
  }
}

const adminId = upsertUser('admin@waypoint.test', 'AdminPass123!', 'admin');
const aliceId = upsertUser('alice@waypoint.test', 'AlicePass123!', 'user');
const bobId = upsertUser('bob@waypoint.test', 'BobPass123!', 'user');

seedPinsIfNone(aliceId, [
  { place_name: 'Kyoto, Japan', latitude: 35.0116, longitude: 135.7681, visited_on: '2024-04-02', note: "Cherry blossoms along the Philosopher's Path." },
  { place_name: 'Reykjavik, Iceland', latitude: 64.1466, longitude: -21.9426, visited_on: '2023-09-15', note: 'Saw the northern lights.' },
  { place_name: 'Lisbon, Portugal', latitude: 38.7223, longitude: -9.1393, visited_on: '2025-06-01', note: null },
]);

seedPinsIfNone(bobId, [
  { place_name: 'Cape Town, South Africa', latitude: -33.9249, longitude: 18.4241, visited_on: '2022-11-20', note: 'Table Mountain hike.' },
  { place_name: 'Banff, Canada', latitude: 51.1784, longitude: -115.5708, visited_on: '2024-08-10', note: 'Lake Louise was frozen turquoise.' },
]);

console.log('Seed complete.\n');
console.log('  admin  admin@waypoint.test / AdminPass123!  (role: admin)');
console.log('  user   alice@waypoint.test / AlicePass123!  (role: user, 3 pins)');
console.log('  user   bob@waypoint.test   / BobPass123!    (role: user, 2 pins)');
console.log(`\nUser ids -> admin: ${adminId}, alice: ${aliceId}, bob: ${bobId}`);
