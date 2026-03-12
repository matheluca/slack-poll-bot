import { createClient } from "redis";

export default async function handler(req, res) {
  // Responde imediatamente pro Slack (evita timeout)
  res.status(200).send("");

  const payload = JSON.parse(req.body.payload);
  const userId = payload.user.id;
  const userName = payload.user.name;
  const action = payload.actions[0];
  const vote = action.value;
  const ts = payload.message.ts;
  const channelId = payload.channel.id;

  const client = createClient({ url: "redis://default:OF9LXSzxVX7kWCXhKezSuLJ5cqxPemSi@redis-17590.crce196.sa-east-1-2.ec2.cloud.redislabs.com:17590" });
  await client.connect();

  const raw = await client.get(`poll:${ts}`);
  const poll = JSON.parse(raw);

  // Bloqueia voto duplicado
  if (poll.votes[userId]) {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: ts,
        text: `⚠️ <@${userId}> você já votou!`,
      }),
    });
    await client.disconnect();
    return;
  }

  // Registra voto
  poll.votes[userId] = vote;
  await client.set(`poll:${ts}`, JSON.stringify(poll));

  // Responde na thread
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

  await client.disconnect();
}
