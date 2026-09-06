from __future__ import annotations

import argparse
import json
import sys

from .database import AccountError, Database


def main() -> None:
    parser = argparse.ArgumentParser(description="Neon Arena administration")
    parser.add_argument("command", choices=["promote-admin", "create-admin"])
    parser.add_argument("--email", required=True)
    parser.add_argument("--username")
    parser.add_argument("--password-stdin", action="store_true")
    parser.add_argument("--no-force-password-change", action="store_true")
    parser.add_argument("--database")
    args = parser.parse_args()
    database = Database(args.database)
    try:
        if args.command == "promote-admin":
            user = database.promote_admin(args.email)
            print(json.dumps({"ok": True, "id": user["id"], "email": user["email"], "username": user["username"]}, ensure_ascii=False))
        elif args.command == "create-admin":
            if not args.username:
                parser.error("create-admin requires --username")
            if not args.password_stdin:
                parser.error("create-admin requires --password-stdin so the password is not stored in shell history")
            password = sys.stdin.read().rstrip("\r\n")
            if not password:
                parser.error("no password was received on stdin")
            user = database.create_admin(
                args.email,
                args.username,
                password,
                force_password_change=not args.no_force_password_change,
            )
            print(json.dumps({
                "ok": True,
                "id": user["id"],
                "email": user["email"],
                "username": user["username"],
                "mustChangePassword": user["mustChangePassword"],
            }, ensure_ascii=False))
    except AccountError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
