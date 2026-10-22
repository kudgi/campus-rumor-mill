const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${protocol}://${location.host}/rumors/live`);
const feed = document.querySelector('#feed');
const trending = document.querySelector('#trending');
const status = document.querySelector('#status');

socket.onopen = () => {
  status.textContent = 'Connected';
  socket.send(JSON.stringify({ subscribe: 'hostel' }));
};
socket.onerror = () => {
  status.textContent = 'Connection error';
};
socket.onclose = () => {
  status.textContent = 'Disconnected';
};
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.event === 'trending:update') {
    trending.innerHTML = message.data.items
      .map(
        (rumor) =>
          `<li>${escapeHtml(rumor.text)} <span class="score">${Number(rumor.credibility).toFixed(1)}</span></li>`,
      )
      .join('');
    return;
  }
  const item = document.createElement('li');
  item.textContent = `${message.event}: ${message.data.text || message.data.id || ''}`;
  feed.prepend(item);
};

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}
