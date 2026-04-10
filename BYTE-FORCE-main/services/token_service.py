"""
Token counting, TF-IDF, POS-aware trimming, compare, and full dashboard analysis.
"""
from __future__ import annotations

import re
import string
from collections import Counter
from typing import Any, Callable

import tiktoken
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS

from services.nlp_helpers import (
    detect_noise_words_in_text,
    efficiency_score,
    noise_level_from_text,
    pos_counts_from_doc,
    repetition_rate,
    repetition_top,
    stopword_percentage,
    trim_with_pos_and_noise,
    useful_vs_noise_counts,
    word_frequencies,
    word_pos_map,
    word_tokens,
)
from utils.constants import MODEL_PRICING


def calculate_cost(token_count: int, model: str) -> float:
    if model not in MODEL_PRICING:
        raise ValueError(f"Unknown model: {model}")
    price_per_million = MODEL_PRICING[model]["input"]
    return (token_count / 1_000_000) * price_per_million


def cost_per_1k_tokens(token_count: int, model: str) -> float:
    if token_count <= 0:
        return 0.0
    return (calculate_cost(token_count, model) / token_count) * 1000


def get_encoding(model: str):
    try:
        return tiktoken.encoding_for_model(model)
    except Exception:
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str, model: str) -> int:
    return len(get_encoding(model).encode(text))


def _word_tfidf_map(prompt_text: str) -> dict[str, float]:
    try:
        vec = TfidfVectorizer(stop_words="english", token_pattern=r"(?u)\b\w+\b")
        tfidf_matrix = vec.fit_transform([prompt_text])
        feature_names = vec.get_feature_names_out()
        scores_arr = tfidf_matrix.toarray()[0]
        return {str(a): float(b) for a, b in zip(feature_names, scores_arr)}
    except ValueError:
        return {}


def compute_scores(prompt_text: str, encoding) -> list[dict]:
    word_scores = _word_tfidf_map(prompt_text)
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


def enrich_token_data(
    prompt_text: str,
    encoding,
    word_scores: dict[str, float],
    wf: Counter[str],
    pos_map: dict[str, str],
) -> list[dict]:
    """tiktoken spans with tfidf, frequency, coarse POS for tooltips."""
    token_ids = encoding.encode(prompt_text)
    out: list[dict] = []

    for tid in token_ids:
        token_str = encoding.decode([tid])
        token_clean = token_str.strip().lower()
        kw = ""
        if token_clean:
            m = re.search(r"(\w+)", token_clean)
            if m:
                kw = m.group(1).lower()

        tfidf_v = round(float(word_scores.get(kw, 0.0)), 6) if kw else 0.0
        freq = int(wf[kw]) if kw else 0
        pos = pos_map.get(kw) if kw else None

        if not token_clean or all(c in string.punctuation + " \t\n" for c in token_clean):
            score = 0.0
        elif token_clean in ENGLISH_STOP_WORDS:
            score = 0.08
        else:
            matched = None
            for word, s in word_scores.items():
                if word == token_clean or word in token_clean or token_clean in word:
                    matched = s
                    break
            if matched is not None:
                score = min(1.0, 0.35 + matched * 1.25)
            else:
                score = 0.72

        out.append(
            {
                "id": tid,
                "text": token_str,
                "score": round(score, 4),
                "tfidf": tfidf_v,
                "freq": freq,
                "pos": pos,
            }
        )
    return out


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


def top_tfidf_terms(prompt_text: str, max_terms: int = 20) -> list[dict[str, Any]]:
    ws = _word_tfidf_map(prompt_text)
    pairs = sorted(ws.items(), key=lambda x: x[1], reverse=True)
    return [{"term": t, "score": round(float(s), 6)} for t, s in pairs[:max_terms] if s > 0]


def unique_bpe_count(text: str, encoding) -> int:
    ids = encoding.encode(text)
    return len(set(ids))


def run_analyze(prompt: str, model: str) -> dict[str, Any]:
    if model not in MODEL_PRICING:
        raise ValueError(f"Unknown model: {model}")

    encoding = get_encoding(model)
    original_tokens = len(encoding.encode(prompt))
    words = word_tokens(prompt)
    wf = word_frequencies(prompt)
    word_scores = _word_tfidf_map(prompt)
    pos_map = word_pos_map(prompt)
    pos_tags = pos_counts_from_doc(prompt)

    trim_fallback: Callable[[str, Any], str] = lambda t, enc: trim_prompt_smart(t, enc)
    candidate_a = trim_prompt_smart(prompt, encoding)
    candidate_b = trim_with_pos_and_noise(prompt, encoding, trim_prompt_smart)
    ta, tb = len(encoding.encode(candidate_a)), len(encoding.encode(candidate_b))
    optimized_prompt = candidate_a if ta <= tb else candidate_b

    trimmed_tokens = len(encoding.encode(optimized_prompt))
    cost_original = calculate_cost(original_tokens, model)
    cost_trimmed = calculate_cost(trimmed_tokens, model)
    saved_tokens = original_tokens - trimmed_tokens
    savings_pct = (saved_tokens / original_tokens * 100) if original_tokens > 0 else 0.0

    token_data = enrich_token_data(prompt, encoding, word_scores, wf, pos_map)
    tfidf_top = top_tfidf_terms(prompt)
    tfidf_scores = {k: round(v, 6) for k, v in word_scores.items() if v > 0}
    rep_top = repetition_top(words)
    noise_words = detect_noise_words_in_text(prompt)
    n_level = noise_level_from_text(prompt)
    rep_r = repetition_rate(words)
    useful_n, noise_n = useful_vs_noise_counts(prompt)
    eff = efficiency_score(savings_pct, n_level, rep_r)

    return {
        "prompt": prompt,
        "total_tokens": original_tokens,
        "original_tokens": original_tokens,
        "unique_tokens": unique_bpe_count(prompt, encoding),
        "unique_words": len(set(words)),
        "repetition": rep_top,
        "repetition_rate": rep_r,
        "stopword_pct": stopword_percentage(words),
        "tfidf_scores": tfidf_scores,
        "tfidf_top_terms": tfidf_top,
        "pos_tags": pos_tags,
        "noise_words": noise_words,
        "noise_level": n_level,
        "noise_suggested_removals": noise_words[:15],
        "optimized_prompt": optimized_prompt,
        "trimmed_prompt": optimized_prompt,
        "trimmed_tokens": trimmed_tokens,
        "saved_tokens": saved_tokens,
        "tokens_saved": saved_tokens,
        "savings_percentage": round(savings_pct, 2),
        "cost_before": cost_original,
        "cost_after": cost_trimmed,
        "cost_original_usd": cost_original,
        "cost_trimmed_usd": cost_trimmed,
        "model": model,
        "token_data": token_data,
        "useful_token_words": useful_n,
        "noise_token_words": noise_n,
        "efficiency_score": eff,
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

    wa, wb = word_tokens(prompt_a), word_tokens(prompt_b)
    red_a = repetition_rate(wa)
    red_b = repetition_rate(wb)
    uniq_a = len(set(wa)) / max(len(wa), 1)
    uniq_b = len(set(wb)) / max(len(wb), 1)

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
            "repetition_rate": red_a,
            "lexical_diversity": round(uniq_a, 4),
        },
        "prompt_b": {
            "tokens": t_b,
            "cost_usd": cost_b,
            "cost_per_1k_tokens_usd": round(per_1k_b, 8),
            "repetition_rate": red_b,
            "lexical_diversity": round(uniq_b, 4),
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
