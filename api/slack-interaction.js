import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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

  let payload;
  try {
    const params = new URLSearchParams(rawBody);
    payload = JSON.parse(params.get("payload"));
  } catch {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const userId = payload.user?.id;
  const action = payload.actions?.[0];
  const vote = action?.value;
  const ts = payload.message?.ts;
  const channelId = payload.channel?.id;
  const responseUrl = payload.response_url;

  if (!userId || !vote || !ts || !channelId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

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
