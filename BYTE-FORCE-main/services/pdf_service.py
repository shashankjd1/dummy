"""
PDF report generation (reportlab).
"""
from __future__ import annotations

from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.token_service import calculate_cost, top_tfidf_terms


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )


def build_analysis_pdf(payload: dict[str, Any]) -> bytes:
    """
    Build PDF from export payload. Expects keys aligned with analyze response
    plus optional conversation block.
    """
    prompt = payload.get("prompt") or ""
    trimmed = payload.get("trimmed_prompt") or ""
    model = payload.get("model") or "gpt-4o-mini"
    orig_t = int(payload.get("original_tokens") or 0)
    trim_t = int(payload.get("trimmed_tokens") or 0)
    cost_o = float(payload.get("cost_original_usd") or calculate_cost(orig_t, model))
    cost_tr = float(payload.get("cost_trimmed_usd") or calculate_cost(trim_t, model))
    tfidf = payload.get("tfidf_top_terms") or top_tfidf_terms(prompt)
    token_data = payload.get("token_data") or []
    messages = payload.get("conversation_messages")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.65 * inch,
        title="TokenScope Report",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ts_title",
        parent=styles["Heading1"],
        fontSize=18,
        spaceAfter=14,
        textColor=colors.HexColor("#1e1b4b"),
    )
    h2 = ParagraphStyle(
        "ts_h2",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=10,
        spaceAfter=8,
        textColor=colors.HexColor("#312e81"),
    )
    body = ParagraphStyle(
        "ts_body",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
    )
    mono = ParagraphStyle(
        "ts_mono",
        parent=styles["Code"],
        fontName="Courier",
        fontSize=8,
        leading=10,
    )

    story: list = []
    story.append(Paragraph("TokenScope — Token Analysis Report", title_style))
    story.append(Paragraph(f"<b>Model:</b> {_escape_xml(model)}", body))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Prompts", h2))
    story.append(Paragraph(f"<b>Original</b><br/>{_escape_xml(prompt[:8000])}", body))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"<b>Trimmed</b><br/>{_escape_xml(trimmed[:8000])}", body))
    story.append(Spacer(1, 10))

    story.append(Paragraph("Token &amp; cost summary", h2))
    data = [
        ["Metric", "Value"],
        ["Original tokens", str(orig_t)],
        ["Trimmed tokens", str(trim_t)],
        ["Saved tokens", str(max(0, orig_t - trim_t))],
        ["Input cost (original)", f"${cost_o:.8f}"],
        ["Input cost (trimmed)", f"${cost_tr:.8f}"],
        ["Savings (USD)", f"${max(0.0, cost_o - cost_tr):.8f}"],
    ]
    t = Table(data, colWidths=[2.6 * inch, 3.5 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e7ff")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1e1b4b")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d2fe")),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#f8fafc")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 8))

    pos = payload.get("pos_tags") or {}
    if pos and any(pos.values()):
        story.append(Paragraph("POS breakdown (spaCy)", h2))
        pr = [["POS group", "Count"]]
        for k in ("noun", "verb", "adj", "adv", "other"):
            pr.append([k.capitalize(), str(pos.get(k, 0))])
        pt = Table(pr, colWidths=[2 * inch, 1.5 * inch])
        pt.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0f2fe")),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#bae6fd")),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                ]
            )
        )
        story.append(pt)
        story.append(Spacer(1, 8))

    nl = payload.get("noise_level")
    nw = payload.get("noise_words") or []
    es = payload.get("efficiency_score")
    if nl or nw or es is not None:
        story.append(Paragraph("Noise &amp; efficiency", h2))
        bits = []
        if nl:
            bits.append(f"Noise level: {nl}")
        if es is not None:
            bits.append(f"Efficiency score: {es}/100")
        if nw:
            bits.append("Filler tokens: " + ", ".join(nw[:40]))
        story.append(Paragraph(_escape_xml(" · ".join(bits)), body))
        story.append(Spacer(1, 8))

    rep = payload.get("repetition") or {}
    if rep:
        story.append(Paragraph("Top repeated words", h2))
        story.append(Paragraph(_escape_xml(", ".join(f"{k}×{v}" for k, v in list(rep.items())[:20])), mono))
        story.append(Spacer(1, 8))

    story.append(Paragraph("Top TF-IDF terms (word-level)", h2))
    if tfidf:
        rows = [["Term", "Weight"]] + [[str(x["term"]), f'{float(x["score"]):.6f}'] for x in tfidf[:25]]
        tt = Table(rows, colWidths=[2.2 * inch, 1.2 * inch])
        tt.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef3c7")),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#fde68a")),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(tt)
    else:
        story.append(Paragraph("<i>No TF-IDF terms (empty or stop-word-only prompt).</i>", body))
    story.append(Spacer(1, 10))

    if token_data:
        story.append(Paragraph("Token-level scores (first 40 segments)", h2))
        sample = token_data[:40]
        td_rows = [["Text", "TF-IDF", "Score"]] + [
            [
                str(x.get("text", "")).replace("\n", " ")[:40],
                f'{float(x.get("tfidf", 0)):.4f}',
                f'{float(x.get("score", 0)):.4f}',
            ]
            for x in sample
        ]
        td_table = Table(td_rows, colWidths=[3.2 * inch, 0.85 * inch, 0.65 * inch])
        td_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d1fae5")),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#a7f3d0")),
                    ("FONTSIZE", (0, 0), (-1, -1), 7),
                ]
            )
        )
        story.append(td_table)
        story.append(Spacer(1, 8))

    if messages:
        story.append(Paragraph("Conversation (session excerpts)", h2))
        for m in messages[:30]:
            role = _escape_xml(str(m.get("role", "")))
            content = _escape_xml(str(m.get("content", ""))[:2000])
            tok = m.get("tokens", "")
            story.append(Paragraph(f"<b>{role}</b> ({tok} tok)<br/>{content}", mono))
            story.append(Spacer(1, 4))

    doc.build(story)
    return buf.getvalue()
