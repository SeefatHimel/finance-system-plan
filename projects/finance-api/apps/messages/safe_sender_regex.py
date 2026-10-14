"""A deliberately small, linear-time subset for untrusted sender patterns."""

import re


def compile_sender_pattern(pattern: str):
    # Sender IDs are short. Quantifiers, groups, alternation and backreferences
    # are unnecessary here and can create catastrophic backtracking in re.
    if len(pattern) > 128:
        raise ValueError("Use at most 128 characters, without groups, repeats, or alternatives")
    escaped = False
    in_class = False
    for char in pattern:
        if escaped:
            if char.isdigit():
                raise ValueError("Backreferences are not allowed in sender patterns")
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "[" and not in_class:
            in_class = True
        elif char == "]" and in_class:
            in_class = False
        elif char in "*+?{}()|" and not in_class:
            raise ValueError("Use at most 128 characters, without groups, repeats, or alternatives")
    return re.compile(pattern, flags=re.IGNORECASE)


def sender_pattern_matches(pattern: str, sender: str) -> bool:
    if len(sender) > 256:
        return False
    try:
        return compile_sender_pattern(pattern).search(sender) is not None
    except (ValueError, re.error):
        # Older stored rules are subject to the same safety restriction.
        return False
