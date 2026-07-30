# ALGO770 — Production Readiness Review (PRR)

> The gate between "an MVP that works" and "a system you can sell to paying customers."
> Work through it; nothing ships to a customer with an open ⛔ in the **Production Gate** section.

**Product model:** Self-hosted per customer — each customer runs their own isolated install (own server, own DB, own keys).
**Custody model:** Non-custodial — the customer always holds their own exchange API keys (browser-only). We never custody funds or keys. *This is a deliberate security + liability decision and a core product principle.*

**Status legend:** ✅ done · 🟡 partial · ⛔ missing · ➖ not applicable to this model

---

## 0. What "self-hosted per customer" changes

Because every customer is a separate, single-tenant install, several heavyweight items **drop away or simplify**:

- **Row-Level Security / multi-tenancy** → ➖ not needed. One install = one organization. We still enforce *per-user ownership* inside an install (a user can't read another user's data).
- **Tenant isolation** → achieved by separate installs, not by DB policy.
- **Blue/green, complex orchestration** → optional; a simple versioned redeploy + rollback is enough per install.

What still fully applies per install: **auth, RBAC, secrets, audit trail, encryption, backups, monitoring, logging, rate limiting, data integrity.**

---

## 1. Authentication
| Item | Status | Next action |
|---|---|---|
| Login | ✅ | `/auth/login`, JWT bearer, hashed passwords |
| Logout | 🟡 | Add server-side token revocation / short-lived tokens |
| Password reset | ✅ | Admin reset link; emailed automatically when SMTP + user email are set |
| Email verification | ⛔ | Defer until an email provider is wired |
| Session management | 🟡 | Move to short access token + refresh token |
| Remember me | 🟡 | Tie to refresh-token lifetime |
| MFA / 2FA (TOTP) | ⛔ | Add optional TOTP for admin accounts |
| **Test:** token expiration | 🟡 | Verify expiry enforced + clean 401 |
| **Test:** refresh-token rotation | ⛔ | Rotate on use, revoke on reuse |
| **Test:** account lockout | ⛔ | Lock after N failed attempts + backoff |

## 2. Authorization
| Item | Status | Next action |
|---|---|---|
| RBAC (admin / user) | 🟡 | Enforce `role` on every protected route |
| Permissions matrix | ⛔ | Document which role hits which endpoint |
| Admin/User separation | 🟡 | Admin-only: user mgmt, settings, withdrawals config |
| API authorization | 🟡 | Per-route dependency checks |
| **Test:** user can't read another user's data | ⛔ | Ownership check on every record query |
| **Test:** protected endpoints | ⛔ | Add a route-by-route auth test |

## 3. Database Security
| Item | Status | Next action |
|---|---|---|
| Row-Level Security | ➖ | N/A (single-tenant); use ownership checks |
| Encryption at rest | 🟡 | Encrypt any stored secret; rely on disk encryption for the rest |
| Encryption in transit | ✅ | Caddy auto-HTTPS (Let's Encrypt) |
| Audit trail | ⛔ | Append-only log: who changed what, when |
| **Test:** secrets not stored in DB | ✅ | Exchange keys are browser-only, sent as transient headers; never persisted |

## 4. API Architecture
| Item | Status | Next action |
|---|---|---|
| Versioning | 🟡 | Additive `/v1` mount (all routes served at current path AND under `/v1`); cut the client over later |
| Input validation | ✅ | Pydantic models on requests |
| Output validation | 🟡 | Response models on key routes |
| Error handling | 🟡 | Uniform error envelope + codes |
| Idempotency | ⛔ | Idempotency keys on money-moving POSTs |
| Rate limiting | 🟡 | In-process per-IP limits (login 10/min, general 240/min); move to shared store if scaled |
| API documentation | ✅ | FastAPI `/docs` (lock behind auth in prod) |

## 5. Queue & Async Processing
| Item | Status | Next action |
|---|---|---|
| Job queue | 🟡 | Backtests run in-process; move to a durable queue |
| Retry logic | ⛔ | Retry transient data-fetch failures |
| Dead-letter queue | ⛔ | Park permanently failed jobs for inspection |
| Uses: backtests, signals, notifications | 🟡 | Run heavy work off the request thread |
| **Test:** job failure / queue down | ⛔ | Define behavior + alert |

## 6. Notification System
| Item | Status | Next action |
|---|---|---|
| Email | ✅ | Provider-agnostic SMTP sender (Resend/SendGrid/Mailgun/Gmail); reset emails + test endpoint |
| SMS | ⛔ | Optional; needs a provider |
| Push | ⛔ | Optional |
| In-app | 🟡 | Activity feed exists |
| Telegram | ✅ | Bot channel built |
| Templates / retry / delivery status | ⛔ | Add once a provider is chosen |

## 7. Logging
| Item | Status | Next action |
|---|---|---|
| Application logs | ✅ | Structured JSON logs (`observability.py`) |
| API logs | ✅ | Per-request method/path/status/latency line |
| Security logs | 🟡 | Auth events in audit_log; merge into log stream |
| Correlation ID | ✅ | X-Request-ID generated, echoed, threaded through logs |
| Error severity levels | ✅ | Standard logging levels |

## 8. Monitoring & Observability
| Item | Status | Next action |
|---|---|---|
| Uptime monitoring | 🟡 | Point UptimeRobot/BetterStack at `/healthz` (no code needed) |
| Error monitoring | 🟡 | Sentry wired, dormant until `SENTRY_DSN` is set |
| Performance monitoring | 🟡 | Per-request latency in logs; Sentry traces via `SENTRY_TRACES_SAMPLE_RATE` |
| Alerting / dashboards / SLA | ⛔ | Configure alerts in Sentry/uptime tool once connected |

## 9. File Management
| Item | Status | Next action |
|---|---|---|
| Secure storage | ➖ | Minimal file handling today |
| Signed URLs | ➖ | N/A unless we add uploads |
| Virus scanning | ➖ | N/A unless we add uploads |
| CSV/PDF export | ✅ | Exists |
| File size / type limits | 🟡 | Enforce if uploads are added |

## 10. Performance
| Item | Status | Next action |
|---|---|---|
| Backend caching | ⛔ | Cache market data + dashboard summaries |
| Query optimization / indexes | 🟡 | Add indexes on hot columns |
| Frontend lazy loading / code splitting | 🟡 | Route-level code splitting |
| Asset compression | 🟡 | nginx gzip/brotli |
| Load / stress test | ⛔ | Baseline before launch |

## 11. Data Integrity
| Item | Status | Next action |
|---|---|---|
| Transactions | 🟡 | Wrap multi-step writes |
| Constraints / Foreign keys | 🟡 | Audit schema for FKs + NOT NULL |
| Duplicate prevention | 🟡 | Unique constraints where needed |
| Rollback / consistency | 🟡 | Verify failure paths roll back |

## 12. Backup & Disaster Recovery
| Item | Status | Next action |
|---|---|---|
| Automatic backups | 🟡 | `scripts/db-backup.sh` (gzip dump + prune); add to cron |
| Restore procedure | 🟡 | `scripts/db-restore.sh`; run a restore drill |
| RPO / RTO defined | ⛔ | Set targets (e.g. RPO 24h, RTO 1h) |
| Recovery testing | ⛔ | Periodic restore drill |

## 13. Infrastructure & DevOps
| Item | Status | Next action |
|---|---|---|
| CI/CD | 🟡 | Cron pull today; move to a real pipeline |
| Infrastructure as Code | 🟡 | `docker-compose` + `server-setup.sh` |
| Environment separation | ⛔ | Add a staging install |
| Deployment rollback | ⛔ | Tag releases; one-command rollback |
| Blue/green | ➖ | Optional per install |

## 14. Secrets Management
| Item | Status | Next action |
|---|---|---|
| API keys | ✅ | Customer exchange keys browser-only (non-custodial); only server secrets in `.env` |
| DB credentials | 🟡 | Per-install generated, not shared |
| OAuth secrets | ➖ | N/A today |
| Secrets not in Git | ✅ | `.gitignore` covers `.env` |
| Rotation policy | ⛔ | Document + script rotation |

## 15. Compliance & Audit
| Item | Status | Next action |
|---|---|---|
| Audit logs | ⛔ | Tie to #3 audit trail |
| Data retention | ⛔ | Define retention windows |
| GDPR / privacy | ✅ | Self-service data export + account deletion (Settings → Your data) |
| **Test:** who changed what, when | ⛔ | Queryable from audit log |
| **Test:** export / delete account | ✅ | `GET /auth/me/export`, `POST /auth/me/delete` (password-confirmed; last-admin protected) |

---

## 🚦 Production Gate — "won't go live without it"

These must be ✅ before any paying customer is onboarded:

**Security:** Authentication · Authorization (RBAC) · ownership checks · Encryption (transit ✅ / secrets) · Secrets management · account lockout
**Reliability:** durable job handling · retry logic · uptime + error monitoring · structured logging
**Data:** automatic backups + tested restore · audit trail · transactions
**DevOps:** versioned releases · staging · one-command rollback
**Legal/Product:** Terms + disclaimer 🟡 drafted in `/legal` + in-app risk acknowledgment (lawyer review pending) · non-custodial ✅ confirmed · GDPR export/delete ✅

> Not legal advice — but selling software that helps people trade carries real liability. The non-custodial design is your biggest protection; pair it with clear risk disclaimers and terms before charging anyone.

---

## Roadmap — both tracks in parallel

**Security track (the gate)**
1. Auth + RBAC foundation: admin/user separation, route enforcement, account lockout, ownership checks
2. Audit trail + security logging (who/what/when)
3. Secrets + backups: nightly DB backup, restore drill, rotation docs
4. Rate limiting + API versioning + uniform errors
5. Durable jobs (queue + retry) for backtests/signals
6. Monitoring (Sentry + uptime) — needs your accounts
7. GDPR export/delete + retention + Terms/disclaimer

**UI track (port from your original Replit client → live, single-origin)**
1. Constellation home (`landing.tsx`)
2. Scanner with trend-history chart (`signals.tsx`)
3. Backtest engine + run detail (`runs.tsx`, `run-detail.tsx`)
4. Profit engine redesign (`profit.tsx`) + withdrawal (whitelisted, PIN, double-confirm)
5. Strategy lab (explanations, indicators, templates, lock)
6. Exchange (browser-only keys) + Telegram + Settings/Users
7. Activity as a slide-out drawer

## Needs your decision / account
- ✅ Email — code shipped; set `SMTP_*` to activate (provider's choice)
- ✅ Error monitoring — code shipped; paste `SENTRY_DSN` to activate; point an uptime monitor at `/healthz`
- ✅ Terms + risk disclaimer — drafted in `/legal` (lawyer review + fill `[brackets]`)
- 🟡 Withdrawal flow built (guarded: in-app whitelisted address + typed-WITHDRAW + confirm + audit). To use it, each customer sets their whitelisted address in-app **and** enables withdrawal permission + an address whitelist on the exchange itself. **Test on testnet before going live.**
