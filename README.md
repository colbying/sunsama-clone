# Sunsama Clone

A minimalist daily planner inspired by Sunsama, built with **Express + MongoDB** on the backend and a vanilla-JS SPA on the frontend.

## Features

- Day view with quick-add (title, channel, time estimate)
- Drag-to-reorder tasks within a day
- Channels (projects) with colors
- Backlog (tasks with no planned date)
- 7-day week view
- Task modal: notes, subtasks, estimate vs. actual minutes, reschedule
- One-click **rollover** of incomplete tasks from the past 30 days into today
- Day stats: planned vs. done vs. remaining minutes

## Stack

| Layer    | Tech                        |
| -------- | --------------------------- |
| Server   | Node 20+ ESM, Express 4     |
| DB       | MongoDB 6 (native driver)   |
| Frontend | Plain HTML / CSS / ES module JS |

## Run it

```bash
npm install

# point at any MongoDB — local, Docker, or Atlas
export MONGODB_URI="mongodb://localhost:27017"
export MONGODB_DB="sunsama"
export PORT=3000

npm start
```

Open <http://localhost:3000>.

### No MongoDB locally?

```bash
# quickest: docker
docker run -d --name mongo -p 27017:27017 mongo:7

# or Atlas — paste your SRV URI into MONGODB_URI
```

## Data model

```
channels { _id, name, color, createdAt }

tasks    { _id, title, notes, channelId,
           plannedDate (YYYY-MM-DD | null),
           estimatedMinutes, actualMinutes,
           completed, completedAt, order,
           subtasks: [{ title, done }],
           archived, createdAt }
```

Indexes: `{ plannedDate: 1, order: 1 }` on tasks, `{ name: 1 }` unique on channels.

## API

```
GET    /api/channels
POST   /api/channels                 { name, color }
DELETE /api/channels/:id

GET    /api/tasks?date=YYYY-MM-DD
GET    /api/tasks?backlog=1
GET    /api/tasks/range?start=...&end=...
POST   /api/tasks                    { title, channelId, plannedDate, estimatedMinutes, notes }
PATCH  /api/tasks/:id                { any field }
DELETE /api/tasks/:id
POST   /api/tasks/reorder            { ids: [...], plannedDate }
POST   /api/tasks/rollover           { from, to }

GET    /api/stats/day?date=YYYY-MM-DD
```

## Ideas to extend

- Auth (per-user task scoping)
- Timer / focus mode that increments `actualMinutes`
- Calendar (Google) ingestion → blocks on the day
- Weekly review screen with completion %
- Keyboard shortcuts (J/K nav, X complete, E edit)
- Markdown notes rendering
- WebSockets for multi-tab sync
