/**
 * SeaTalk Bot Webhook - Cloudflare Worker with Firebase Firestore
 * ===============================================================
 * Deploy this to your Cloudflare Worker.
 * Make sure to add these environment variables in the Cloudflare Dashboard:
 * - SEATALK_APP_ID
 * - SEATALK_APP_SECRET
 * - SEATALK_EVENT_SECRET
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_API_KEY
 */

const SEATALK_API = 'https://openapi.seatalk.io';

// --- Logging Helper ---
async function logEvent(env, level, message, details = {}) {
  try {
    const timestamp = new Date().toISOString();
    const res = await firestoreRequest(env, 'POST', `/logs`, {
      fields: {
        timestamp: { stringValue: timestamp },
        level: { stringValue: level },
        message: { stringValue: message },
        details: { stringValue: JSON.stringify(details) }
      }
    });
    if (res && res.error) {
      console.error("Firebase rejected log:", res.error);
    }
  } catch(e) {
    console.error("Failed to log", e);
  }
}

// --- Authentication for SeaTalk ---
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${SEATALK_API}/auth/v1/app_access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.SEATALK_APP_ID,
      app_secret: env.SEATALK_APP_SECRET,
    }),
  });

  const data = await res.json();
  if (data.code !== 0) throw new Error(`Token error: ${data.message}`);

  cachedToken = data.app_access_token;
  tokenExpiry = Date.now() + (data.expire - 60) * 1000;
  return cachedToken;
}

// --- Firebase Firestore REST Helpers ---
async function firestoreRequest(env, method, path, body = null) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}?key=${env.FIREBASE_API_KEY}`;
  
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  return res.json();
}

/**
 * Ensures a conversation exists in Firestore. If it does not, creates it.
 */
async function ensureConversation(env, info) {
  const collectionId = info.chat_type === 'group' ? info.group_id : info.employee_code;
  const docPath = `/conversations/${collectionId}`;
  
  // Try to get existing
  const existing = await firestoreRequest(env, 'GET', docPath);
  
  if (existing && !existing.error) {
    return collectionId;
  }
  
  // Create if missing
  const newFields = {
    chat_type: { stringValue: info.chat_type },
    employee_code: { stringValue: info.employee_code || '' },
    group_id: { stringValue: info.group_id || '' },
    group_name: { stringValue: info.group_name || '' },
    user_name: { stringValue: info.user_name || '' },
    user_email: { stringValue: info.user_email || '' },
    last_message_time: { stringValue: new Date().toISOString() },
    unread_count: { integerValue: "0" },
    status: { stringValue: 'active' }
  };

  await firestoreRequest(env, 'PATCH', `${docPath}`, { fields: newFields });
  return collectionId;
}

/**
 * Save message to Firestore and update conversation details
 */
async function saveMessage(env, convId, info) {
  const timestamp = new Date().toISOString();
  
  // Create message document
  await firestoreRequest(env, 'POST', `/messages`, {
    fields: {
      conversation_id: { stringValue: convId },
      message_id: { stringValue: info.message_id || '' },
      sender: { stringValue: info.sender },
      sender_name: { stringValue: info.sender_name || '' },
      content: { stringValue: info.content },
      message_type: { stringValue: 'text' },
      employee_code: { stringValue: info.employee_code || '' },
      group_id: { stringValue: info.group_id || '' },
      is_auto_reply: { booleanValue: info.is_auto_reply || false },
      sent_at: { stringValue: timestamp }
    }
  });

  // Update conversation last message & unread
  const conv = await firestoreRequest(env, 'GET', `/conversations/${convId}`);
  let unread = 0;
  if (conv && conv.fields && conv.fields.unread_count) {
     unread = parseInt(conv.fields.unread_count.integerValue || "0", 10);
  }
  
  if (!info.is_auto_reply && info.sender !== 'admin') {
    unread += 1;
  } else {
    unread = 0;
  }

  await firestoreRequest(env, 'PATCH', `/conversations/${convId}?updateMask.fieldPaths=last_message&updateMask.fieldPaths=last_message_time&updateMask.fieldPaths=unread_count`, {
    fields: {
      last_message: { stringValue: info.content.substring(0, 80) },
      last_message_time: { stringValue: timestamp },
      unread_count: { integerValue: unread.toString() }
    }
  });
}

// --- Auto Reply Logic with Firestore ---
async function findMatchingRule(env, messageText) {
  const rules = await firestoreRequest(env, 'GET', '/rules');
  if (!rules || !rules.documents) return null;
  
  const lowerMsg = messageText.toLowerCase();

  for (const doc of rules.documents) {
    const rule = doc.fields;
    if (rule.is_active && rule.is_active.booleanValue === true && rule.trigger_type.stringValue === 'keyword') {
      const keywordsStr = rule.keywords.stringValue;
      let keywords = [];
      try { keywords = JSON.parse(keywordsStr); } catch(e){}
      
      const matchType = rule.match_type.stringValue;
      
      const matched = keywords.some(kw => {
        const lowerKw = kw.toLowerCase();
        if (matchType === 'exact') return lowerMsg === lowerKw;
        if (matchType === 'starts_with') return lowerMsg.startsWith(lowerKw);
        return lowerMsg.includes(lowerKw); // default contains
      });

      if (matched) return rule.reply_message.stringValue;
    }
  }
  
  // Fallback
  const fallback = rules.documents.find(d => d.fields.trigger_type && d.fields.trigger_type.stringValue === 'fallback' && d.fields.is_active && d.fields.is_active.booleanValue === true);
  if (fallback) return fallback.fields.reply_message.stringValue;
  
  return null;
}

// --- SeaTalk Sending specific helpers ---
async function sendPrivateMessage(env, employeeCode, text) {
  const token = await getAccessToken(env);
  await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_code: employeeCode, message: { tag: 'text', text: { content: text } } }),
  });
}

async function sendGroupMessage(env, groupId, text, threadId) {
  const token = await getAccessToken(env);
  const body = { group_id: groupId, message: { tag: 'text', text: { content: text } } };
  if (threadId) body.thread_id = threadId;

  await fetch(`${SEATALK_API}/messaging/v2/group_chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Event Handlers ---
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    try {
      // Endpoint for React App to send messages OUT using the Cloudflare Worker
      if (url.pathname === '/api/dashboard/send' && request.method === 'POST') {
        const bodyText = await request.text();
        let body;
        try { body = JSON.parse(bodyText); } catch { body = {}; }
        
        if (body.ping) {
          const envChecks = {
            hasProjectId: !!env.FIREBASE_PROJECT_ID,
            hasApiKey: !!env.FIREBASE_API_KEY,
            hasAppId: !!env.SEATALK_APP_ID,
            hasAppSecret: !!env.SEATALK_APP_SECRET
          };
          if (body.testLog) {
            await logEvent(env, 'info', 'Ping with Test Log request', envChecks);
          }
          return new Response(JSON.stringify({ success: true, message: "pong", envChecks }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        const { conversation_id, chat_type, target_id, content } = body;
        
        if (chat_type === 'private') {
           await sendPrivateMessage(env, target_id, content);
        } else if (chat_type === 'group') {
           await sendGroupMessage(env, target_id, content);
        }
        
        if (conversation_id) {
          await saveMessage(env, conversation_id, {
            sender: 'admin',
            sender_name: 'Admin',
            content,
            employee_code: chat_type === 'private' ? target_id : '',
            group_id: chat_type === 'group' ? target_id : '',
            is_auto_reply: false
          });
        }

        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      if (request.method === 'POST' && (url.pathname === '/' || url.pathname.includes('/seatalk'))) {
        const bodyText = await request.text();
        let body;
        try { 
          body = JSON.parse(bodyText); 
          await logEvent(env, 'info', 'Received SeaTalk webhook', { event_type: body.event_type, event: body.event });
        } catch (e) { 
          await logEvent(env, 'error', 'Failed to parse SeaTalk JSON', { body: bodyText, error: e.message });
          return new Response('Bad Request', { status: 400, headers: corsHeaders }); 
        }

        // SeaTalk URL Verification
        if (body.event && body.event.seatalk_challenge) {
          await logEvent(env, 'info', 'Handling SeaTalk challenge', { challenge: body.event.seatalk_challenge });
          return new Response(JSON.stringify({ seatalk_challenge: body.event.seatalk_challenge }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const eventType = body.event_type;
        const event = body.event || {};

        try {
          if (eventType === 'message_from_bot_subscriber') {
            await logEvent(env, 'info', 'Processing bot subscriber message', { event });
            const content = event.message?.text?.content;
            if (content) {
              const convId = await ensureConversation(env, { chat_type: 'private', employee_code: event.employee_code, user_name: event.sender_employee_info?.en_name || event.employee_code, user_email: event.sender_employee_info?.email || '' });
              await saveMessage(env, convId, { sender: 'user', sender_name: event.sender_employee_info?.en_name || event.employee_code, content, employee_code: event.employee_code, message_id: event.message_id });
              
              const reply = await findMatchingRule(env, content);
              if (reply) {
                await logEvent(env, 'info', 'Sending auto-reply', { employeeCode: event.employee_code, reply });
                await sendPrivateMessage(env, event.employee_code, reply);
                await saveMessage(env, convId, { sender: 'bot', sender_name: 'Bot', content: reply, employee_code: event.employee_code, is_auto_reply: true });
              } else {
                await logEvent(env, 'info', 'No matching rule found', { content });
              }
            }
          } else if (eventType === 'new_mentioned_message_received_from_group_chat') {
             await logEvent(env, 'info', 'Processing mentioned group message', { event });
             const content = event.message?.text?.content;
             if (content) {
               const convId = await ensureConversation(env, { chat_type: 'group', group_id: event.group_id, group_name: event.group_name || event.group_id });
               await saveMessage(env, convId, { sender: 'user', sender_name: event.sender_employee_info?.en_name || event.employee_code, content, employee_code: event.employee_code, group_id: event.group_id, message_id: event.message_id });
               
               const reply = await findMatchingRule(env, content);
               if (reply) {
                 await logEvent(env, 'info', 'Sending group auto-reply', { groupId: event.group_id, reply });
                 await sendGroupMessage(env, event.group_id, reply, event.thread_id);
                 await saveMessage(env, convId, { sender: 'bot', sender_name: 'Bot', content: reply, group_id: event.group_id, is_auto_reply: true });
               } else {
                 await logEvent(env, 'info', 'No matching group rule found', { content });
               }
             }
          }
        } catch (err) {
          console.error('Event handler error:', err);
          await logEvent(env, 'error', 'Error in event handler', { error: err.toString(), stack: err.stack });
        }

        return new Response(JSON.stringify({ code: 0 }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      await logEvent(env, 'warning', 'Route not found', { method: request.method, url: url.pathname });
      return new Response('Not Found', { status: 404, headers: corsHeaders });
      
    } catch (e) {
      console.error("Global Catch Event:", e);
      return new Response(JSON.stringify({ error: e.message, status: "Failed" }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
};
