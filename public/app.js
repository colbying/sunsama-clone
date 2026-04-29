async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthenticated'); }
  return r.json();
}

const api = {
  me:          ()              => jfetch('/api/me'),
  logout:      ()              => fetch('/auth/logout', { method:'POST' }),
  channels:    ()              => jfetch('/api/channels'),
  addChannel:  (body)          => fetch('/api/channels', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  delChannel:  (id)            => fetch('/api/channels/' + id, { method:'DELETE' }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  tasks:       (q='')          => fetch('/api/tasks' + (q ? '?' + q : '')).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  range:       (start,end)     => fetch(`/api/tasks/range?start=${start}&end=${end}`).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  addTask:     (body)          => fetch('/api/tasks', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  patchTask:   (id, body)      => fetch('/api/tasks/' + id, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  delTask:     (id)            => fetch('/api/tasks/' + id, { method:'DELETE' }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  reorder:     (ids,date)      => fetch('/api/tasks/reorder', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ids, plannedDate: date }) }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  rollover:    (from,to)       => fetch('/api/tasks/rollover', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from, to }) }).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
  dayStats:    (date)          => fetch('/api/stats/day?date=' + date).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('unauth'); } return r.json(); }),
};

const state = {
  view: 'today',
  date: ymd(new Date()),
  channels: [],
  channelsById: new Map(),
  tasks: [],
};

function ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function parseYmd(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function fmtLong(s) {
  const d = parseYmd(s);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtShort(s) {
  const d = parseYmd(s);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
function isToday(s) { return s === ymd(new Date()); }

async function refreshChannels() {
  state.channels = await api.channels();
  state.channelsById = new Map(state.channels.map(c => [c.id, c]));
  renderChannels();
  renderChannelSelects();
}

function renderChannels() {
  const ul = document.getElementById('channels');
  ul.innerHTML = '';
  for (const c of state.channels) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${c.color}"></span><span class="name">${escapeHtml(c.name)}</span><button class="del" title="Remove">×</button>`;
    li.querySelector('.del').onclick = async () => {
      if (!confirm(`Delete channel "${c.name}"?`)) return;
      await api.delChannel(c.id);
      await refreshChannels();
      await refreshCurrentView();
    };
    ul.appendChild(li);
  }
}

function renderChannelSelects() {
  for (const id of ['qa-channel','bl-channel','m-channel']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = '<option value="">No channel</option>' +
      state.channels.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---- Day View ----
async function renderDay() {
  document.getElementById('date-title').textContent =
    isToday(state.date) ? `Today · ${fmtLong(state.date)}` : fmtLong(state.date);
  const list = await api.tasks('date=' + state.date);
  state.tasks = list;
  const ul = document.getElementById('task-list');
  ul.innerHTML = '';
  for (const t of list) ul.appendChild(taskNode(t));
  document.getElementById('empty').style.display = list.length ? 'none' : 'block';
  const stats = await api.dayStats(state.date);
  const remaining = Math.max(0, stats.estimated - stats.actual);
  document.getElementById('day-stats').innerHTML =
    `<strong>${stats.done}</strong>/${stats.total} done · <strong>${stats.estimated}m</strong> planned · ${remaining}m remaining`;
}

function taskNode(t) {
  const li = document.createElement('li');
  li.className = 'task' + (t.completed ? ' completed' : '');
  li.draggable = true;
  li.dataset.id = t.id;
  const ch = t.channelId && state.channelsById.get(t.channelId);
  li.innerHTML = `
    <button class="check" title="Toggle complete"></button>
    <div class="title"></div>
    <div class="meta">
      ${ch ? `<span class="pill"><span class="dot" style="background:${ch.color}"></span>${escapeHtml(ch.name)}</span>` : ''}
      ${t.estimatedMinutes ? `<span class="est">${t.estimatedMinutes}m</span>` : ''}
    </div>
    <div></div>
  `;
  li.querySelector('.title').textContent = t.title;
  li.querySelector('.check').onclick = async (e) => {
    e.stopPropagation();
    await api.patchTask(t.id, { completed: !t.completed });
    await refreshCurrentView();
  };
  li.querySelector('.title').onclick = () => openModal(t);
  attachDrag(li);
  return li;
}

// ---- Drag & Drop ----
function attachDrag(li) {
  li.addEventListener('dragstart', (e) => {
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.task.dragging');
    if (!dragging || dragging === li) return;
    const rect = li.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    li.parentNode.insertBefore(dragging, after ? li.nextSibling : li);
  });
  li.addEventListener('drop', async () => {
    const ul = li.parentNode;
    const ids = [...ul.querySelectorAll('.task')].map(n => n.dataset.id);
    const date = ul.id === 'backlog-list' ? null : state.date;
    await api.reorder(ids, date);
  });
}

// ---- Backlog ----
async function renderBacklog() {
  const list = await api.tasks('backlog=1');
  const ul = document.getElementById('backlog-list');
  ul.innerHTML = '';
  for (const t of list) ul.appendChild(taskNode(t));
}

// ---- Week ----
async function renderWeek() {
  document.getElementById('date-title').textContent = 'This Week';
  document.getElementById('day-stats').textContent = '';
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const start = ymd(monday);
  const end = addDays(start, 6);
  const list = await api.range(start, end);
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const byDate = new Map();
  for (const t of list) {
    if (!byDate.has(t.plannedDate)) byDate.set(t.plannedDate, []);
    byDate.get(t.plannedDate).push(t);
  }
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const items = byDate.get(d) || [];
    const cell = document.createElement('div');
    cell.className = 'week-day' + (isToday(d) ? ' today' : '');
    cell.innerHTML = `<h3><span>${fmtShort(d)}</span><span class="num">${parseYmd(d).getDate()}</span></h3><ul></ul>`;
    cell.onclick = (e) => {
      if (e.target.closest('li')) return;
      state.date = d; setView('today');
    };
    const ul = cell.querySelector('ul');
    for (const t of items) {
      const ch = t.channelId && state.channelsById.get(t.channelId);
      const li = document.createElement('li');
      if (t.completed) li.classList.add('completed');
      li.innerHTML = `${ch ? `<span class="dot" style="background:${ch.color};width:6px;height:6px;border-radius:50%"></span>` : ''}<span>${escapeHtml(t.title)}</span>`;
      li.onclick = () => openModal(t);
      ul.appendChild(li);
    }
    grid.appendChild(cell);
  }
}

// ---- Modal ----
let editing = null;
function openModal(t) {
  editing = t;
  document.getElementById('m-title').value = t.title;
  document.getElementById('m-channel').value = t.channelId || '';
  document.getElementById('m-date').value = t.plannedDate || '';
  document.getElementById('m-estimate').value = t.estimatedMinutes || 0;
  document.getElementById('m-actual').value = t.actualMinutes || 0;
  document.getElementById('m-notes').value = t.notes || '';
  renderSubtasks(t.subtasks || []);
  document.getElementById('task-modal').classList.remove('hidden');
}
function closeModal() {
  editing = null;
  document.getElementById('task-modal').classList.add('hidden');
}
function renderSubtasks(subs) {
  const ul = document.getElementById('m-subtasks');
  ul.innerHTML = '';
  subs.forEach((s, i) => {
    const li = document.createElement('li');
    if (s.done) li.classList.add('done');
    li.innerHTML = `<input type="checkbox" ${s.done ? 'checked' : ''}/><span></span><button class="x" title="Remove">×</button>`;
    li.querySelector('span').textContent = s.title;
    li.querySelector('input').onchange = () => { subs[i].done = !subs[i].done; renderSubtasks(subs); };
    li.querySelector('.x').onclick = () => { subs.splice(i,1); renderSubtasks(subs); };
    ul.appendChild(li);
  });
  editing && (editing.subtasks = subs);
}

document.getElementById('m-add-sub').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = document.getElementById('m-sub-input');
  const v = inp.value.trim();
  if (!v || !editing) return;
  const subs = editing.subtasks || [];
  subs.push({ title: v, done: false });
  renderSubtasks(subs);
  inp.value = '';
});

document.getElementById('m-close').onclick = closeModal;
document.getElementById('m-clear-date').onclick = () => { document.getElementById('m-date').value = ''; };
document.getElementById('m-delete').onclick = async () => {
  if (!editing) return;
  if (!confirm('Delete this task?')) return;
  await api.delTask(editing.id);
  closeModal();
  await refreshCurrentView();
};
document.getElementById('m-save').onclick = async () => {
  if (!editing) return;
  const body = {
    title: document.getElementById('m-title').value.trim() || editing.title,
    channelId: document.getElementById('m-channel').value || null,
    plannedDate: document.getElementById('m-date').value || null,
    estimatedMinutes: Number(document.getElementById('m-estimate').value) || 0,
    actualMinutes: Number(document.getElementById('m-actual').value) || 0,
    notes: document.getElementById('m-notes').value,
    subtasks: editing.subtasks || [],
  };
  await api.patchTask(editing.id, body);
  closeModal();
  await refreshCurrentView();
};
document.getElementById('task-modal').addEventListener('click', (e) => {
  if (e.target.id === 'task-modal') closeModal();
});

// ---- Quick add ----
document.getElementById('quick-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('qa-title').value.trim();
  if (!title) return;
  const channelId = document.getElementById('qa-channel').value || null;
  const estimatedMinutes = Number(document.getElementById('qa-mins').value) || 0;
  await api.addTask({ title, channelId, plannedDate: state.date, estimatedMinutes });
  document.getElementById('qa-title').value = '';
  document.getElementById('qa-mins').value = '';
  await renderDay();
});

document.getElementById('backlog-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('bl-title').value.trim();
  if (!title) return;
  const channelId = document.getElementById('bl-channel').value || null;
  await api.addTask({ title, channelId, plannedDate: null });
  document.getElementById('bl-title').value = '';
  await renderBacklog();
});

// ---- Date nav ----
document.getElementById('prev-day').onclick = async () => { state.date = addDays(state.date, -1); await renderDay(); };
document.getElementById('next-day').onclick = async () => { state.date = addDays(state.date,  1); await renderDay(); };
document.getElementById('today-btn').onclick = async () => { state.date = ymd(new Date()); await renderDay(); };

// ---- Channel add ----
document.getElementById('add-channel-btn').onclick = async () => {
  const name = prompt('Channel name?');
  if (!name) return;
  const palette = ['#7c5cff','#ff8a3d','#2bb673','#3b82f6','#ec4899','#f59e0b','#06b6d4'];
  const color = palette[Math.floor(Math.random() * palette.length)];
  await api.addChannel({ name: name.trim(), color });
  await refreshChannels();
};

// ---- Rollover ----
document.getElementById('rollover-btn').onclick = async () => {
  const today = ymd(new Date());
  const r = await api.rollover(addDays(today, -30), today);
  alert(`Moved ${r.moved} task(s) to today.`);
  await refreshCurrentView();
};

// ---- View routing ----
function setView(view) {
  state.view = view;
  for (const b of document.querySelectorAll('.nav-item')) b.classList.toggle('active', b.dataset.view === view);
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
  if (view === 'today') {
    document.getElementById('day-view').classList.add('active');
    renderDay();
  } else if (view === 'week') {
    document.getElementById('week-view').classList.add('active');
    renderWeek();
  } else if (view === 'backlog') {
    document.getElementById('backlog-view').classList.add('active');
    document.getElementById('date-title').textContent = 'Backlog';
    document.getElementById('day-stats').textContent = '';
    renderBacklog();
  }
}
for (const b of document.querySelectorAll('.nav-item')) b.onclick = () => setView(b.dataset.view);

async function refreshCurrentView() {
  if (state.view === 'today') await renderDay();
  else if (state.view === 'week') await renderWeek();
  else if (state.view === 'backlog') await renderBacklog();
}

// ---- User chip ----
async function renderUser() {
  try {
    const u = await api.me();
    document.getElementById('u-name').textContent = u.name || u.email || 'You';
    document.getElementById('u-email').textContent = u.email || '';
    const pic = document.getElementById('u-pic');
    if (u.picture) pic.src = u.picture; else pic.style.display = 'none';
  } catch { /* redirected to /login */ }
}
document.getElementById('logout-btn').onclick = async () => {
  await api.logout();
  location.href = '/login';
};

// ---- Init ----
(async () => {
  await renderUser();
  await refreshChannels();
  setView('today');
})();
