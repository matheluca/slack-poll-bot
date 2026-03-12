import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;
  const channelId = payload.channel.id;
  const responseUrl = payload.response_url;

  res.status(200).end();

  try {
    const poll = await redis.get(`poll:${ts}`);

    if (!poll) return;

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

  } catch (err) {
    console.error(err);
  }
}
