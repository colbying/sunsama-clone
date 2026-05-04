(function () {
  const root = document.getElementById('app');
  let state = {
    user: null,
    date: todayISO(),
    tasks: [],
    stats: null,
    authMode: 'login',
    authError: '',
    loading: true
  };

  function todayISO(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function shiftDate(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return todayISO(dt);
  }

  function prettyDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const today = todayISO();
    const tomorrow = shiftDate(today, 1);
    const yesterday = shiftDate(today, -1);
    let prefix = '';
    if (iso === today) prefix = 'Today · ';
    else if (iso === tomorrow) prefix = 'Tomorrow · ';
    else if (iso === yesterday) prefix = 'Yesterday · ';
    return prefix + dt.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function loadMe() {
    const { user } = await api('GET', '/api/auth/me');
    state.user = user;
  }

  async function loadDay() {
    if (!state.user) return;
    const [{ tasks }, { stats }] = await Promise.all([
      api('GET', `/api/tasks?date=${state.date}`),
      api('GET', `/api/stats?date=${state.date}`)
    ]);
    state.tasks = tasks;
    state.stats = stats;
  }

  // ---------------- Render ----------------
  function render() {
    if (state.loading) {
      root.innerHTML = '';
      return;
    }
    if (!state.user) renderAuth();
    else renderApp();
  }

  function renderAuth() {
    const isSignup = state.authMode === 'signup';
    root.innerHTML = `
      <div class="auth-shell">
        <form class="auth-card" id="auth-form">
          <h1>${isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p class="sub">${isSignup ? 'Plan your days with intent.' : 'Sign in to continue.'}</p>

          ${isSignup ? `
            <label>Username</label>
            <input name="username" required minlength="3" maxlength="32" autocomplete="username" />
            <label>Email</label>
            <input name="email" type="email" required autocomplete="email" />
          ` : `
            <label>Username or email</label>
            <input name="identifier" required autocomplete="username" />
          `}

          <label>Password</label>
          <input name="password" type="password" required minlength="${isSignup ? 8 : 1}" autocomplete="${isSignup ? 'new-password' : 'current-password'}" />

          ${state.authError ? `<div class="error">${escapeHtml(state.authError)}</div>` : ''}

          <button class="primary" type="submit">${isSignup ? 'Create account' : 'Sign in'}</button>

          <div class="switch">
            ${isSignup ? 'Already have an account?' : 'New here?'}
            <a id="switch-mode">${isSignup ? 'Sign in' : 'Create one'}</a>
          </div>
        </form>
      </div>
    `;

    document.getElementById('switch-mode').addEventListener('click', () => {
      state.authMode = isSignup ? 'login' : 'signup';
      state.authError = '';
      render();
    });

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const payload = Object.fromEntries(form);
      const button = e.target.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        if (isSignup) {
          await api('POST', '/api/auth/signup', payload);
        } else {
          await api('POST', '/api/auth/login', payload);
        }
        state.authError = '';
        await loadMe();
        await loadDay();
        render();
      } catch (err) {
        state.authError = err.message;
        button.disabled = false;
        render();
      }
    });
  }

  function renderApp() {
    const total = state.tasks.length;
    const done = state.tasks.filter(t => t.completed).length;
    const estMin = state.tasks.reduce((a, t) => a + (t.estimated_minutes || 0), 0);
    const estHrs = (estMin / 60).toFixed(1);

    root.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand"><span class="dot"></span> Sunsama Clone <span class="v2-badge">v2</span></div>

          <div class="nav-item ${state.date === todayISO() ? 'active' : ''}" data-date="${todayISO()}">
            <span>Today</span>
          </div>
          <div class="nav-item ${state.date === shiftDate(todayISO(), 1) ? 'active' : ''}" data-date="${shiftDate(todayISO(), 1)}">
            <span>Tomorrow</span>
          </div>
          <div class="nav-item ${state.date === shiftDate(todayISO(), -1) ? 'active' : ''}" data-date="${shiftDate(todayISO(), -1)}">
            <span>Yesterday</span>
          </div>

          <div class="section-label">This week</div>
          ${weekNav()}

          <div class="user-row">
            <div class="who">
              <div class="avatar">${escapeHtml((state.user.username[0] || '?').toUpperCase())}</div>
              <div>${escapeHtml(state.user.username)}</div>
            </div>
            <button class="logout" id="logout-btn">Log out</button>
          </div>
        </aside>

        <main class="main">
          <div class="day-header">
            <div>
              <h2>${escapeHtml(prettyDate(state.date))}</h2>
              <div class="day-sub">${total} task${total === 1 ? '' : 's'} · ${done} done</div>
            </div>
            <div class="day-nav">
              <button id="prev-day" title="Previous day">←</button>
              <input type="date" id="date-picker" value="${state.date}" />
              <button id="next-day" title="Next day">→</button>
              <button id="today-btn">Today</button>
            </div>
          </div>

          <div class="stats-row">
            <div class="stat"><div class="label">Total</div><div class="value">${total}</div></div>
            <div class="stat done"><div class="label">Done</div><div class="value">${done}/${total || 0}</div></div>
            <div class="stat"><div class="label">Planned</div><div class="value">${estHrs}h</div></div>
          </div>

          <div class="add-task">
            <span class="plus">+</span>
            <input id="new-task" placeholder="Add a task and press Enter…" autocomplete="off" />
          </div>

          <div class="task-list" id="task-list">
            ${renderTasks()}
          </div>
        </main>
      </div>
    `;

    bindAppEvents();
  }

  function weekNav() {
    const today = todayISO();
    const out = [];
    for (let i = 0; i < 7; i++) {
      const iso = shiftDate(today, i);
      if (iso === today || iso === shiftDate(today, 1)) continue;
      const [y, m, d] = iso.split('-').map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      out.push(`<div class="nav-item ${state.date === iso ? 'active' : ''}" data-date="${iso}"><span>${label}</span></div>`);
    }
    return out.join('');
  }

  function renderTasks() {
    if (!state.tasks.length) {
      return `<div class="empty">No tasks yet. Plan your day above ↑</div>`;
    }
    const incomplete = state.tasks.filter(t => !t.completed);
    const completed = state.tasks.filter(t => t.completed);
    let html = incomplete.map(taskHtml).join('');
    if (completed.length) {
      html += `<div class="section-divider">Completed (${completed.length})</div>`;
      html += completed.map(taskHtml).join('');
    }
    return html;
  }

  function taskHtml(t) {
    return `
      <div class="task ${t.completed ? 'completed' : ''}" data-id="${t.id}" draggable="true">
        <div class="check ${t.completed ? 'checked' : ''}" data-action="toggle"></div>
        <div class="body">
          <div class="title-row">
            <input class="title" value="${escapeHtml(t.title)}" data-action="title" />
          </div>
          <div class="meta">
            <span class="chip">⏱ <input data-action="estimate" value="${t.estimated_minutes || 0}" type="number" min="0" /> min</span>
            ${t.channel ? `<span class="chip channel-chip">#${escapeHtml(t.channel)}</span>` : ''}
          </div>
          <textarea class="notes" data-action="notes" placeholder="Notes…">${escapeHtml(t.notes || '')}</textarea>
        </div>
        <div class="actions">
          <button data-action="expand" title="Notes">📝</button>
          <button data-action="tomorrow" title="Move to tomorrow">→</button>
          <button data-action="delete" class="danger" title="Delete">✕</button>
        </div>
      </div>
    `;
  }

  // ---------------- Events ----------------
  function bindAppEvents() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await api('POST', '/api/auth/logout');
      state.user = null; state.tasks = []; state.stats = null;
      render();
    });

    document.querySelectorAll('.sidebar .nav-item').forEach(el => {
      el.addEventListener('click', async () => {
        state.date = el.dataset.date;
        await loadDay();
        render();
      });
    });

    document.getElementById('prev-day').addEventListener('click', async () => {
      state.date = shiftDate(state.date, -1);
      await loadDay(); render();
    });
    document.getElementById('next-day').addEventListener('click', async () => {
      state.date = shiftDate(state.date, 1);
      await loadDay(); render();
    });
    document.getElementById('today-btn').addEventListener('click', async () => {
      state.date = todayISO();
      await loadDay(); render();
    });
    document.getElementById('date-picker').addEventListener('change', async (e) => {
      state.date = e.target.value;
      await loadDay(); render();
    });

    const newInput = document.getElementById('new-task');
    newInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && newInput.value.trim()) {
        const title = newInput.value.trim();
        newInput.value = '';
        try {
          await api('POST', '/api/tasks', { title, scheduled_date: state.date });
          await loadDay(); render();
          document.getElementById('new-task').focus();
        } catch (err) {
          alert(err.message);
        }
      }
    });
    newInput.focus();

    document.querySelectorAll('.task').forEach(el => bindTaskEvents(el));
  }

  function bindTaskEvents(el) {
    const id = el.dataset.id;

    el.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'toggle') {
        const t = state.tasks.find(x => x.id === id);
        updateTask(id, { completed: !t.completed });
      } else if (action === 'delete') {
        if (confirm('Delete this task?')) deleteTask(id);
      } else if (action === 'expand') {
        el.classList.toggle('expanded');
        const notes = el.querySelector('textarea.notes');
        if (el.classList.contains('expanded')) notes.focus();
      } else if (action === 'tomorrow') {
        moveTask(id, shiftDate(state.date, 1));
      }
    });

    const titleInput = el.querySelector('input.title');
    titleInput.addEventListener('change', () => {
      updateTask(id, { title: titleInput.value });
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    });

    const estInput = el.querySelector('input[data-action="estimate"]');
    if (estInput) {
      estInput.addEventListener('change', () => {
        updateTask(id, { estimated_minutes: Number(estInput.value) || 0 });
      });
    }

    const notes = el.querySelector('textarea.notes');
    if (notes) {
      const t = state.tasks.find(x => x.id === id);
      if (t && t.notes) el.classList.add('expanded');
      notes.addEventListener('change', () => {
        updateTask(id, { notes: notes.value });
      });
    }

    // drag & drop
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', String(id));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId === id) return;
      reorder(draggedId, id);
    });
  }

  async function updateTask(id, patch) {
    try {
      const { task } = await api('PATCH', `/api/tasks/${id}`, patch);
      const idx = state.tasks.findIndex(t => t.id === id);
      if (idx >= 0) state.tasks[idx] = task;
      render();
    } catch (err) { alert(err.message); }
  }

  async function deleteTask(id) {
    try {
      await api('DELETE', `/api/tasks/${id}`);
      state.tasks = state.tasks.filter(t => t.id !== id);
      render();
    } catch (err) { alert(err.message); }
  }

  async function moveTask(id, date) {
    try {
      await api('POST', `/api/tasks/${id}/move`, { scheduled_date: date });
      state.tasks = state.tasks.filter(t => t.id !== id);
      render();
    } catch (err) { alert(err.message); }
  }

  async function reorder(draggedId, targetId) {
    const list = state.tasks.filter(t => !t.completed);
    const draggedIdx = list.findIndex(t => t.id === draggedId);
    const targetIdx = list.findIndex(t => t.id === targetId);
    if (draggedIdx < 0 || targetIdx < 0) return;
    const [moved] = list.splice(draggedIdx, 1);
    list.splice(targetIdx, 0, moved);
    const completed = state.tasks.filter(t => t.completed);
    state.tasks = [...list, ...completed];
    render();
    try {
      await api('POST', '/api/tasks/reorder', {
        date: state.date,
        order: list.map(t => t.id)
      });
    } catch (err) { alert(err.message); }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------- Boot ----------------
  (async function init() {
    try {
      await loadMe();
      if (state.user) await loadDay();
    } catch (e) {
      console.error(e);
    } finally {
      state.loading = false;
      render();
    }
  })();
})();
