# Bandly — Router Discovery

## Redirect — post-hoc only

React Native / Expo has no reliable way to prevent the first redirect
hop. Discovery uses `redirect: "follow"` and validates `response.url`
after the response (must remain on LAN + same host). The first hop
may reach the destination before rejection. No credentials are sent
(`credentials: 'omit'`), so no session data leaks.

This is NOT network-level isolation.

Correct wording: "Discovery rejects redirect results that end outside
the allowed local host." — NOT "prevents connections to external IPs."

## ReadableStream — no unbounded fallback

If `response.body.getReader` is unavailable, Discovery returns
`RESPONSE_STREAM_UNAVAILABLE` without reading the body. No fallback to
`arrayBuffer()`, `text()`, or `blob()`.

## Headers

No Cookie, Authorization, Referer, Origin, or custom headers.

## Content-Type allowlist

text/html, text/plain, text/xml, text/javascript, application/json,
application/xml, application/javascript.

## Size limit

1 MB default; enforced via Content-Length, then during streaming.

## Not stored

No raw body, no headers, no cookies, no tokens, no credentials, no
IMEI/IMSI/ICCID/MAC/SSID/phone/SMS, no APN names.

## References

- src/router-discovery/policy.ts
- src/router-discovery/safeRequest.ts
- src/router-discovery/sanitize.ts
