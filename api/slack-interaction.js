import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const rawBody = await getRawBody(req);
  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload"));

  const userId = payload.user.id;
  const action = payload.actions[0];
  const blockId = action.block_id;
  const dmChannel = payload.channel.id;

  // Clique de seleção de canal no DM
  if (blockId === "channel_select") {
    res.status(200).end();
    const selected = CHANNEL_OPTIONS.find(c => c.id === action.value);
    if (selected && conversations[userId]) {
      conversations[userId] = { ...conversations[userId], step: "ask_type", channelOption: selected };
      await sendDMWithButtons(dmChannel, `Canal selecionado: *${selected.label}*\n\nCom botões ou mensagem simples?`, [
        { label: "Botões", value: "botoes" },
        { label: "Simples", value: "simples" },
      ], "type_select");
    }
    return;
  }

  // Clique de seleção de tipo no DM
  if (blockId === "type_select") {
    res.status(200).end();
    const state = conversations[userId];
    if (!state) return;

    if (action.value === "simples") {
      await publish(state.question, null, state.channelOption);
      await sendDM(dmChannel, "✅ Mensagem enviada!");
      conversations[userId] = { step: "idle" };
      return;
    }

    if (action.value === "botoes") {
      conversations[userId] = { ...state, step: "ask_options" };
      await sendDM(dmChannel, "Mande as opções separadas por *;*\nEx: 😄 Sim; 😐 Não; 😞 Talvez");
      return;
    }

    return;
  }

  // Clique de voto na enquete (fluxo original)
  const vote = action.value;
  const ts = payload.message.ts;
  const channelId = payload.channel.id;
  const responseUrl = payload.response_url;

  try {
    const poll = await redis.get(`poll:${ts}`);
    if (!poll) {
      res.status(200).end();
      return;
    }

    if (poll.votes && poll.votes[userId]) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          replace_original: false,
          text: "⚠️ Você já votou!",
        }),
      });
      res.status(200).end();
      return;
    }

    poll.votes[userId] = vote;
    await redis.set(`poll:${ts}`, poll);

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: ts,
        text: `<@${userId}> respondeu *${vote}*`,
      }),
    });

    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(200).end();
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

async function sendDMWithButtons(channel, text, options, blockId) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
        {
          type: "actions",
          block_id: blockId,
          elements: options.map((opt) => ({
            type: "button",
            text: { type: "plain_text", text: opt.label },
            value: opt.value,
            action_id: `${blockId}_${opt.value}`,
          })),
        },
      ],
    }),
  });
}

async function publish(question, options, channelOption) {
  let targetChannels = [];
  if (channelOption.id === "mix") {
    targetChannels = ["C06BR6JNTD5", "C06C63PCX6W", "C06C3C1RGQ5"];
  } else {
    targetChannels = [channelOption.id];
  }

  const allChannels = [...new Set([CHANNEL_TEST, ...targetChannels])];

  for (const channel of allChannels) {
    const messageText = `<!channel> *${question}*`;

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
