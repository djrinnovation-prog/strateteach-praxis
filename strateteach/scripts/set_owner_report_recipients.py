#!/usr/bin/env python3
"""Configure the OWNER recipients for the scheduled owner reports — one command.

The hourly users+portfolio report, the daily 12:00 open-requests report, and the
daily 00:05 closed-requests report all go to the product owners over WhatsApp
(app/services/scheduled_reports.py). Delivery is strictly per-user: each owner's
number lives in their own notif prefs (users.phone + notif_prefs.whatsappTo), set
via db.set_whatsapp_recipient — no global recipient list.

This is a thin convenience wrapper that seeds the currently-joined sandbox owners
in one shot. Run inside the backend environment (DATABASE_URL set), from
python-backend/:

    python ../scripts/set_owner_report_recipients.py

Rafi's number is still pending — add it later with the per-user script:

    python ../scripts/set_whatsapp_recipient.py rafi +9725........

Reminder: the Twilio SANDBOX only delivers to numbers that first sent the join
code (e.g. "join edge-year") to the sandbox WhatsApp number. Dan's number has
joined; Yoav must join before he receives anything.
"""
from __future__ import annotations

import sys

from app import database as db

# username → E.164 WhatsApp number. Dan is both "dan" and the seeded "admin".
# Rafi is intentionally omitted until his number is known.
OWNER_NUMBERS = {
    "admin": "+972538821770",  # Dan (seeded super-admin account)
    "dan": "+972538821770",    # Dan
    "yoav": "+19179694093",    # Yoav
}


def main() -> int:
    any_set = False
    for username, phone in OWNER_NUMBERS.items():
        if not db.get_user(username):
            print(f"⏭  {username}: no such user — skipped")
            continue
        prefs = db.set_whatsapp_recipient(username, phone, all_alerts=True)
        any_set = True
        print(f"✅ {username}: WhatsApp recipient set → {prefs.get('whatsappTo')}")
    if not any_set:
        print("No matching owner users found. Nothing configured.")
        return 1
    print("\nDone. Reports stay dormant until the server's Twilio keys are set "
          "(TWILIO_SID / TWILIO_TOKEN / TWILIO_WHATSAPP_FROM).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
