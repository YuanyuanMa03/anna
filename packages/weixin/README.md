# Anna Weixin channel

Connect the desktop application to Weixin ClawBot through iLink QR login.
The host owns the channel, encrypted token, account allowlist, and message lifecycle.
The renderer receives the QR image and connection state, never the bot token.

This version handles text and server-provided voice transcripts. It does not download attachments.
Only the account identified by the QR confirmation can send tasks.
Remote messages use the same Anna host. A busy desktop returns a retry instruction.
Approval decisions remain in the desktop window.

Protocol reference: https://github.com/Tencent/openclaw-weixin
Community reference: https://github.com/twinsant/weixin-clawbot
The original Tencent license is retained in assets/licenses/Tencent-Weixin-MIT.txt.
