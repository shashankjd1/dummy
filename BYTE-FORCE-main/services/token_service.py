"""
Token counting, TF-IDF scoring, smart trimming, and analyze/compare helpers.
"""
from __future__ import annotations

import re
import string
from typing import Any

import tiktoken
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS

from utils.constants import MODEL_PRICING


def calculate_cost(token_count: int, model: str) -> float:
    """USD input cost for token_count at model's input price (per 1M tokens)."""
    if model not in MODEL_PRICING:
        raise ValueError(f"Unknown model: {model}")
    price_per_million = MODEL_PRICING[model]["input"]
    return (token_count / 1_000_000) * price_per_million


def cost_per_1k_tokens(token_count: int, model: str) -> float:
    """Cost attributed to this many input tokens, normalized per 1K tokens."""
    if token_count <= 0:
        return 0.0
    total = calculate_cost(token_count, model)
    return (total / token_count) * 1000


def get_encoding(model: str):
    try:
        return tiktoken.encoding_for_model(model)
    except Exception:
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str, model: str) -> int:
    enc = get_encoding(model)
    return len(enc.encode(text))


def compute_scores(prompt_text: str, encoding) -> list[dict]:
    word_scores: dict[str, float] = {}
    try:
        vec = TfidfVectorizer(stop_words="english", token_pattern=r"(?u)\b\w+\b")
        tfidf_matrix = vec.fit_transform([prompt_text])
        feature_names = vec.get_feature_names_out()
        scores_arr = tfidf_matrix.toarray()[0]
        word_scores = dict(zip(feature_names, scores_arr))
    except ValueError:
        pass

    token_ids = encoding.encode(prompt_text)
    token_data = []

    for tid in token_ids:
        token_str = encoding.decode([tid])
        token_clean = token_str.strip().lower()

        if not token_clean or all(c in string.punctuation + " \t\n" for c in token_clean):
            score = 0.0
        elif token_clean in ENGLISH_STOP_WORDS:
            score = 0.08
        else:
            matched_score = None
            for word, s in word_scores.items():
                if word == token_clean or word in token_clean or token_clean in word:
                    matched_score = s
                    break

            if matched_score is not None:
                score = min(1.0, 0.40 + matched_score * 1.2)
            else:
                score = 0.75

        token_data.append({"id": tid, "text": token_str, "score": round(score, 4)})

    return token_data


def trim_prompt_smart(text: str, encoding) -> str:
    try:
        token_data = compute_scores(text, encoding)
    except Exception as e:
        print("ERROR in compute_scores:", e)
        return text

    kept_tokens = []
    for token in token_data:
        try:
            score = token.get("score", 0)
            word = token.get("text", "")
            if not word:
                continue
            if score >= 0.25:
                kept_tokens.append(word)
            else:
                if word.lower() in {"to", "for", "and", "or", "if", "in", "on"}:
                    kept_tokens.append(word)
        except Exception as e:
            print("Token error:", e)
            continue

    trimmed = "".join(kept_tokens)
    trimmed = re.sub(r"\s{2,}", " ", trimmed)
    trimmed = re.sub(r"\s([?.!,])", r"\1", trimmed)
    trimmed = trimmed.strip()

    if not trimmed or len(trimmed) < 5:
        return text
    return trimmed


def top_tfidf_terms(prompt_text: str, max_terms: int = 15) -> list[dict[str, Any]]:
    """Word-level TF-IDF weights for single-document summary (report / export)."""
    try:
        vec = TfidfVectorizer(stop_words="english", token_pattern=r"(?u)\b\w+\b")
        tfidf_matrix = vec.fit_transform([prompt_text])
        feature_names = vec.get_feature_names_out()
        scores_arr = tfidf_matrix.toarray()[0]
        pairs = list(zip(feature_names, scores_arr))
        pairs.sort(key=lambda x: x[1], reverse=True)
        return [{"term": t, "score": round(float(s), 6)} for t, s in pairs[:max_terms] if s > 0]
    except ValueError:
        return []


def run_analyze(prompt: str, model: str) -> dict[str, Any]:
    """
    Full analysis: token counts, trimming, costs, heatmap token_data, TF-IDF terms.
    """
    if model not in MODEL_PRICING:
        raise ValueError(f"Unknown model: {model}")

    encoding = get_encoding(model)
    original_tokens = len(encoding.encode(prompt))
    trimmed_prompt = trim_prompt_smart(prompt, encoding)
    trimmed_tokens = len(encoding.encode(trimmed_prompt))

    cost_original = calculate_cost(original_tokens, model)
    cost_trimmed = calculate_cost(trimmed_tokens, model)
    saved_tokens = original_tokens - trimmed_tokens
    savings_pct = (saved_tokens / original_tokens * 100) if original_tokens > 0 else 0
    token_data = compute_scores(prompt, encoding)
    tfidf_top = top_tfidf_terms(prompt)

    return {
        "prompt": prompt,
        "original_tokens": original_tokens,
        "trimmed_tokens": trimmed_tokens,
        "saved_tokens": saved_tokens,
        "savings_percentage": savings_pct,
        "cost_original_usd": cost_original,
        "cost_trimmed_usd": cost_trimmed,
        "model": model,
        "trimmed_prompt": trimmed_prompt,
        "token_data": token_data,
        "tfidf_top_terms": tfidf_top,
    }


def run_compare(prompt_a: str, prompt_b: str, model: str) -> dict[str, Any]:
    if model not in MODEL_PRICING:
        raise ValueError(f"Unknown model: {model}")

    t_a = count_tokens(prompt_a, model)
    t_b = count_tokens(prompt_b, model)
    cost_a = calculate_cost(t_a, model)
    cost_b = calculate_cost(t_b, model)
    per_1k_a = cost_per_1k_tokens(t_a, model)
    per_1k_b = cost_per_1k_tokens(t_b, model)

    if t_a < t_b:
        more_efficient = "A"
        token_diff = t_b - t_a
        cost_diff = cost_b - cost_a
    elif t_b < t_a:
        more_efficient = "B"
        token_diff = t_a - t_b
        cost_diff = cost_a - cost_b
    else:
        more_efficient = "tie"
        token_diff = 0
        cost_diff = 0.0

    return {
        "model": model,
        "prompt_a": {
            "tokens": t_a,
            "cost_usd": cost_a,
            "cost_per_1k_tokens_usd": round(per_1k_a, 8),
        },
        "prompt_b": {
            "tokens": t_b,
            "cost_usd": cost_b,
            "cost_per_1k_tokens_usd": round(per_1k_b, 8),
        },
        "more_cost_efficient": more_efficient,
        "token_difference": token_diff,
        "cost_difference_usd": round(cost_diff, 10),
        "summary": (
            f"Prompt {more_efficient} uses fewer input tokens for the same model pricing "
            f"(difference: {token_diff} tokens, ${cost_diff:.8f} USD at input rates)."
            if more_efficient != "tie"
            else "Both prompts have the same token count and input cost."
        ),
    }
