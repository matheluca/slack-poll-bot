import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CHANNELS = ["C0ALDQ09TPW", "C06BR6JNTD5", "C06C63PCX6W", "C06C3C1RGQ5"];

export default async function handler(req, res) {
  const question = "Você já atualizou as OPs do seu funil para evitar irregularidade?";
  const options = ["😄 Sim!", "😐 Ainda não!", "😞 Ed, estava esquecendo. Obrigado!"];
  const results = [];

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
    console.log(`Canal ${channel}:`, JSON.stringify(data));
    results.push({ channel, ok: data.ok, error: data.error });

    if (data.ts) {
      await redis.set(`poll:${data.ts}`, { question, options, votes: {} });
    }
  }

  res.status(200).json({ results });
}
