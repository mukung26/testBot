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

const SEATALK_API = "https://openapi.seatalk.io";

// --- Logging Helper ---
async function logEvent(env, level, message, details = {}) {
  try {
    const timestamp = new Date().toISOString();
    const res = await firestoreRequest(env, "POST", `/logs`, {
      fields: {
        timestamp: { stringValue: timestamp },
        level: { stringValue: level },
        message: { stringValue: message },
        details: { stringValue: JSON.stringify(details) },
      },
    });
    if (res && res.error) {
      console.error("Firebase rejected log:", res.error);
      return { success: false, error: res.error };
    }
    return { success: true, res };
  } catch (e) {
    console.error("Failed to log", e);
    return { success: false, error: e.message };
  }
}

// --- Authentication for SeaTalk ---
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${SEATALK_API}/auth/app_access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: env.SEATALK_APP_ID,
      app_secret: env.SEATALK_APP_SECRET,
    }),
  });

  const textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`Token parse error. Body: ${textBody}`);
  }
  if (data.code !== 0) throw new Error(`Token error: ${data.message}`);

  cachedToken = data.app_access_token;
  tokenExpiry = Date.now() + (data.expire - 60) * 1000;
  return cachedToken;
}

// --- Firebase Firestore REST Helpers ---
async function firestoreRequest(env, method, path, body = null) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const apiKey = (env.FIREBASE_API_KEY || "").trim();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}?key=${apiKey}`;

  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const textBody = await res.text();
  if (!textBody) return null;
  try {
    return JSON.parse(textBody);
  } catch (e) {
    throw new Error(
      `Firestore text parse error: ${e.message} for body: ${textBody}`,
    );
  }
}

/**
 * Ensures a conversation exists in Firestore. If it does not, creates it.
 */
async function ensureConversation(env, info) {
  const collectionId =
    info.chat_type === "group" ? info.group_id : info.employee_code;
  const docPath = `/conversations/${collectionId}`;

  // Try to get existing
  const existing = await firestoreRequest(env, "GET", docPath);

  if (existing && !existing.error) {
    const updates = {};
    const masks = [];
    const currentUserName = existing.fields.user_name?.stringValue || "";
    const currentUserEmail = existing.fields.user_email?.stringValue || "";
    const currentGroupName = existing.fields.group_name?.stringValue || "";

    if (
      info.user_name &&
      (!currentUserName ||
        currentUserName === info.employee_code ||
        (info.user_name !== currentUserName &&
          !info.user_name.startsWith("e_")))
    ) {
      updates.user_name = { stringValue: info.user_name };
      masks.push("updateMask.fieldPaths=user_name");
    }
    if (info.user_email && currentUserEmail !== info.user_email) {
      updates.user_email = { stringValue: info.user_email };
      masks.push("updateMask.fieldPaths=user_email");
    }
    if (info.group_name && currentGroupName !== info.group_name) {
      updates.group_name = { stringValue: info.group_name };
      masks.push("updateMask.fieldPaths=group_name");
    }
    if (masks.length > 0) {
      await firestoreRequest(env, "PATCH", `${docPath}?${masks.join("&")}`, {
        fields: updates,
      });
    }
    return collectionId;
  }

  // Create if missing
  const newFields = {
    chat_type: { stringValue: info.chat_type },
    employee_code: { stringValue: info.employee_code || "" },
    group_id: { stringValue: info.group_id || "" },
    group_name: { stringValue: info.group_name || "" },
    user_name: { stringValue: info.user_name || "" },
    user_email: { stringValue: info.user_email || "" },
    last_message_time: { stringValue: new Date().toISOString() },
    unread_count: { integerValue: "0" },
    status: { stringValue: "active" },
  };

  await firestoreRequest(env, "PATCH", `${docPath}`, { fields: newFields });
  return collectionId;
}

/**
 * Save message to Firestore and update conversation details
 */
async function saveMessage(env, convId, info) {
  const timestamp = new Date().toISOString();

  // Create message document
  await firestoreRequest(env, "POST", `/messages`, {
    fields: {
      conversation_id: { stringValue: convId },
      message_id: { stringValue: info.message_id || "" },
      sender: { stringValue: info.sender },
      sender_name: { stringValue: info.sender_name || "" },
      content: { stringValue: info.content },
      message_type: { stringValue: "text" },
      employee_code: { stringValue: info.employee_code || "" },
      group_id: { stringValue: info.group_id || "" },
      is_auto_reply: { booleanValue: info.is_auto_reply || false },
      sent_at: { stringValue: timestamp },
    },
  });

  // Update conversation last message & unread
  const conv = await firestoreRequest(env, "GET", `/conversations/${convId}`);
  let unread = 0;
  if (conv && conv.fields && conv.fields.unread_count) {
    unread = parseInt(conv.fields.unread_count.integerValue || "0", 10);
  }

  if (!info.is_auto_reply && info.sender !== "admin") {
    unread += 1;
  } else {
    unread = 0;
  }

  await firestoreRequest(
    env,
    "PATCH",
    `/conversations/${convId}?updateMask.fieldPaths=last_message&updateMask.fieldPaths=last_message_time&updateMask.fieldPaths=unread_count`,
    {
      fields: {
        last_message: { stringValue: info.content.substring(0, 80) },
        last_message_time: { stringValue: timestamp },
        unread_count: { integerValue: unread.toString() },
      },
    },
  );
}

// --- Auto Reply Logic with Firestore ---
async function findMatchingRule(env, messageText) {
  const rules = await firestoreRequest(env, "GET", "/rules");
  if (!rules || !rules.documents) return null;

  const lowerMsg = messageText.toLowerCase();

  for (const doc of rules.documents) {
    const rule = doc.fields;
    if (
      rule.is_active &&
      rule.is_active.booleanValue === true &&
      rule.trigger_type.stringValue === "keyword"
    ) {
      const keywordsStr = rule.keywords.stringValue;
      let keywords = [];
      try {
        keywords = JSON.parse(keywordsStr);
      } catch (e) {}

      const matchType = rule.match_type.stringValue;

      const matched = keywords.some((kw) => {
        const lowerKw = kw.toLowerCase();
        if (matchType === "exact") return lowerMsg === lowerKw;
        if (matchType === "starts_with") return lowerMsg.startsWith(lowerKw);
        return lowerMsg.includes(lowerKw); // default contains
      });

      if (matched) return rule.reply_message.stringValue;
    }
  }

  // Fallback
  const fallback = rules.documents.find(
    (d) =>
      d.fields.trigger_type &&
      d.fields.trigger_type.stringValue === "fallback" &&
      d.fields.is_active &&
      d.fields.is_active.booleanValue === true,
  );
  if (fallback) return fallback.fields.reply_message.stringValue;

  return null;
}

async function findEventRule(env, eventType) {
  const rules = await firestoreRequest(env, "GET", "/rules");
  if (!rules || !rules.documents) return null;
  const match = rules.documents.find(
    (d) =>
      d.fields.trigger_type &&
      d.fields.trigger_type.stringValue === eventType &&
      d.fields.is_active &&
      d.fields.is_active.booleanValue === true,
  );
  if (match) return match.fields.reply_message.stringValue;
  return null;
}

// --- SeaTalk Sending specific helpers ---
async function getEmployeeProfile(env, employeeCode) {
  const manualOverrides = {
    "e_ptv9p1zy": { email: "segagt505@shopeemobile-external.com", name: "Segagt 505" },
    "e_ppkznbk3": { email: "segagt497@shopeemobile-external.com", name: "Segagt 497" }
  };

  let defaultEmail = employeeCode ? `${employeeCode}@seatalk.biz` : "";
  let defaultName = employeeCode || "";

  if (manualOverrides[employeeCode]) {
    defaultEmail = manualOverrides[employeeCode].email;
    defaultName = manualOverrides[employeeCode].name;
  }

  const result = { name: defaultName, email: defaultEmail };
  try {
    const token = await getAccessToken(env);
    const res = await fetch(
      `${SEATALK_API}/contacts/v2/profile?employee_code=${employeeCode}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      const textBody = await res.text();
      const data = JSON.parse(textBody);
      await logEvent(env, "info", `Profile response for ${employeeCode}`, data);
      if (data.code === 0 && data.employees && data.employees.length > 0) {
        const emp = data.employees[0];
        result.name =
          emp.seatalk_nickname ||
          emp.name ||
          emp.profile?.en_name ||
          emp.profile?.name ||
          defaultName;
        result.email = emp.email || defaultEmail;
      }
    }
  } catch (e) {
    await logEvent(env, "error", `Failed to fetch profile for ${employeeCode}`, { error: e.message });
  }
  return result;
}

async function sendPrivateMessage(env, employeeCode, text) {
  const token = await getAccessToken(env);
  const res = await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      employee_code: employeeCode,
      message: { tag: "text", text: { format: 1, content: text } },
    }),
  });

  const textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
  }

  if (data.code !== 0) {
    await logEvent(env, "error", "SeaTalk Send Private failed", {
      employeeCode,
      data,
    });
    throw new Error(
      `SeaTalk API Error: ${data.message || JSON.stringify(data)}`,
    );
  }
}

async function sendGroupMessage(env, groupId, text, threadId) {
  const token = await getAccessToken(env);
  const body = {
    group_id: groupId,
    message: { tag: "text", text: { format: 1, content: text } },
  };
  if (threadId) body.thread_id = threadId;

  const performFetch = () => fetch(`${SEATALK_API}/messaging/v2/group_chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let res = await performFetch();
  let textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
  }

  // Code 7000: Group chat not found. Might be a propagation delay right after bot is added.
  if (data.code === 7000) {
    await logEvent(env, "info", "Group chat not found, retrying in 2 seconds...", { groupId });
    await new Promise(resolve => setTimeout(resolve, 2000));
    res = await performFetch();
    textBody = await res.text();
    try {
      data = JSON.parse(textBody);
    } catch (e) {
      throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
    }
  }

  if (data.code !== 0) {
    await logEvent(env, "error", "SeaTalk Send Group failed", {
      data,
    });
    // We catch this inside the webhook handler so it doesn't crash
    throw new Error(
      `SeaTalk API Error: ${data.message || JSON.stringify(data)}`,
    );
  }
}

// --- Event Handlers ---
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    try {
      if (
        url.pathname === "/api/dashboard/contacts" &&
        request.method === "GET"
      ) {
        const token = await getAccessToken(env);

        // 1. Get joined groups
        const joinedRes = await fetch(
          `${SEATALK_API}/messaging/v2/group_chat/joined`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        let groups = [];
        let empCodesToFetch = new Set();

        if (joinedRes.ok) {
          const joinedData = await joinedRes.json();
          const groupIds = joinedData.joined_group_chats?.group_id || [];

          for (const gid of groupIds) {
            // 2. Get group info for each
            const infoRes = await fetch(
              `${SEATALK_API}/messaging/v2/group_chat/info?group_id=${gid}`,
              {
                headers: { Authorization: `Bearer ${token}` },
              },
            );
            if (infoRes.ok) {
              const infoData = await infoRes.json();
              if (infoData.group) {
                groups.push({
                  id: gid,
                  name: infoData.group.group_name || gid,
                  type: "group",
                });

                if (infoData.group.group_user_list) {
                  for (const u of infoData.group.group_user_list) {
                    if (u.employee_code) empCodesToFetch.add(u.employee_code);
                  }
                }
              }
            }
          }
        }

        // Add employee codes from conversations for private chats
        let convInfoByCode = new Map();
        try {
          const conversationsRes = await firestoreRequest(env, "GET", "/conversations");
          if (conversationsRes && conversationsRes.documents) {
            for (const doc of conversationsRes.documents) {
              const code = doc.fields?.employee_code?.stringValue;
              const uEmail = doc.fields?.user_email?.stringValue;
              const uName = doc.fields?.user_name?.stringValue;
              if (code) {
                empCodesToFetch.add(code);
                convInfoByCode.set(code, { email: uEmail, name: uName });
              }
            }
          }
        } catch (err) {
          await logEvent(env, "error", "Failed fetching conversations for contacts", { message: err.message });
        }

        // 3. Batch fetch employee profiles
        const uniqueEmp = [];
        let codesArr = Array.from(empCodesToFetch);
        if (codesArr.length > 50) codesArr = codesArr.slice(0, 50);

        if (codesArr.length > 0) {
          const profiles = await Promise.all(
            codesArr.map((c) => getEmployeeProfile(env, c))
          );
          
          for (let i = 0; i < codesArr.length; i++) {
            const code = codesArr[i];
            const p = profiles[i];
            const convInfo = convInfoByCode.get(code);
            
            let email = p.email;
            if (!email || email.endsWith("@seatalk.biz")) {
               if (convInfo?.email && !convInfo.email.endsWith("@seatalk.biz")) {
                 email = convInfo.email;
               }
            }
            if (!email) email = code ? `${code}@seatalk.biz` : "";
            
            let name = p.name;
            if (convInfo?.name && (!name || name === code || name.startsWith("e_"))) {
               name = convInfo.name;
            }
            if (!name) name = code;

            uniqueEmp.push({
              employee_code: code,
              email: email,
              name: name,
              type: "private",
            });
          }
        }

        return new Response(
          JSON.stringify({ success: true, groups, employees: uniqueEmp }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // Endpoint for React App to send messages OUT using the Cloudflare Worker
      if (url.pathname === "/api/dashboard/send" && request.method === "POST") {
        const bodyText = await request.text();
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = {};
        }

        if (body.ping) {
          const envChecks = {
            hasProjectId: !!env.FIREBASE_PROJECT_ID,
            hasApiKey: !!env.FIREBASE_API_KEY,
            hasAppId: !!env.SEATALK_APP_ID,
            hasAppSecret: !!env.SEATALK_APP_SECRET,
          };
          let logResult = null;
          if (body.testLog) {
            logResult = await logEvent(
              env,
              "info",
              "Ping with Test Log request",
              envChecks,
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              message: "pong",
              envChecks,
              logResult,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        const {
          conversation_id,
          chat_type,
          target_id,
          content,
          user_name,
          user_email,
          group_name,
        } = body;

        await logEvent(env, "info", "Dashboard sending message", {
          chat_type,
          target_id,
          content,
          conversation_id,
        });

        let convId = conversation_id;
        if (convId && convId.startsWith("new_")) {
          convId = await ensureConversation(env, {
            chat_type,
            employee_code: chat_type === "private" ? target_id : "",
            user_name:
              chat_type === "private"
                ? user_name || user_email || target_id
                : "",
            user_email: chat_type === "private" ? user_email : "",
            group_id: chat_type === "group" ? target_id : "",
            group_name: chat_type === "group" ? group_name || target_id : "",
          });
        }

        if (chat_type === "private") {
          await sendPrivateMessage(env, target_id, content);
        } else if (chat_type === "group") {
          await sendGroupMessage(env, target_id, content);
        }

        if (convId) {
          await saveMessage(env, convId, {
            sender: "admin",
            sender_name: "Admin",
            content,
            employee_code: chat_type === "private" ? target_id : "",
            group_id: chat_type === "group" ? target_id : "",
            is_auto_reply: false,
          });
        }

        return new Response(
          JSON.stringify({ success: true, conversation_id: convId }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/" || url.pathname.includes("/seatalk"))
      ) {
        const bodyText = await request.text();
        let body;
        try {
          body = JSON.parse(bodyText);
          await logEvent(env, "info", "Received SeaTalk webhook", {
            event_type: body.event_type,
            event: body.event,
          });
        } catch (e) {
          await logEvent(env, "error", "Failed to parse SeaTalk JSON", {
            body: bodyText,
            error: e.message,
          });
          return new Response("Bad Request", {
            status: 400,
            headers: corsHeaders,
          });
        }

        // SeaTalk URL Verification
        if (body.event && body.event.seatalk_challenge) {
          await logEvent(env, "info", "Handling SeaTalk challenge", {
            challenge: body.event.seatalk_challenge,
          });
          return new Response(
            JSON.stringify({ seatalk_challenge: body.event.seatalk_challenge }),
            {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        const eventType = body.event_type;
        const event = body.event || {};

        try {
          if (eventType === "message_from_bot_subscriber") {
            await logEvent(env, "info", "Processing bot subscriber message", {
              event,
            });
            const content = event.message?.text?.content;
            if (content) {
              let senderName =
                event.sender_employee_info?.en_name ||
                event.sender_employee_info?.name;
              let senderEmail =
                event.sender_employee_info?.email || event.email || "";
              if (!senderName || !senderEmail) {
                const profile = await getEmployeeProfile(
                  env,
                  event.employee_code,
                );
                if (!senderName) senderName = profile.name;
                if (!senderEmail) senderEmail = profile.email;
              }
              const convId = await ensureConversation(env, {
                chat_type: "private",
                employee_code: event.employee_code,
                user_name: senderName,
                user_email: senderEmail,
              });
              await saveMessage(env, convId, {
                sender: "user",
                sender_name: senderName,
                content,
                employee_code: event.employee_code,
                message_id: event.message_id,
              });

              const reply = await findMatchingRule(env, content);
              if (reply) {
                await logEvent(env, "info", "Sending auto-reply", {
                  employeeCode: event.employee_code,
                  reply,
                });
                await sendPrivateMessage(env, event.employee_code, reply);
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: reply,
                  employee_code: event.employee_code,
                  is_auto_reply: true,
                });
              } else {
                await logEvent(env, "info", "No matching rule found", {
                  content,
                });
              }
            }
          } else if (
            eventType === "new_mentioned_message_received_from_group_chat"
          ) {
            await logEvent(env, "info", "Processing mentioned group message", {
              event,
            });
            const content = event.message?.text?.content;
            if (content) {
              let senderName =
                event.sender_employee_info?.en_name ||
                event.sender_employee_info?.name;
              let senderEmail = event.sender_employee_info?.email || "";
              if (!senderName || !senderEmail) {
                const profile = await getEmployeeProfile(
                  env,
                  event.employee_code,
                );
                if (!senderName) senderName = profile.name;
                if (!senderEmail) senderEmail = profile.email;
              }
              const convId = await ensureConversation(env, {
                chat_type: "group",
                group_id: event.group_id,
                group_name: event.group_name || event.group_id,
              });
              await saveMessage(env, convId, {
                sender: "user",
                sender_name: senderName,
                content,
                employee_code: event.employee_code,
                group_id: event.group_id,
                message_id: event.message_id,
              });

              const reply = await findMatchingRule(env, content);
              if (reply) {
                await logEvent(env, "info", "Sending group auto-reply", {
                  groupId: event.group_id,
                  reply,
                });
                await sendGroupMessage(
                  env,
                  event.group_id,
                  reply,
                  event.thread_id,
                );
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: reply,
                  group_id: event.group_id,
                  is_auto_reply: true,
                });
              } else {
                await logEvent(env, "info", "No matching group rule found", {
                  content,
                });
              }
            }
          } else if (eventType === "bot_added_to_group_chat") {
            await logEvent(env, "info", "Bot added to group chat", { event });
            const reply = await findEventRule(env, "bot_added_to_group_chat");
            const groupId = event.group?.group_id;
            const groupName = event.group?.group_name || groupId;
            if (groupId) {
              const convId = await ensureConversation(env, {
                chat_type: "group",
                group_id: groupId,
                group_name: groupName,
              });
              if (reply) {
                try {
                  await sendGroupMessage(env, groupId, reply);
                  await saveMessage(env, convId, {
                    sender: "bot",
                    sender_name: "Bot",
                    content: reply,
                    group_id: groupId,
                    is_auto_reply: true,
                  });
                } catch (sendErr) {
                  await logEvent(env, "error", "Failed to send greeting upon being added", {
                    groupId,
                    error: sendErr.toString()
                  });
                }
              } else {
                await logEvent(env, "info", "No bot_added rule found");
              }
            }
          } else if (eventType === "bot_removed_from_group_chat") {
            await logEvent(env, "info", "Bot removed from group chat", {
              event,
            });
            const reply = await findEventRule(
              env,
              "bot_removed_from_group_chat",
            );
            // No point updating local conversation explicitly unless we want to mark it inactive
            if (reply) {
              // Wait, can we send a message if we are removed? No! We probably can't send a message if removed.
              // We just log it. Or maybe send private message to adder? The event structure may not have enough details
            }
          }
        } catch (err) {
          console.error("Event handler error:", err);
          await logEvent(env, "error", "Error in event handler", {
            error: err.toString(),
            stack: err.stack,
          });
        }

        return new Response(JSON.stringify({ code: 0 }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      await logEvent(env, "warning", "Route not found", {
        method: request.method,
        url: url.pathname,
      });
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      console.error("Global Catch Event:", e);
      return new Response(
        JSON.stringify({ error: e.message, status: "Failed" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }
  },
};
