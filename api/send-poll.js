import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  const question = "Como está seu humor hoje?";
  const options = ["😄 Ótimo", "😐 Ok", "😞 Ruim"];

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: process.env.SLACK_CHANNEL_ID,
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

  await db.collection("polls").doc(ts).set({
    question,
    options,
    votes: {},
    createdAt: new Date().toISOString(),
  });

  res.status(200).json({ ok: true, ts });
}
