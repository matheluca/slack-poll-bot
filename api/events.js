const AUTHORIZED_USERS = [
  "U03DBNN8AMP",
  "U04AANJD124",
  "U03CV5T75KQ",
  "U03CM7A8ZCP",
];

const CHANNELS = ["C0ALDQ09TPW"];

const conversations = {};

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  const body = req.body;

  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body.event;
  if (!event || event.type !== "message" || event.bot_id || event.subtype) {
    return res.status(200).end();
  }

  const userId = event.user;
  const text = event.text?.trim();
  const dmChannel = event.channel;

  if (!AUTHORIZED_USERS.includes(userId)) {
    return res.status(200).end();
  }

  const state = conversations[userId] || { step: "idle" };

  if (state.step === "idle") {
    conversations[userId] = { step: "ask_type", question: text };
    await sendDM(dmChannel, `✅ Pergunta recebida:\n*${text}*\n\nCom botões ou mensagem simples?\nResponda: *botões* ou *simples*`);
    return res.status(200).end();
  }

  if (state.step === "ask_type") {
    if (text.toLowerCase() === "simples") {
      await publishToChannels(state.question, null);
      await sendDM(dmChannel, "✅ Mensagem enviada para os canais!");
      conversations[userId] = { step: "idle" };
      return res.status(200).end();
    }
    if (text.toLowerCase() === "botões" || text.toLowerCase() === "botoes") {
      conversations[userId] = { ...state, step: "ask_options" };
      await sendDM(dmChannel, "Mande as opções separadas por vírgula.\nEx: 😄 Sim, 😐 Não, 😞 Talvez");
      return res.status(200).end();
    }
    await sendDM(dmChannel, "Por favor responda *botões* ou *simples*.");
    return res.status(200).end();
  }

  if (state.step === "ask_options") {
    const options = text.split(",").map((o) => o.trim());
    await publishToChannels(state.question, options);
    await sendDM(dmChannel, "✅ Enquete enviada para os canais!");
    conversations[userId] = { step: "idle" };
    return res.status(200).end();
  }

  return res.status(200).end();
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
  const data = await response.json();
  console.log("SEND DM RESPONSE:", JSON.stringify(data));
  return data;
}

async function publishToChannels(question, options) {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  for (const channel of CHANNELS) {
    const body = options
      ? {
          channel,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*${question}*` },
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
      : { channel, text: question };

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("PUBLISH RESPONSE:", JSON.stringify(data));

    if (options && data.ts) {
      await redis.set(`poll:${data.ts}`, { question, options, votes: {} });
    }
  }
}
