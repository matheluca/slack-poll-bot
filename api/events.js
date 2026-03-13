const AUTHORIZED_USERS = [
  "U03DBNN8AMP",
  "U04AANJD124",
  "U03CV5T75KQ",
  "U03CM7A8ZCP",
];

const CHANNEL_TEST = "C0ALDQ09TPW";

const CHANNEL_OPTIONS = [
  { label: "C1 - Connect", id: "C06BR6JNTD5" },
  { label: "C2 - Connect", id: "C06C63PCX6W" },
  { label: "C3 - Connect", id: "C06C3C1RGQ5" },
  { label: "Todos os grupos separados", id: "mix" },
  { label: "Geral", id: "C03D68VC2GK" },
];

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
      await publish(state.question, null, state.channelOption);
      await sendDM(dmChannel, "✅ Mensagem enviada!");
      conversations[userId] = { step: "idle" };
      return res.status(200).end();
    }
    if (text.toLowerCase() === "botões" || text.toLowerCase() === "botoes") {
      conversations[userId] = { ...state, step: "ask_options" };
      await sendDM(dmChannel, "Mande as opções separadas por *;*\nEx: 😄 Sim!; 😐 Ainda não!; 😞 Esqueci");
      return res.status(200).end();
    }
    await sendDM(dmChannel, "Por favor responda *botões* ou *simples*.");
    return res.status(200).end();
  }

  // PASSO 4 — recebe as opções
  if (state.step === "ask_options") {
    const options = text.split(";").map((o) => o.trim());
    await publish(state.question, options, state.channelOption);
    await sendDM(dmChannel, "✅ Enquete enviada!");
    conversations[userId] = { step: "idle" };
    return res.status(200).end();
  }

  return res.status(200).end();
}

async function publish(question, options, channelOption) {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  let targetChannels = [];
  if (channelOption.id === "mix") {
    targetChannels = ["C06BR6JNTD5", "C06C63PCX6W", "C06C3C1RGQ5"];
  } else {
    targetChannels = [channelOption.id];
  }

  const allChannels = [...new Set([CHANNEL_TEST, ...targetChannels])];

  for (const channel of allChannels) {
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
    console.log("PUBLISH RESPONSE:", JSON.stringify(data));

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
  const data = await response.json();
  console.log("SEND DM RESPONSE:", JSON.stringify(data));
  return data;
}
