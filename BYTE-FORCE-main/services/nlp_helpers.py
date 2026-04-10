"""
Optional spaCy POS tagging and noise heuristics. Falls back gracefully if model missing.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

# Filler / noise lemmas (lowercase)
NOISE_FILLERS = frozenset(
    {
        "please",
        "kindly",
        "just",
        "basically",
        "actually",
        "literally",
        "simply",
        "perhaps",
        "very",
        "quite",
        "really",
        "somewhat",
        "anyway",
        "essentially",
        "obviously",
        "clearly",
        "hopefully",
        "definitely",
        "absolutely",
        "certainly",
        "sort",
        "kind",
        "little",
        "pretty",
        "could",
        "would",
        "maybe",
        "perhaps",
        "um",
        "uh",
    }
)

PROTECT_POS = frozenset({"NOUN", "PROPN", "VERB", "ADJ", "NUM", "AUX"})

_nlp = None
_nlp_failed = False


def get_nlp():
    global _nlp, _nlp_failed
    if _nlp_failed:
        return None
    if _nlp is not None:
        return _nlp
    try:
        import spacy

        _nlp = spacy.load("en_core_web_sm")
        return _nlp
    except Exception:
        _nlp_failed = True
        return None


def word_tokens(text: str) -> list[str]:
    return re.findall(r"(?u)\b\w+\b", text.lower())


def word_frequencies(text: str) -> Counter[str]:
    return Counter(word_tokens(text))


def repetition_top(words: list[str], limit: int = 12) -> dict[str, int]:
    if not words:
        return {}
    c = Counter(words)
    return dict(c.most_common(limit))


def repetition_rate(words: list[str]) -> float:
    if len(words) <= 1:
        return 0.0
    return round(1.0 - (len(set(words)) / len(words)), 4)


def stopword_percentage(words: list[str]) -> float:
    if not words:
        return 0.0
    sw = sum(1 for w in words if w in ENGLISH_STOP_WORDS)
    return round(100.0 * sw / len(words), 2)


def detect_noise_words_in_text(text: str) -> list[str]:
    words = word_tokens(text)
    found = sorted({w for w in words if w in NOISE_FILLERS})
    return found


def noise_level_from_text(text: str) -> str:
    words = word_tokens(text)
    if not words:
        return "Low"
    n_noise = sum(1 for w in words if w in NOISE_FILLERS)
    pct = 100.0 * n_noise / len(words)
    if pct >= 12:
        return "High"
    if pct >= 5:
        return "Medium"
    return "Low"


def pos_counts_from_doc(text: str) -> dict[str, int]:
    nlp = get_nlp()
    out = {"noun": 0, "verb": 0, "adj": 0, "adv": 0, "other": 0}
    if not nlp or not text.strip():
        return out
    doc = nlp(text[:500000])
    for t in doc:
        if t.is_space or not t.text.strip():
            continue
        p = t.pos_
        if p == "NOUN" or p == "PROPN":
            out["noun"] += 1
        elif p == "VERB" or p == "AUX":
            out["verb"] += 1
        elif p == "ADJ":
            out["adj"] += 1
        elif p == "ADV":
            out["adv"] += 1
        else:
            out["other"] += 1
    return out


def word_pos_map(text: str) -> dict[str, str]:
    """Lowercase word -> coarse POS bucket for heatmap hints."""
    nlp = get_nlp()
    m: dict[str, str] = {}
    if not nlp or not text.strip():
        return m
    doc = nlp(text[:500000])
    for t in doc:
        w = t.text.lower()
        if not w or not w.isalnum():
            continue
        p = t.pos_
        if p in ("NOUN", "PROPN"):
            m[w] = "NOUN"
        elif p in ("VERB", "AUX"):
            m[w] = "VERB"
        elif p == "ADJ":
            m[w] = "ADJ"
        elif p == "ADV":
            m[w] = "ADV"
        elif w not in m:
            m[w] = p
    return m


def trim_with_pos_and_noise(text: str, encoding, fallback_trim_fn) -> str:
    """
    Drop filler tokens unless POS is protected (content words).
    Falls back to score-based trim if spaCy unavailable or result too short.
    """
    nlp = get_nlp()
    if not nlp or not text.strip():
        return fallback_trim_fn(text, encoding)

    doc = nlp(text[:500000])
    fragments: list[str] = []
    for t in doc:
        if t.is_space:
            fragments.append(t.text_with_ws)
            continue
        low = t.text.lower()
        if low in NOISE_FILLERS and t.pos_ not in PROTECT_POS:
            continue
        fragments.append(t.text_with_ws)

    result = re.sub(r"\s{2,}", " ", "".join(fragments))
    result = re.sub(r"\s([?.!,])", r"\1", result).strip()
    if not result or len(result) < max(8, len(text) * 0.12):
        return fallback_trim_fn(text, encoding)
    return result


def useful_vs_noise_counts(text: str) -> tuple[int, int]:
    words = word_tokens(text)
    if not words:
        return 0, 0
    noise = sum(1 for w in words if w in NOISE_FILLERS)
    useful = len(words) - noise
    return useful, noise


def efficiency_score(savings_pct: float, noise_level: str, repetition_rate_val: float) -> int:
    base = min(100, max(0, savings_pct * 1.2 + 40))
    if noise_level == "High":
        base -= 15
    elif noise_level == "Medium":
        base -= 7
    base -= min(20, repetition_rate_val * 50)
    return int(max(0, min(100, round(base))))
