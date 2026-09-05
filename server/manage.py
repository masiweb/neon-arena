from __future__ import annotations

import argparse
import json

from .database import AccountError, Database


def main() -> None:
    parser = argparse.ArgumentParser(description="Neon Arena administration")
    parser.add_argument("command", choices=["promote-admin"])
    parser.add_argument("--email", required=True)
    parser.add_argument("--database")
    args = parser.parse_args()
    database = Database(args.database)
    try:
        if args.command == "promote-admin":
            user = database.promote_admin(args.email)
            print(json.dumps({"ok": True, "id": user["id"], "email": user["email"], "username": user["username"]}, ensure_ascii=False))
    except AccountError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
