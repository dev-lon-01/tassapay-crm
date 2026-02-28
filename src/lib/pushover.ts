import https from "https";

/**
 * Sends a Pushover push notification to one or more user/group keys.
 * Emergency priority (2) requires retry + expire per Pushover API spec.
 */
export async function sendPushoverAlert(
  userKeys: string[],
  message: string,
  title: string,
  priority: number,
  sound: string
): Promise<void> {
  const token = process.env.PUSHOVER_APP_TOKEN;
  if (!token || !userKeys.length) return;

  for (const user of userKeys) {
    const body: Record<string, unknown> = { token, user, message, title, priority, sound };
    if (priority === 2) { body.retry = 60; body.expire = 3600; }

    const payload = JSON.stringify(body);
    await new Promise<void>((resolve) => {
      const req = https.request(
        {
          hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        },
        (res) => {
          res.resume(); // drain
          res.on("end", resolve);
        }
      );
      req.on("error", (err) => {
        console.error(`[Pushover] Failed to send to ${user}:`, err.message);
        resolve();
      });
      req.write(payload);
      req.end();
    });
  }
}
