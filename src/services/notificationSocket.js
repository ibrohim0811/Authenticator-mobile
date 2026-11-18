import { AppState } from 'react-native';
import { getWsUrl, refreshAccessToken } from './api';
import { safeStorage } from './storage';

let socket = null;
let pingTimer = null;
let reconnectTimer = null;
let retry = 0;
let running = false;
let everOpened = false;
let onNotification = null;
let onReconnect = null;
let appStateSub = null;

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(30000, 1000 * 2 ** retry);
  retry += 1;
  reconnectTimer = setTimeout(connect, delay);
}

async function connect() {
  if (!running) return;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

  const token = await safeStorage.getItem('userToken');
  if (!token) return;

  const ws = new WebSocket(`${getWsUrl()}/ws/notifications?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    retry = 0;
    if (everOpened) onReconnect?.(); // uzilib qolgan vaqtdagi xabarlarni qayta yuklash uchun
    everOpened = true;
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send('ping');
    }, 25000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data?.type === 'notification') onNotification?.(data);
    } catch {
      // noto'g'ri JSON — e'tibor bermaymiz
    }
  };

  ws.onerror = () => {}; // xatodan keyin onclose baribir chaqiriladi

  ws.onclose = async (event) => {
    clearInterval(pingTimer);
    if (socket === ws) socket = null;
    if (!running) return;

    if (event.code === 1008) {
      // access token yaroqsiz/muddati o'tgan
      const fresh = await refreshAccessToken();
      if (!fresh) return; // seans tugagan, api.js interceptor login'ga yuboradi
    } else if (retry >= 2) {
      await refreshAccessToken();
    }
    scheduleReconnect();
  };
}

export const notificationSocket = {
  start(onMessage, onReconnectCb) {
    onNotification = onMessage;
    onReconnect = onReconnectCb;
    running = true;
    connect();

    appStateSub?.remove();
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        retry = 0;
        connect();
      }
    });
  },

  stop() {
    running = false;
    everOpened = false;
    onNotification = null;
    onReconnect = null;
    clearTimeout(reconnectTimer);
    clearInterval(pingTimer);
    appStateSub?.remove();
    appStateSub = null;
    socket?.close();
    socket = null;
  },
};