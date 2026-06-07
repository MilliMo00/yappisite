'use strict';
const https = require('https');
const http  = require('http');
const fs    = require('fs');

const TOKEN    = '8846106201:AAFjFWIYQ7ANksFV_AX2g8ZYqezOh7YvPG8';
const ADMIN_ID = 7609412955;
const DB_FILE  = './feedback.json';
const AN_FILE  = './analytics.json';
const ANALYTICS_PORT = 3001;

/* ─────────────── FEEDBACK DB ─────────────── */
function load() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { items: [] }; }
}
function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ─────────────── ANALYTICS DB ─────────────── */
function loadAn() {
  try { return JSON.parse(fs.readFileSync(AN_FILE, 'utf8')); }
  catch {
    return {
      total: { pageviews: 0, sessions: 0, tg_clicks: 0, partner_clicks: 0,
               service_clicks: 0, form_submits: 0, feedback_sent: 0 },
      services: {},
      partners: {},
      daily: {},
      sessions: []
    };
  }
}
function saveAn(d) { fs.writeFileSync(AN_FILE, JSON.stringify(d, null, 2)); }

function today() { return new Date().toISOString().slice(0, 10); }

function ensureDay(an, day) {
  if (!an.daily[day]) {
    an.daily[day] = {
      pageviews: 0, sessions: 0, tg_clicks: 0, partner_clicks: 0,
      service_clicks: 0, form_submits: 0, feedback_sent: 0,
      total_ms: 0
    };
  }
  return an.daily[day];
}

function processEvent(ev) {
  const an  = loadAn();
  const d   = ensureDay(an, today());

  switch (ev.type) {
    case 'pageview':
      an.total.pageviews++;
      d.pageviews++;
      break;

    case 'session_end': {
      const dur = Math.round((ev.duration || 0));
      an.total.sessions++;
      d.sessions++;
      d.total_ms += dur;
      an.sessions.push({
        date: today(), dur, device: ev.device || '?',
        ref: ev.ref || '', pages: ev.pages || 1
      });
      if (an.sessions.length > 1000) an.sessions = an.sessions.slice(-1000);
      break;
    }

    case 'click_tg':
      an.total.tg_clicks++;
      d.tg_clicks++;
      break;

    case 'click_partner': {
      an.total.partner_clicks++;
      d.partner_clicks++;
      const pk = (ev.name || ev.href || '').slice(0, 40);
      an.partners[pk] = (an.partners[pk] || 0) + 1;
      break;
    }

    case 'click_service': {
      an.total.service_clicks++;
      d.service_clicks++;
      const sk = ev.service || 'unknown';
      an.services[sk] = (an.services[sk] || 0) + 1;
      break;
    }

    case 'form_submit':
      an.total.form_submits++;
      d.form_submits++;
      break;

    case 'feedback_sent':
      an.total.feedback_sent++;
      d.feedback_sent++;
      break;
  }

  saveAn(an);
}

/* ─────────────── TELEGRAM API ─────────────── */
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
    req.write(body); req.end();
  });
}

const send = (chatId, text, extra = {}) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

/* ─────────────── HELPERS ─────────────── */
function statusLine(s) {
  return s === 'done' ? '✅ ВЫПОЛНЕНО' : s === 'wip' ? '🔄 В РАБОТЕ' : '⏳ НОВОЕ';
}
function buildButtons(id, cur) {
  return {
    inline_keyboard: [[
      { text: cur === 'done' ? '✅ Выполнено ◄' : '✅ Выполнено', callback_data: 'done_' + id },
      { text: cur === 'wip'  ? '🔄 В работе ◄'  : '🔄 В работе',  callback_data: 'wip_'  + id }
    ]]
  };
}

function fmtTime(ms) {
  if (!ms || ms < 1000) return '0 сек';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' сек';
  const m = Math.floor(s / 60), rs = s % 60;
  return m + ' мин ' + (rs > 0 ? rs + ' сек' : '');
}

function getLast7(an) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const short = key.slice(5).replace('-', '.');
    const dd = an.daily[key] || {};
    const avg = dd.sessions > 0 ? Math.round(dd.total_ms / dd.sessions) : 0;
    days.push(`${short}: 👁${dd.pageviews||0} 👤${dd.sessions||0} ⏱${fmtTime(avg)}`);
  }
  return days.join('\n');
}

function getAvgSession(an) {
  const recent = an.sessions.slice(-200);
  if (!recent.length) return '—';
  const total = recent.reduce((s, x) => s + (x.dur || 0), 0);
  return fmtTime(Math.round(total / recent.length));
}

function getDeviceSplit(an) {
  const recent = an.sessions.slice(-200);
  if (!recent.length) return '—';
  const mob = recent.filter(s => s.device === 'mobile').length;
  const desk = recent.length - mob;
  return `📱 ${mob} (${Math.round(mob/recent.length*100)}%) / 🖥 ${desk} (${Math.round(desk/recent.length*100)}%)`;
}

function topServices(an) {
  const entries = Object.entries(an.services || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return '—';
  const map = {
    'ai-production': 'AI-контент', 'automation': 'Автоматизация',
    'web-dev': 'Веб-разработка', 'bots-rental': 'Боты', 'creatives': 'Креативы',
    'tables': 'Таблицы', 'cases': 'Кейсы'
  };
  return entries.map(([k, v]) => `  ${map[k] || k}: ${v}`).join('\n');
}

function topPartners(an) {
  const entries = Object.entries(an.partners || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `  ${k}: ${v}`).join('\n');
}

/* ─────────────── ANALYTICS REPORT ─────────────── */
async function showAnalytics(chatId, sub) {
  const an  = loadAn();
  const t   = an.total;
  const td  = an.daily[today()] || {};
  const avgToday = td.sessions > 0 ? Math.round(td.total_ms / td.sessions) : 0;

  if (sub === 'today') {
    await send(chatId,
      '📊 <b>АНАЛИТИКА — СЕГОДНЯ</b>\n' +
      '━━━━━━━━━━━━━━━━\n\n' +
      `👁 Просмотры страниц:  <b>${td.pageviews || 0}</b>\n` +
      `👤 Сессии:             <b>${td.sessions  || 0}</b>\n` +
      `⏱ Ср. время:          <b>${fmtTime(avgToday)}</b>\n\n` +
      `📱 Клики → Telegram:   <b>${td.tg_clicks       || 0}</b>\n` +
      `🤝 Клики → Партнёры:   <b>${td.partner_clicks  || 0}</b>\n` +
      `🛠 Клики → Услуги:     <b>${td.service_clicks  || 0}</b>\n` +
      `📬 Заявки (форма):     <b>${td.form_submits    || 0}</b>\n` +
      `💬 Жалобы/пожелания:   <b>${td.feedback_sent   || 0}</b>`
    );
    return;
  }

  if (sub === 'week') {
    await send(chatId,
      '📊 <b>АНАЛИТИКА — 7 ДНЕЙ</b>\n' +
      '━━━━━━━━━━━━━━━━\n\n' +
      getLast7(an)
    );
    return;
  }

  /* Полный отчёт — для рекламодателей */
  const convRate = t.pageviews > 0
    ? ((t.tg_clicks / t.pageviews) * 100).toFixed(1) + '%'
    : '—';

  await send(chatId,
    '📊 <b>АНАЛИТИКА YAPPI AGENCY</b>\n' +
    '━━━━━━━━━━━━━━━━\n\n' +

    '📈 <b>ОХВАТ (всё время)</b>\n' +
    `   👁 Просмотры:       <b>${t.pageviews}</b>\n` +
    `   👤 Сессии:          <b>${t.sessions}</b>\n` +
    `   ⏱ Ср. время:       <b>${getAvgSession(an)}</b>\n` +
    `   📱/🖥 Устройства:  <b>${getDeviceSplit(an)}</b>\n\n` +

    '🎯 <b>КОНВЕРСИИ</b>\n' +
    `   📱 → Telegram:     <b>${t.tg_clicks}</b>\n` +
    `   📬 → Заявки:       <b>${t.form_submits}</b>\n` +
    `   💡 Конверсия:       <b>${convRate}</b>\n\n` +

    '🔗 <b>ПЕРЕХОДЫ</b>\n' +
    `   🤝 На партнёров:   <b>${t.partner_clicks}</b>\n` +
    `   🛠 На услуги:      <b>${t.service_clicks}</b>\n` +
    `   💬 Отзывов/жалоб:  <b>${t.feedback_sent}</b>\n\n` +

    '🏆 <b>ТОП УСЛУГИ</b>\n' + topServices(an) + '\n\n' +

    '🤝 <b>ТОП ПАРТНЁРЫ</b>\n' + topPartners(an) + '\n\n' +

    '📅 <b>ПОСЛЕДНИЕ 7 ДНЕЙ</b>\n' + getLast7(an),
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📅 Только сегодня',  callback_data: 'an_today' }],
          [{ text: '📆 7 дней',          callback_data: 'an_week'  }]
        ]
      }
    }
  );
}

/* ─────────────── FEEDBACK LIST ─────────────── */
async function showList(chatId, type) {
  const db    = load();
  const items = db.items.filter(i => i.type === type).slice(-20).reverse();
  const label = type === 'complaint' ? '🚨 ЖАЛОБЫ' : '💡 ПОЖЕЛАНИЯ';

  if (!items.length) {
    await send(chatId, label + '\n\nПока нет записей.');
    return;
  }

  const lines = items.map((it, n) => {
    const st    = it.status === 'done' ? '✅' : it.status === 'wip' ? '🔄' : '⏳';
    const short = (it.text || '').split('\n').find(l => l.startsWith('📝')) || it.text || '';
    return `${n + 1}. ${st} ${short.slice(0, 80)}`;
  });

  await send(chatId, `<b>${label}</b> (последние ${items.length}):\n\n` + lines.join('\n'));
}

/* ─────────────── CALLBACK HANDLER ─────────────── */
async function handleCallback(cq) {
  if (cq.from.id !== ADMIN_ID) {
    await api('answerCallbackQuery', { callback_query_id: cq.id, text: '⛔ Доступ запрещён' });
    return;
  }

  const { data, message } = cq;
  const chatId = message.chat.id;
  const msgId  = message.message_id;

  if (data === 'noop') {
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  if (data === 'an_today') {
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    await showAnalytics(chatId, 'today');
    return;
  }

  if (data === 'an_week') {
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    await showAnalytics(chatId, 'week');
    return;
  }

  if (data === 'view_complaints' || data === 'view_wishes') {
    const type = data === 'view_complaints' ? 'complaint' : 'wish';
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    await showList(chatId, type);
    return;
  }

  if (data.startsWith('done_') || data.startsWith('wip_')) {
    const isDone = data.startsWith('done_');
    const id     = data.slice(5);
    const status = isDone ? 'done' : 'wip';

    const db  = load();
    const idx = db.items.findIndex(i => i.id === id);
    const origTxt = message.text || '';
    const entry = {
      id, status,
      type:      id.startsWith('complaint') ? 'complaint' : 'wish',
      text:      origTxt,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) db.items[idx] = entry; else db.items.push(entry);
    save(db);

    const lines     = origTxt.split('\n');
    const firstLine = lines[0] + '  —  ' + statusLine(status);
    const newText   = [firstLine, ...lines.slice(1)].join('\n');

    await api('editMessageText', {
      chat_id: chatId, message_id: msgId,
      text: newText, parse_mode: 'HTML',
      reply_markup: buildButtons(id, status)
    }).catch(() => {});

    await api('answerCallbackQuery', {
      callback_query_id: cq.id,
      text: isDone ? '✅ Отмечено как выполнено!' : '🔄 Отмечено как в работе!'
    });
  }
}

/* ─────────────── MESSAGE HANDLER ─────────────── */
async function handleMessage(msg) {
  if (msg.from.id !== ADMIN_ID) return;
  const text = (msg.text || '').trim();

  if (text === '/start') {
    const db = load();
    const c  = db.items.filter(i => i.type === 'complaint');
    const w  = db.items.filter(i => i.type === 'wish');
    const an = loadAn();
    const td = an.daily[today()] || {};

    await send(ADMIN_ID,
      '🤖 <b>YAPPI — Панель управления</b>\n\n' +
      '💬 <b>Обратная связь:</b>\n' +
      `🚨 Жалоб: <b>${c.length}</b>  (✅ закрыто: ${c.filter(i => i.status === 'done').length})\n` +
      `💡 Пожеланий: <b>${w.length}</b>  (✅ закрыто: ${w.filter(i => i.status === 'done').length})\n\n` +
      '📊 <b>Аналитика сегодня:</b>\n' +
      `👁 Просмотры: <b>${td.pageviews || 0}</b>   👤 Сессии: <b>${td.sessions || 0}</b>\n` +
      `📱 → TG: <b>${td.tg_clicks || 0}</b>   📬 Заявки: <b>${td.form_submits || 0}</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚨 Жалобы',       callback_data: 'view_complaints' },
             { text: '💡 Пожелания',     callback_data: 'view_wishes'    }],
            [{ text: '📊 Аналитика',     callback_data: 'an_full'        }],
            [{ text: '📅 Сегодня',       callback_data: 'an_today'       },
             { text: '📆 7 дней',        callback_data: 'an_week'        }]
          ]
        }
      }
    );
    return;
  }

  if (text === '/complaints') { await showList(ADMIN_ID, 'complaint'); return; }
  if (text === '/wishes')     { await showList(ADMIN_ID, 'wish');      return; }
  if (text === '/analytics' || text === '/stats') { await showAnalytics(ADMIN_ID, 'full'); return; }
  if (text === '/today')      { await showAnalytics(ADMIN_ID, 'today'); return; }
  if (text === '/week')       { await showAnalytics(ADMIN_ID, 'week');  return; }
}

/* ─────────────── ANALYTICS HTTP SERVER ─────────────── */
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/an') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const events = JSON.parse(body);
        (Array.isArray(events) ? events : [events]).forEach(ev => {
          try { processEvent(ev); } catch {}
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400); res.end('{"ok":false}');
      }
    });
    return;
  }

  res.writeHead(404); res.end();
}).listen(ANALYTICS_PORT, () => {
  console.log(`📊 Аналитика-сервер: http://localhost:${ANALYTICS_PORT}/an`);
});

/* ─────────────── POLLING ─────────────── */
let offset = 0;
async function handleCallback_an(cq) {
  if (cq.data === 'an_full') {
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    await showAnalytics(cq.message.chat.id, 'full');
  } else {
    await handleCallback(cq);
  }
}

async function poll() {
  try {
    const res = await api('getUpdates', { offset, timeout: 20, limit: 100 });
    if (res.ok && res.result && res.result.length > 0) {
      for (const upd of res.result) {
        offset = upd.update_id + 1;
        try {
          if (upd.callback_query) await handleCallback_an(upd.callback_query);
          else if (upd.message)   await handleMessage(upd.message);
        } catch (e) { console.error('Ошибка обновления:', e.message); }
      }
    }
  } catch (e) { console.error('Ошибка поллинга:', e.message); }
  setTimeout(poll, 1500);
}

console.log('🤖 YAPPI Bot запущен');
console.log('Команды: /start  /analytics  /today  /week  /complaints  /wishes');
poll();
