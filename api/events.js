const AUTHORIZED_USERS = [
  "U03DBNN8AMP",
  "U04AANJD124",
  "U03CV5T75KQ",
  "U03CM7A8ZCP",
];

const CHANNELS = ["C03DDF95GUB", "C0ALDQ09TPW"];

const conversations = {};

export default async function handler(req, res) {
  const body = req.body;

  // Verificação do Slack
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.status(200).end();

  const event = body.event;
  if (!event || event.type !== "message" || event.bot_id || event.subtype) return;

  const userId = event.user;
  const text = event.text?.trim();
  const dmChannel = event.channel;

  if (!AUTHORIZED_USERS.includes(userId)) {
    await sendDM(dmChannel, "⛔ Você não tem permissão para usar este comando.");
    return;
  }

  const state = conversations[userId] || { step: "idle" };

  // PASSO 1 — usuário manda a pergunta
  if (state.step === "idle") {
    conversations[userId] = { step: "ask_type", question: text };
    await sendDM(dmChannel, `✅ Pergunta recebida:\n*${text}*\n\nCom botões ou mensagem simples?\nResponda: *botões* ou *simples*`);
    return;
  }

  // PASSO 2 — usuário escolhe o tipo
  if (state.step === "ask_type") {
    if (text.toLowerCase() === "simples") {
      await publishToChannels(state.question, null);
      await sendDM(dmChannel, "✅ Mensagem enviada para os canais!");
      conversations[userId] = { step: "idle" };
      return;
    }

    if (text.toLowerCase() === "botões" || text.toLowerCase() === "botoes") {
      conversations[userId] = { ...state, step: "ask_options" };
      await sendDM(dmChannel, "Mande as opções separadas por vírgula.\nEx: 😄 Sim, 😐 Não, 😞 Talvez");
      return;
    }

    await sendDM(dmChannel, "Por favor responda *botões* ou *simples*.");
    return;
  }

  // PASSO 3 — usuário manda as opções
  if (state.step === "ask_options") {
    const options = text.split(",").map((o) => o.trim());
    await publishToChannels(state.question, options);
    await sendDM(dmChannel, "✅ Enquete enviada para os canais!");
    conversations[userId] = { step: "idle" };
    return;
}
}

async function sendDM(channel, text) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text }),
  });
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

    if (options && data.ts) {
      await redis.set(`poll:${data.ts}`, { question, options, votes: {} });
    }
  }
}
