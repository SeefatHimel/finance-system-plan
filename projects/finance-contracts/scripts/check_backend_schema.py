#!/usr/bin/env python3
"""Gate backend schema changes and ensure published routes still exist."""

import json
import itertools
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "backend-schema-snapshot.json"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}
DOC_KEYS = {"description", "summary", "operationId", "tags", "example", "examples", "title"}


def shape(value):
    if isinstance(value, dict):
        return {key: shape(item) for key, item in sorted(value.items()) if key not in DOC_KEYS}
    if isinstance(value, list):
        return [shape(item) for item in value]
    return value


def route(path):
    return re.sub(r"\{[^{}]+\}", "{}", path)


def operations(schema):
    return {
        (route(path), method)
        for path, item in schema["paths"].items()
        for method in item if method in HTTP_METHODS
    }


def manifest(schema):
    return {
        "paths": {
            path: {
                method: shape(operation)
                for method, operation in methods.items() if method in HTTP_METHODS
            }
            for path, methods in sorted(schema["paths"].items())
        },
        "schemas": shape(schema.get("components", {}).get("schemas", {})),
    }


def differences(expected, actual, path="schema"):
    """Describe drift without dumping the full generated contract."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(expected.keys() | actual.keys()):
            location = f"{path}.{key}"
            if key not in expected:
                yield f"{location} was added: {actual[key]!r}"
            elif key not in actual:
                yield f"{location} was removed"
            else:
                yield from differences(expected[key], actual[key], location)
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            yield f"{path} has {len(actual)} items; snapshot has {len(expected)}"
        for index, (old_item, new_item) in enumerate(zip(expected, actual)):
            yield from differences(old_item, new_item, f"{path}[{index}]")
    elif expected != actual:
        yield f"{path} changed from {expected!r} to {actual!r}"


def main():
    generated = yaml.safe_load(Path(sys.argv[1]).read_text())
    published = yaml.safe_load((ROOT / "openapi.yaml").read_text())
    # The tiny health endpoint is intentionally outside the generated schema.
    undocumented = operations(published) - operations(generated) - {("/api/health/", "get")}
    if undocumented:
        raise SystemExit(f"Published operations absent from Django: {sorted(undocumented)}")
    actual = manifest(generated)
    if len(sys.argv) > 2 and sys.argv[2] == "--update":
        SNAPSHOT.write_text(json.dumps(actual, indent=2, sort_keys=True) + "\n")
        return
    expected = json.loads(SNAPSHOT.read_text())
    if actual != expected:
        changes = list(itertools.islice(differences(expected, actual), 51))
        shown = changes[:50]
        raise SystemExit(
            "Backend API schema changed:\n- " + "\n- ".join(shown)
            + ("\n- Further differences omitted." if len(changes) > 50 else "")
            + "\n"
            "Review the generated schema, update "
            "openapi.yaml and generated types as needed, then run "
            "check_backend_schema.py <generated-schema> --update."
        )


if __name__ == "__main__":
    main()
