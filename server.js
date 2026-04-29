import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { MongoClient, ObjectId } from 'mongodb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'sunsama';
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('⚠  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google login will not work.');
  console.warn('   Create OAuth credentials: https://console.cloud.google.com/apis/credentials');
  console.warn(`   Authorized redirect URI: ${BASE_URL}/auth/google/callback`);
}
if (!process.env.SESSION_SECRET) {
  console.warn('⚠  SESSION_SECRET not set — using a random one. Sessions will not survive restarts.');
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(MONGODB_DB);
const tasks = db.collection('tasks');
const channels = db.collection('channels');
const users = db.collection('users');

await tasks.createIndex({ userId: 1, plannedDate: 1, order: 1 });
await tasks.createIndex({ userId: 1, archived: 1 });
await channels.createIndex({ userId: 1, name: 1 }, { unique: true });
await users.createIndex({ googleId: 1 }, { unique: true });
await users.createIndex({ email: 1 });

// ---------- Passport ----------
passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try {
    const u = await users.findOne({ _id: new ObjectId(id) });
    done(null, u || false);
  } catch (e) { done(e); }
});

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/google/callback`,
  }, async (_at, _rt, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || null;
      const picture = profile.photos?.[0]?.value || null;
      const now = new Date();
      const r = await users.findOneAndUpdate(
        { googleId: profile.id },
        {
          $set: { email, name: profile.displayName, picture, lastLoginAt: now },
          $setOnInsert: { googleId: profile.id, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' }
      );
      const user = r.value || await users.findOne({ googleId: profile.id });
      // Seed default channels on first login
      const count = await channels.countDocuments({ userId: user._id });
      if (count === 0) {
        await channels.insertMany([
          { userId: user._id, name: 'Personal',  color: '#7c5cff', createdAt: now },
          { userId: user._id, name: 'Work',      color: '#ff8a3d', createdAt: now },
          { userId: user._id, name: 'Deep Work', color: '#2bb673', createdAt: now },
        ]);
      }
      done(null, user);
    } catch (e) { done(e); }
  }));
}

// ---------- App ----------
const app = express();
app.use(express.json());
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({ client, dbName: MONGODB_DB, collectionName: 'sessions' }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: BASE_URL.startsWith('https://'),
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Serve static — but gate index.html on auth so unauth users land on /login
app.get('/', (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  next();
}, express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth routes ----------
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (_req, res) => res.redirect('/')
);

app.post('/auth/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => res.json({ ok: true }));
  });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not authenticated' });
  const u = req.user;
  res.json({ id: u._id.toString(), email: u.email, name: u.name, picture: u.picture });
});

// ---------- Auth gate for /api ----------
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not authenticated' });
  req.userId = req.user._id;
  next();
}
app.use('/api', (req, res, next) => {
  if (req.path === '/me') return next();
  return requireAuth(req, res, next);
});

const oid = (id) => { try { return new ObjectId(id); } catch { return null; } };

const serializeTask = (t) => ({
  id: t._id.toString(),
  title: t.title,
  notes: t.notes || '',
  channelId: t.channelId ? t.channelId.toString() : null,
  plannedDate: t.plannedDate || null,
  estimatedMinutes: t.estimatedMinutes || 0,
  actualMinutes: t.actualMinutes || 0,
  completed: !!t.completed,
  completedAt: t.completedAt || null,
  order: t.order ?? 0,
  subtasks: t.subtasks || [],
  createdAt: t.createdAt,
});

const serializeChannel = (c) => ({
  id: c._id.toString(),
  name: c.name,
  color: c.color,
});

// ---------- Channels ----------
app.get('/api/channels', async (req, res) => {
  const list = await channels.find({ userId: req.userId }).sort({ name: 1 }).toArray();
  res.json(list.map(serializeChannel));
});

app.post('/api/channels', async (req, res) => {
  const { name, color } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const doc = { userId: req.userId, name, color: color || '#7c5cff', createdAt: new Date() };
  try {
    const r = await channels.insertOne(doc);
    res.json(serializeChannel({ ...doc, _id: r.insertedId }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/channels/:id', async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  await channels.deleteOne({ _id: id, userId: req.userId });
  await tasks.updateMany({ userId: req.userId, channelId: id }, { $set: { channelId: null } });
  res.json({ ok: true });
});

// ---------- Tasks ----------
app.get('/api/tasks', async (req, res) => {
  const { date, backlog } = req.query;
  const q = { userId: req.userId, archived: { $ne: true } };
  if (backlog === '1') q.plannedDate = null;
  else if (date) q.plannedDate = date;
  const list = await tasks.find(q).sort({ order: 1, createdAt: 1 }).toArray();
  res.json(list.map(serializeTask));
});

app.get('/api/tasks/range', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });
  const list = await tasks
    .find({ userId: req.userId, archived: { $ne: true }, plannedDate: { $gte: start, $lte: end } })
    .sort({ plannedDate: 1, order: 1 })
    .toArray();
  res.json(list.map(serializeTask));
});

app.post('/api/tasks', async (req, res) => {
  const { title, channelId, plannedDate, estimatedMinutes, notes } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const last = await tasks
    .find({ userId: req.userId, plannedDate: plannedDate || null })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const order = (last[0]?.order ?? -1) + 1;
  const doc = {
    userId: req.userId,
    title: title.trim(),
    notes: notes || '',
    channelId: channelId ? oid(channelId) : null,
    plannedDate: plannedDate || null,
    estimatedMinutes: Number(estimatedMinutes) || 0,
    actualMinutes: 0,
    completed: false,
    completedAt: null,
    order,
    subtasks: [],
    archived: false,
    createdAt: new Date(),
  };
  const r = await tasks.insertOne(doc);
  res.json(serializeTask({ ...doc, _id: r.insertedId }));
});

app.patch('/api/tasks/:id', async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  const allowed = ['title','notes','plannedDate','estimatedMinutes','actualMinutes','order','subtasks'];
  const $set = {};
  for (const k of allowed) if (k in req.body) $set[k] = req.body[k];
  if ('channelId' in req.body) $set.channelId = req.body.channelId ? oid(req.body.channelId) : null;
  if ('completed' in req.body) {
    $set.completed = !!req.body.completed;
    $set.completedAt = req.body.completed ? new Date() : null;
  }
  const r = await tasks.findOneAndUpdate(
    { _id: id, userId: req.userId },
    { $set },
    { returnDocument: 'after' }
  );
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(serializeTask(r));
});

app.delete('/api/tasks/:id', async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  await tasks.deleteOne({ _id: id, userId: req.userId });
  res.json({ ok: true });
});

app.post('/api/tasks/reorder', async (req, res) => {
  const { ids, plannedDate } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const ops = ids.map((id, i) => {
    const _id = oid(id);
    if (!_id) return null;
    const $set = { order: i };
    if (plannedDate !== undefined) $set.plannedDate = plannedDate || null;
    return { updateOne: { filter: { _id, userId: req.userId }, update: { $set } } };
  }).filter(Boolean);
  if (ops.length) await tasks.bulkWrite(ops);
  res.json({ ok: true });
});

app.post('/api/tasks/rollover', async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const r = await tasks.updateMany(
    { userId: req.userId, plannedDate: { $lt: to, $gte: from }, completed: false, archived: { $ne: true } },
    { $set: { plannedDate: to } }
  );
  res.json({ moved: r.modifiedCount });
});

// ---------- Stats ----------
app.get('/api/stats/day', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const list = await tasks.find({ userId: req.userId, plannedDate: date, archived: { $ne: true } }).toArray();
  const total = list.length;
  const done = list.filter(t => t.completed).length;
  const estimated = list.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  const actual = list.reduce((s, t) => s + (t.actualMinutes || 0), 0);
  res.json({ total, done, estimated, actual });
});

app.listen(PORT, () => {
  console.log(`Sunsama clone running at ${BASE_URL}`);
  console.log(`MongoDB: ${MONGODB_URI} / db: ${MONGODB_DB}`);
});
