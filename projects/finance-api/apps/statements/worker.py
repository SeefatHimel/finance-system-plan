"""One-shot PDF worker. Private bytes/password travel on stdin, never argv."""

import base64
import json
import logging
import sys

from .parser import MAX_BYTES, StatementParseError, extract_statement


def main():
    logging.disable(logging.CRITICAL)
    try:
        payload = json.loads(sys.stdin.buffer.read(MAX_BYTES * 2 + 4096))
        result = extract_statement(
            base64.b64decode(payload["pdf"], validate=True), payload.get("password", "")
        )
        print(json.dumps({"preview": result}))
    except StatementParseError as error:
        print(json.dumps({"error": error.message, "code": error.code}))
    except Exception:  # noqa: BLE001 -- isolate all private parser errors from the API
        print(
            json.dumps(
                {
                    "error": "The PDF could not be processed. Export a fresh statement and retry.",
                    "code": "invalid_pdf",
                }
            )
        )


if __name__ == "__main__":
    main()
