const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'sunsama';

const client = new MongoClient(MONGODB_URI);
let users, tasks;

async function initDb() {
  await client.connect();
  const db = client.db(DB_NAME);
  users = db.collection('users');
  tasks = db.collection('tasks');

  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    users.createIndex({ email: 1 }, { unique: true }),
    tasks.createIndex({ user_id: 1, scheduled_date: 1, sort_order: 1 })
  ]);
  console.log(`Connected to MongoDB (${DB_NAME})`);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    dbName: DB_NAME,
    collectionName: 'sessions',
    ttl: 60 * 60 * 24 * 30
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function asObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

function publicUser(doc) {
  return { id: doc._id.toString(), username: doc.username, email: doc.email };
}

function publicTask(doc) {
  return {
    id: doc._id.toString(),
    user_id: doc.user_id.toString(),
    title: doc.title,
    notes: doc.notes || '',
    scheduled_date: doc.scheduled_date,
    estimated_minutes: doc.estimated_minutes || 0,
    actual_minutes: doc.actual_minutes || 0,
    completed: doc.completed ? 1 : 0,
    completed_at: doc.completed_at || null,
    sort_order: doc.sort_order || 0,
    channel: doc.channel || '',
    created_at: doc.created_at
  };
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password are required' });
    }
    if (username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 chars, alphanumeric/._-' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid email' });
    if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

    const hash = bcrypt.hashSync(password, 10);
    const doc = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password_hash: hash,
      created_at: new Date().toISOString()
    };
    const result = await users.insertOne(doc);
    doc._id = result.insertedId;
    req.session.userId = doc._id.toString();
    res.json({ user: publicUser(doc) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'username or email already in use' });
    }
    console.error(err);
    res.status(500).json({ error: 'signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'identifier and password are required' });
    }
    const id = identifier.trim();
    const user = await users.findOne({
      $or: [{ username: id }, { email: id.toLowerCase() }]
    });
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    req.session.userId = user._id.toString();
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const oid = asObjectId(req.session.userId);
  if (!oid) return res.json({ user: null });
  const user = await users.findOne({ _id: oid });
  res.json({ user: user ? publicUser(user) : null });
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  const userOid = asObjectId(req.session.userId);
  const { date } = req.query;
  const filter = { user_id: userOid };
  if (date) filter.scheduled_date = date;
  const sort = date
    ? { completed: 1, sort_order: 1, _id: 1 }
    : { scheduled_date: -1, sort_order: 1, _id: 1 };
  const rows = await tasks.find(filter).sort(sort).toArray();
  res.json({ tasks: rows.map(publicTask) });
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  const { title, notes = '', scheduled_date, estimated_minutes = 0, channel = '' } = req.body || {};
  if (!title || !scheduled_date) {
    return res.status(400).json({ error: 'title and scheduled_date are required' });
  }
  const userOid = asObjectId(req.session.userId);
  const last = await tasks.find({ user_id: userOid, scheduled_date })
    .sort({ sort_order: -1 }).limit(1).toArray();
  const nextOrder = last.length ? (last[0].sort_order || 0) + 1 : 0;

  const doc = {
    user_id: userOid,
    title: title.trim(),
    notes,
    scheduled_date,
    estimated_minutes: Number(estimated_minutes) || 0,
    actual_minutes: 0,
    completed: false,
    completed_at: null,
    sort_order: nextOrder,
    channel,
    created_at: new Date().toISOString()
  };
  const result = await tasks.insertOne(doc);
  doc._id = result.insertedId;
  res.json({ task: publicTask(doc) });
});

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const oid = asObjectId(req.params.id);
  const userOid = asObjectId(req.session.userId);
  if (!oid) return res.status(400).json({ error: 'invalid id' });

  const allowed = ['title', 'notes', 'scheduled_date', 'estimated_minutes', 'actual_minutes', 'completed', 'channel', 'sort_order'];
  const update = {};
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
      update[f] = f === 'completed' ? Boolean(req.body[f]) : req.body[f];
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'completed')) {
    update.completed_at = req.body.completed ? new Date().toISOString() : null;
  }
  const result = await tasks.findOneAndUpdate(
    { _id: oid, user_id: userOid },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json({ task: publicTask(result) });
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  const oid = asObjectId(req.params.id);
  const userOid = asObjectId(req.session.userId);
  if (!oid) return res.status(400).json({ error: 'invalid id' });
  const result = await tasks.deleteOne({ _id: oid, user_id: userOid });
  if (!result.deletedCount) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.post('/api/tasks/reorder', requireAuth, async (req, res) => {
  const { date, order } = req.body || {};
  if (!date || !Array.isArray(order)) {
    return res.status(400).json({ error: 'date and order[] required' });
  }
  const userOid = asObjectId(req.session.userId);
  const ops = order.map((id, i) => {
    const taskOid = asObjectId(id);
    if (!taskOid) return null;
    return {
      updateOne: {
        filter: { _id: taskOid, user_id: userOid, scheduled_date: date },
        update: { $set: { sort_order: i } }
      }
    };
  }).filter(Boolean);
  if (ops.length) await tasks.bulkWrite(ops);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/move', requireAuth, async (req, res) => {
  const oid = asObjectId(req.params.id);
  const userOid = asObjectId(req.session.userId);
  if (!oid) return res.status(400).json({ error: 'invalid id' });
  const { scheduled_date } = req.body || {};
  if (!scheduled_date) return res.status(400).json({ error: 'scheduled_date required' });

  const last = await tasks.find({ user_id: userOid, scheduled_date })
    .sort({ sort_order: -1 }).limit(1).toArray();
  const nextOrder = last.length ? (last[0].sort_order || 0) + 1 : 0;

  const result = await tasks.findOneAndUpdate(
    { _id: oid, user_id: userOid },
    { $set: { scheduled_date, sort_order: nextOrder } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json({ task: publicTask(result) });
});

app.get('/api/stats', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const userOid = asObjectId(req.session.userId);
  const [agg] = await tasks.aggregate([
    { $match: { user_id: userOid, scheduled_date: date } },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      done: { $sum: { $cond: ['$completed', 1, 0] } },
      est: { $sum: { $ifNull: ['$estimated_minutes', 0] } },
      act: { $sum: { $ifNull: ['$actual_minutes', 0] } }
    } }
  ]).toArray();
  res.json({
    stats: agg
      ? { total: agg.total, done: agg.done, est: agg.est, act: agg.act }
      : { total: 0, done: 0, est: 0, act: 0 }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Sunsama clone running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
