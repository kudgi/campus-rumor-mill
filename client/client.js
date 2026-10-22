const tokenKey = 'campusRumorMillToken';
const state = { token: localStorage.getItem(tokenKey), page: 1, loading: false };
const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Something went wrong');
  return body;
};
const showNotice = (message, type = 'success') => {
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice ${type}`;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add('hidden'), 4500);
};
const setConnection = (label, connected = false) => {
  $('#status').textContent = label;
  $('#connection-dot').classList.toggle('connected', connected);
};
const categoryName = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const formatAge = (value) => {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};
function saveSession(data) {
  state.token = data.token;
  localStorage.setItem(tokenKey, data.token);
  if (data.recoveryCode) {
    $('#recovery-code-value').textContent = data.recoveryCode;
    $('#recovery-display').classList.remove('hidden');
  }
}
async function ensureSession() {
  if (!state.token) saveSession(await api('/session/init', { method: 'POST' }));
  try {
    await loadSession();
  } catch {
    localStorage.removeItem(tokenKey);
    state.token = null;
    saveSession(await api('/session/init', { method: 'POST' }));
    await loadSession();
  }
}
async function loadSession() {
  const session = await api('/session/me');
  $('#session-id').textContent = `ID ${session.id}`;
  $('#stat-rumors').textContent = session.rumors_posted;
  $('#stat-upvotes').textContent = session.upvotes;
  $('#stat-flags').textContent = session.flags;
}
function renderRumor(rumor) {
  const item = document.createElement('article');
  item.className = 'rumor';
  item.dataset.id = rumor.id;
  const top = document.createElement('div');
  top.className = 'rumor-top';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = categoryName(rumor.category);
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = `${Number(rumor.credibility).toFixed(1)} credibility`;
  top.append(tag, score);
  const text = document.createElement('p');
  text.className = 'rumor-text';
  text.textContent = rumor.text;
  const meta = document.createElement('div');
  meta.className = 'rumor-meta';
  meta.textContent = `${formatAge(rumor.created_at)} · ${rumor.upvote_count} upvotes · ${rumor.flag_count} flags`;
  const actions = document.createElement('div');
  actions.className = 'rumor-actions';
  for (const [label, endpoint] of [
    ['↑ Upvote', 'upvote'],
    ['⚑ Flag', 'flag'],
  ]) {
    const button = document.createElement('button');
    button.className = 'action';
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/rumor/${rumor.id}/${endpoint}`, { method: 'POST' });
        showNotice(endpoint === 'upvote' ? 'Upvote recorded.' : 'Flag recorded.');
        await loadRumors(true);
        await loadSession();
      } catch (error) {
        showNotice(error.message, 'error');
        button.disabled = false;
      }
    });
    actions.append(button);
  }
  item.append(top, text, meta, actions);
  return item;
}
async function loadRumors(reset = false) {
  if (state.loading) return;
  if (reset) state.page = 1;
  state.loading = true;
  try {
    const params = new URLSearchParams({
      page: state.page,
      limit: 10,
      sort: $('#feed-sort').value,
    });
    if ($('#feed-category').value) params.set('category', $('#feed-category').value);
    const result = await api(`/rumors?${params}`);
    const list = $('#rumor-list');
    if (reset || state.page === 1) list.replaceChildren();
    if (!result.items.length && state.page === 1) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No rumors match these filters yet.';
      list.append(empty);
    } else result.items.forEach((rumor) => list.append(renderRumor(rumor)));
    $('#load-more').classList.toggle('hidden', result.items.length < 10);
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    state.loading = false;
  }
}
function renderTrending(items) {
  const list = $('#trending');
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No active rumors yet.';
    list.append(empty);
    return;
  }
  items.slice(0, 10).forEach((rumor, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'trend-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    text.textContent = rumor.text;
    const score = document.createElement('strong');
    score.className = 'score';
    score.textContent = Number(rumor.credibility).toFixed(1);
    item.append(number, text, score);
    list.append(item);
  });
}
function connectLive() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/rumors/live`);
  socket.onopen = () => {
    setConnection('Connected', true);
    socket.send(JSON.stringify({ subscribe: $('#subscription').value }));
  };
  socket.onerror = () => setConnection('Connection error');
  socket.onclose = () => setConnection('Disconnected');
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.event === 'trending:update') return renderTrending(message.data.items);
    const item = document.createElement('li');
    item.textContent = `${message.event.replace('rumor:', '')}: ${message.data.text || message.data.id || ''}`;
    $('#feed').prepend(item);
    if (message.event === 'rumor:new') loadRumors(true);
  };
  $('#subscription').addEventListener('change', () => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ subscribe: $('#subscription').value }));
  });
}
$('#rumor-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/rumor', {
      method: 'POST',
      body: JSON.stringify({ text: $('#rumor-text').value, category: $('#rumor-category').value }),
    });
    $('#rumor-text').value = '';
    showNotice('Rumor posted anonymously.');
    await loadRumors(true);
    await loadSession();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
$('#recovery-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    saveSession(
      await api('/session/recover', {
        method: 'POST',
        body: JSON.stringify({ recoveryCode: $('#recovery-code').value }),
      }),
    );
    await loadSession();
    showNotice('Session recovered successfully.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});
$('#copy-recovery').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#recovery-code-value').textContent);
  showNotice('Recovery code copied. Store it somewhere safe.');
});
$('#feed-category').addEventListener('change', () => loadRumors(true));
$('#feed-sort').addEventListener('change', () => loadRumors(true));
$('#load-more').addEventListener('click', () => {
  state.page += 1;
  loadRumors();
});
(async () => {
  try {
    await ensureSession();
    await loadRumors(true);
    connectLive();
  } catch (error) {
    showNotice(error.message, 'error');
    setConnection('Unavailable');
  }
})();
