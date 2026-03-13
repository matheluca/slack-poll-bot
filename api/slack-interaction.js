import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CHANNELS = ["C03DDF95GUB", "C0ALDQ09TPW"];

export default async function handler(req, res) {
  const question = "Você já atualizou as OPs do seu funil para evitar irregularidade";
  const options = ["😄 Sim!", "😐 Ainda não!", "😞 Ed, estava esquecendo. Obrigado!"];

  for (const channel of CHANNELS) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
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
      }),
    });

    const data = await response.json();
    const ts = data.ts;

    await redis.set(`poll:${ts}`, { question, options, votes: {} });
  }

  res.status(200).json({ ok: true });
}
