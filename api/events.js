import crypto from "crypto";

const conversations = {};

export const config = {
  maxDuration: 30,
  api: { bodyParser: false },
};

function getAuthorizedUsers() {
  return (process.env.AUTHORIZED_USERS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

function getChannelOptions() {
  try {
    return JSON.parse(process.env.CHANNEL_OPTIONS || "[]");
  } catch {
    return [];
  }
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySlackSignature(req, rawBody) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (!signingSecret || !timestamp || !slackSignature) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(sigBase).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(slackSignature)
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const rawBody = await getRawBody(req);

  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event || event.type !== "message" || event.bot_id || event.subtype) {
    return res.status(200).end();
  }

  const AUTHORIZED_USERS = getAuthorizedUsers();
  const CHANNEL_OPTIONS = getChannelOptions();
  const CHANNEL_TEST = process.env.CHANNEL_TEST || "";

  const userId = event.user;
  const text = event.text?.trim();
  const dmChannel = event.channel;

  if (!AUTHORIZED_USERS.includes(userId)) {
    return res.status(200).end();
  }

  const state = conversations[userId] || { step: "idle" };

  // CANCELAR — funciona em qualquer etapa
  if (text.toLowerCase() === "cancelar" && state.step !== "idle") {
    conversations[userId] = { step: "idle" };
    await sendDM(dmChannel, "❌ Enquete cancelada. Mande uma nova pergunta quando quiser.");
    return res.status(200).end();
  }

  // PASSO 1 — recebe a pergunta
  if (state.step === "idle") {
    conversations[userId] = { step: "ask_channel", question: text };
    const optionsList = CHANNEL_OPTIONS.map((c, i) => `*${i + 1}*. ${c.label}`).join("\n");
    await sendDM(dmChannel, `✅ Pergunta recebida:\n*${text}*\n\nPara qual canal deseja enviar?\n${optionsList}\n\nResponda com o número.`);
    return res.status(200).end();
  }

  // PASSO 2 — escolhe o canal
  if (state.step === "ask_channel") {
    const index = parseInt(text) - 1;
    if (isNaN(index) || index < 0 || index >= CHANNEL_OPTIONS.length) {
      const optionsList = CHANNEL_OPTIONS.map((c, i) => `*${i + 1}*. ${c.label}`).join("\n");
      await sendDM(dmChannel, `Por favor responda com um número de 1 a ${CHANNEL_OPTIONS.length}.\n${optionsList}`);
      return res.status(200).end();
    }
    const selected = CHANNEL_OPTIONS[index];
    conversations[userId] = { ...state, step: "ask_type", channelOption: selected };
    await sendDM(dmChannel, `Canal selecionado: *${selected.label}*\n\nCom botões ou mensagem simples?\nResponda: *botões* ou *simples*`);
    return res.status(200).end();
  }

  // PASSO 3 — escolhe o tipo
  if (state.step === "ask_type") {
    if (text.toLowerCase() === "simples") {
      await publish(state.question, null, state.channelOption, dmChannel, CHANNEL_TEST);
      await sendDM(dmChannel, "✅ Mensagem enviada!");
      conversations[userId] = { step: "idle" };
      return res.status(200).end();
    }
    if (text.toLowerCase() === "botões" || text.toLowerCase() === "botoes") {
      conversations[userId] = { ...state, step: "ask_options" };
      await sendDM(dmChannel, "Mande as opções separadas por ponto e vírgula (;).\nEx: 😄 Sim; 😐 Não; 😞 Talvez");
      return res.status(200).end();
    }
    await sendDM(dmChannel, "Por favor responda *botões* ou *simples*.");
    return res.status(200).end();
  }

  // PASSO 4 — recebe as opções
  if (state.step === "ask_options") {
    const options = text.split(";").map((o) => o.trim());
    await publish(state.question, options, state.channelOption, dmChannel, CHANNEL_TEST);
    await sendDM(dmChannel, "✅ Enquete enviada!");
    conversations[userId] = { step: "idle" };
    return res.status(200).end();
  }

  return res.status(200).end();
}

async function publish(question, options, channelOption, dmChannel, channelTest) {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const mixChannels = (process.env.MIX_CHANNELS || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  let targetChannels = [];
  if (channelOption.id === "mix") {
    targetChannels = mixChannels;
  } else {
    targetChannels = [channelOption.id];
  }

  const allChannels = [...new Set([channelTest, ...targetChannels].filter(Boolean))];
  const CHANNEL_OPTIONS = getChannelOptions();

  for (const channel of allChannels) {
    const channelName = CHANNEL_OPTIONS.find((c) => c.id === channel)?.label || "canal";
    const messageText = `<!here> *${question}*`;

    const body = options
      ? {
          channel,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: messageText },
            },
            {
              type: "actions",
              elements: options.map((opt) => ({
                type: "button",
                text: { type: "plain_text", text: opt },
                action_id: `vote_${opt}`,
                value: opt,
              })),
            },
          ],
        }
      : { channel, text: messageText };

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (options && data.ts) {
      await redis.set(`poll:${data.ts}`, { question, options, votes: {} });
    }
  }
}

async function sendDM(channel, text) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  return response.json();
}
