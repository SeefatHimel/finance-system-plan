"""Conservative suggestions against the owner's active categories, never new categories."""

from collections import defaultdict
import re
import unicodedata

from apps.categories.models import Category


# Whole-label synonyms only: mixed purposes and trip/project names require a
# choice. Multiple matching saved categories are ambiguous, not a ranked guess.
ALIASES = (
    ("transport", "transportation"),
    ("food and dining", "food", "dining", "meals"),
    ("utilities and bills", "bills", "utilities", "utility bills"),
    ("health and medical", "medical", "healthcare", "medical expenses"),
    ("shopping and personal", "shopping", "clothing", "personal care"),
)


def normalized_name(value):
    return re.sub(
        r"\s+",
        " ",
        unicodedata.normalize("NFKC", value).casefold().replace("&", " and "),
    ).strip()


def suggest_categories(labels, categories):
    """Resolve each distinct label once; callers already scope categories by owner."""
    names = defaultdict(list)
    for category in categories:
        if category.is_active:
            names[normalized_name(category.name)].append(category)
    groups = {label: group for group in ALIASES for label in group}
    result = {}
    for label in labels:
        name = normalized_name(label)
        choices = names.get(name, [])
        method = "exact"
        if not choices and name in groups:
            method = "alias"
            choices = [
                category
                for alias in groups[name]
                for category in names.get(alias, [])
                if category.kind == Category.Kind.EXPENSE
            ]
        match = choices[0] if len(choices) == 1 else None
        result[label] = {
            "category": str(match.pk) if match else None,
            "label": match.name if match else "",
            "method": method
            if match
            else "ambiguous"
            if choices
            else "unmapped"
            if name
            else "empty",
        }
    return result
