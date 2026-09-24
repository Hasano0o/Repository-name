# Bandly — Security Gate Closure Report

> Baseline: PHASE 5G — commit `1a8dd16`
> Updated: PHASE 5I
> Status: DESIGN + PARTIAL IMPLEMENTATION

## Classification

- **PROVEN**      — verified by code + automated tests
- **TESTED**      — verified on real device / real environment
- **DESIGNED**    — design ready, implementation/QA pending
- **DOCUMENTED**  — accepted as known limitation
- **UNPROVEN**    — no evidence available

---

## Gate 1 — Discovery Credentials

### Current State (after PHASE 5I)

- `credentials: 'omit'` present in `safeRequest.ts`. **PROVEN (code)**
- Dev-only guard warns if the invariant is violated. **PROVEN (code)**
- React Native documentation: `credentials: 'omit'` marked as "not working
  as expected" for `fetch`. **DOCUMENTED (external, RN docs)**
- RN 0.86 community report: tested on iOS/Android, `'omit'` prevented
  cookie send/receive in tested scenarios. **TESTED (external, not Bandly)**
- Bandly device validation: **UNPROVEN**

### Status
**PARTIAL**

### Remaining Work

1. E2E device test using a local Node.js HTTP server that logs every
   received request header. Scenarios:
   - iOS, no prior cookie
   - iOS, prior cookie
   - Android, no prior cookie
   - Android, prior cookie
   - Redirect scenario (after Gate 2)
2. Publish results in this document.

### Residual Limitation

`credentials: 'omit'` is a **code-level invariant** enforced by the caller.
React Native's native layer (NSURLSession / OkHttp) is responsible for the
actual network behavior. Community evidence suggests RN 0.86 respects this
option, but this cannot replace device-level validation.
`response.headers.get('cookie')` is **not** a valid proof — it reads a
response header, not a request header.

---

## Gate 2 — Redirect

### Current State (after PHASE 5I)

- `response.redirected === true` → `REDIRECT_BLOCKED`. **PROVEN (code + test)**
- Post-hoc `response.url` check + LAN validation + same-host check remain
  as additional defense-in-depth. **PROVEN (code)**
- `lab/response.ts` mirrors RN semantics: any 3xx status → `redirected=true`.
  **PROVEN (code)**

### Status
**CLOSED for body consumption. LIMITATION for first-hop network.**

### What is Now Blocked

- Redirect body consumption: **BLOCKED**
- Cross-LAN final destination: **BLOCKED**
- Same-LAN different host: **BLOCKED**
- Same-LAN same host: **BLOCKED** (new in 5I)

### What Cannot Be Blocked

- **First-hop network request.** If a server responds with a 3xx, the first
  HTTP hop already reached the server before we inspect the response.
  React Native does not reliably support `redirect: 'manual'`.
  This is a documented limitation of JS `fetch` in React Native.

### Remaining Work

None for the current scope.

---

## Gate 3 — iOS Networking

### Current State (after PHASE 5I)

- `NSAllowsLocalNetworking: true`. **PROVEN (config)**
- `NSExceptionDomains.local` with `NSExceptionAllowsInsecureHTTPLoads`.
  **PROVEN (config)**
- `NSLocalNetworkUsageDescription` (bilingual AR/EN). **PROVEN (config, 5I)**
- `NSAllowsArbitraryLoads` intentionally **not** set. **DOCUMENTED**
- Local Network Permission state cannot be read from JS. **UNPROVEN**

### Status
**PARTIAL — config complete, device QA pending**

### Remaining Work

1. Device QA:
   - First fetch on iOS 17+ triggers Local Network popup
   - "Allow" path succeeds
   - "Deny" path fails silently (verify behavior)
   - Settings toggle behavior

### Residual Limitation

Local Network Permission denial cannot be detected directly from JS.
Indirect detection (comparing network state + fetch failures) is best-effort
only.

---

## Gate 3 — Android Networking

### Current State (after PHASE 5I)

- `base-config cleartextTrafficPermitted="false"`. **PROVEN (config)**
- `<domain-config>` allowlist: 12 explicit IP literals.
  - **PROVEN (config)**
  - Fixed: `192.168.0.0` → `192.168.0.1` (was a network address)
  - Added: `192.168.2.1`, `192.168.50.1`, `192.168.88.1`, `192.168.100.1`
  - Retained: `10.0.0.1`, `10.0.0.138`, `172.16.0.1`, `127.0.0.1`, `localhost`
  - Removed: `includeSubdomains="true"` from IP literals (no-op)
- **No** RFC1918 blanket allowlist. **DOCUMENTED**

### Status
**PARTIAL — config complete, device QA pending**

### Remaining Work

1. Device QA on Android 13+ per allowlist entry.
2. Confirm each entry permits HTTP to the expected router model.
3. Confirm non-listed RFC1918 addresses are rejected.

### Residual Limitation

Android cleartext allowlist is intentionally **narrower** than Policy's
`isLanHost`. Policy accepts all RFC1918; the Android Network Security
Configuration explicitly lists only common router defaults.
This is by design — cleartext exceptions must be minimal.

---

## Overall Production Security Gate

**Status: NOT READY**

### Conditions for READY

- [ ] Gate 1: E2E device QA executed (iOS + Android)
- [ ] Gate 3 iOS: Device QA executed
- [ ] Gate 3 Android: Device QA executed
- [ ] Device smoke test: Huawei real + ZTE real (basic discovery)
- [ ] Publish results in this document
- [ ] Publish `docs/router-lab.md`

### Summary Table

| Gate | Status | Blocker |
|---|---|---|
| 1 — Credentials | PARTIAL | Missing device QA |
| 2 — Redirect | CLOSED (partial-limitation) | First-hop is impossible to block in JS |
| 3 — iOS | PARTIAL | Missing device QA |
| 3 — Android | PARTIAL | Missing device QA |

**Verdict:** Any `PARTIAL` blocks Production Ready.

---

## Known Limitations (Persist After 5I)

| # | Limitation | Reason |
|---|---|---|
| 1 | First-hop redirect | RN has no reliable `redirect:'manual'` |
| 2 | `credentials:'omit'` runtime | Depends on NSURLSession / OkHttp |
| 3 | Local Network Permission denial | Cannot be read from JS directly |
| 4 | Firmware variations | Cannot be tested without physical devices |
| 5 | Android cleartext scope | Each router IP must be explicit |
| 6 | REAL Huawei/ZTE behavior | Cannot be proven via Lab alone |

These are documented, not fixed.

---

## Change Log

- PHASE 5I: added `redirected` early block; added iOS Local Network key;
  refined Android allowlist; added this document.
