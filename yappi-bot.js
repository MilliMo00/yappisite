'use strict';
const https = require('https');
const fs    = require('fs');

const TOKEN    = '8846106201:AAFjFWIYQ7ANksFV_AX2g8ZYqezOh7YvPG8';
const ADMIN_ID = 7609412955;
const DB_FILE  = './feedback.json';

/* ── DB ── */
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { items: [] }; }
}
function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ── Telegram API ── */
function api(method, params) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(params));
    const req  = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.write(body);
    req.end();
  });
}

const send = (chatId, text, extra = {}) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

/* ── Helpers ── */
function statusLine(status) {
  return status === 'done' ? '✅ ВЫПОЛНЕНО' : status === 'wip' ? '🔄 В РАБОТЕ' : '⏳ НОВОЕ';
}

function buildButtons(id, currentStatus) {
  return {
    inline_keyboard: [[
      { text: currentStatus === 'done' ? '✅ Выполнено ◄' : '✅ Выполнено', callback_data: 'done_' + id },
      { text: currentStatus === 'wip'  ? '🔄 В работе ◄'  : '🔄 В работе',  callback_data: 'wip_'  + id }
    ]]
  };
}

/* ── Handlers ── */
async function handleCallback(cq) {
  if (cq.from.id !== ADMIN_ID) {
    await api('answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Доступ запрещён' });
    return;
  }

  const data    = cq.data;
  const msgId   = cq.message.message_id;
  const chatId  = cq.message.chat.id;
  const origTxt = cq.message.text || '';

  if (data === 'noop') {
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  if (data === 'view_complaints' || data === 'view_wishes') {
    const type = data === 'view_complaints' ? 'complaint' : 'wish';
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    await showList(ADMIN_ID, type);
    return;
  }

  if (data.startsWith('done_') || data.startsWith('wip_')) {
    const isDone = data.startsWith('done_');
    const id     = data.slice(5);
    const status = isDone ? 'done' : 'wip';

    /* update DB */
    const db  = load();
    const idx = db.items.findIndex(i => i.id === id);
    const entry = {
      id,
      type:      id.startsWith('complaint') ? 'complaint' : 'wish',
      text:      origTxt,
      status,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) db.items[idx] = entry;
    else          db.items.push(entry);
    save(db);

    /* edit message text — add status badge after first line */
    const lines    = origTxt.split('\n');
    const firstLine = lines[0] + '  —  ' + statusLine(status);
    const newText   = [firstLine, ...lines.slice(1)].join('\n');

    await api('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: newText, parse_mode: 'HTML',
      reply_markup: buildButtons(id, status)
    }).catch(() => {}); // ignore "message not modified"

    await api('answerCallbackQuery', {
      callback_query_id: cq.id,
      text: isDone ? '✅ Отмечено как выполнено!' : '🔄 Отмечено как в работе!'
    });
  }
}

async function showList(chatId, type) {
  const db    = load();
  const items = db.items.filter(i => i.type === type).slice(-20).reverse();
  const label = type === 'complaint' ? '🚨 ЖАЛОБЫ' : '💡 ПОЖЕЛАНИЯ';

  if (items.length === 0) {
    await send(chatId, label + '\n\nПока нет записей.');
    return;
  }

  const lines = items.map((it, n) => {
    const st    = it.status === 'done' ? '✅' : it.status === 'wip' ? '🔄' : '⏳';
    const short = (it.text || '').split('\n').filter(l => l.startsWith('📝'))[0] || it.text || '';
    return `${n + 1}. ${st} ${short.substring(0, 80)}`;
  });

  await send(chatId, `<b>${label}</b> (последние ${items.length}):\n\n` + lines.join('\n'));
}

async function handleMessage(msg) {
  if (msg.from.id !== ADMIN_ID) return;
  const text = (msg.text || '').trim();

  if (text === '/start') {
    const db = load();
    const c  = db.items.filter(i => i.type === 'complaint');
    const w  = db.items.filter(i => i.type === 'wish');
    await send(ADMIN_ID,
      '🤖 <b>YAPPI — Обратная связь</b>\n\n' +
      `🚨 Жалоб: <b>${c.length}</b>  (✅ закрыто: ${c.filter(i => i.status === 'done').length})\n` +
      `💡 Пожеланий: <b>${w.length}</b>  (✅ закрыто: ${w.filter(i => i.status === 'done').length})\n\n` +
      'Новые сообщения приходят сюда автоматически.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚨 Смотреть жалобы',     callback_data: 'view_complaints' }],
            [{ text: '💡 Смотреть пожелания',   callback_data: 'view_wishes'    }]
          ]
        }
      }
    );
  } else if (text === '/complaints') {
    await showList(ADMIN_ID, 'complaint');
  } else if (text === '/wishes') {
    await showList(ADMIN_ID, 'wish');
  } else if (text === '/stats') {
    const db = load();
    const c  = db.items.filter(i => i.type === 'complaint');
    const w  = db.items.filter(i => i.type === 'wish');
    await send(ADMIN_ID,
      '📊 <b>Статистика</b>\n\n' +
      `🚨 Жалобы: ${c.length} всего / ${c.filter(i=>i.status==='done').length} выполнено / ${c.filter(i=>i.status==='wip').length} в работе\n` +
      `💡 Пожелания: ${w.length} всего / ${w.filter(i=>i.status==='done').length} выполнено / ${w.filter(i=>i.status==='wip').length} в работе`
    );
  }
}

/* ── Polling ── */
let offset = 0;
async function poll() {
  try {
    const res = await api('getUpdates', { offset, timeout: 20, limit: 100 });
    if (res.ok && res.result && res.result.length > 0) {
      for (const upd of res.result) {
        offset = upd.update_id + 1;
        try {
          if (upd.callback_query) await handleCallback(upd.callback_query);
          else if (upd.message)   await handleMessage(upd.message);
        } catch (e) { console.error('Update error:', e.message); }
      }
    }
  } catch (e) { console.error('Poll error:', e.message); }
  setTimeout(poll, 1500);
}

console.log('🤖 YAPPI Bot запущен. Ожидаю сообщений...');
console.log('Команды: /start  /complaints  /wishes  /stats');
poll();
