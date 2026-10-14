"""Lazy, CPU-capable PP-StructureV3 PDF OCR integration."""

import logging
import tempfile
import threading
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_pipeline: Any | None = None
_pipeline_lock = threading.Lock()
_inference_lock = threading.Lock()


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        with _pipeline_lock:
            if _pipeline is None:
                from paddleocr import PPStructureV3

                _pipeline = PPStructureV3(
                    lang=settings.PDF_OCR_LANG,
                    use_doc_orientation_classify=True,
                    use_doc_unwarping=False,
                    use_formula_recognition=False,
                    engine="paddle",
                )
    return _pipeline


def _markdown_text(result: Any) -> str:
    markdown = getattr(result, "markdown", None)
    if not isinstance(markdown, dict):
        return ""

    parts: list[str] = []
    text_items = markdown.get("markdown_texts", [])
    if isinstance(text_items, str):
        parts.append(text_items)
    elif isinstance(text_items, list):
        for item in text_items:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("markdown") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
    direct_text = markdown.get("text")
    if isinstance(direct_text, str):
        parts.append(direct_text)
    return "\n".join(part.strip() for part in parts if part.strip())


def _json_text(result: Any) -> str:
    """Fallback to recognized text blocks if the pipeline has no Markdown."""
    payload = getattr(result, "json", None)
    if not isinstance(payload, dict):
        return ""

    parts: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            block = value.get("block_content")
            if isinstance(block, str) and block.strip():
                parts.append(block.strip())
            table = value.get("pred_html")
            if isinstance(table, str) and table.strip():
                parts.append(table.strip())
            # Do not include image payloads or coordinate arrays in extracted text.
            for key in ("parsing_res_list", "table_res_list", "overall_ocr_res", "rec_texts", "res"):
                if key in value:
                    walk(value[key])
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str) and value.strip():
            parts.append(value.strip())

    walk(payload)
    return "\n".join(parts)


def extract_pdf_structure(pdf_bytes: bytes) -> dict[str, Any]:
    """Run PP-StructureV3 once over a temporary PDF and return table-aware text."""
    try:
        pipeline = _get_pipeline()
        with tempfile.TemporaryDirectory(prefix="mahi-pdf-ocr-") as temp_dir:
            pdf_path = Path(temp_dir) / "document.pdf"
            pdf_path.write_bytes(pdf_bytes)
            # Paddle inference pipelines may hold mutable buffers; serialize requests
            # to avoid races and keep memory usage bounded on CPU-only deployments.
            with _inference_lock:
                results = list(pipeline.predict(input=str(pdf_path)))

            pages = []
            markdown_pages = [getattr(result, "markdown", None) for result in results]
            try:
                combined_markdown = pipeline.concatenate_markdown_pages(markdown_pages)
            except Exception:
                logger.debug("Could not combine PP-StructureV3 Markdown pages", exc_info=True)
                combined_markdown = ""
            if isinstance(combined_markdown, str) and combined_markdown.strip():
                pages.append(combined_markdown.strip())
            else:
                for result in results:
                    page_text = _markdown_text(result) or _json_text(result)
                    if page_text:
                        pages.append(page_text)

        extracted_text = "\n\n".join(pages).strip()
        if not extracted_text:
            return {"text": "", "pages": len(results), "provider": "paddleocr_pp_structure_v3"}
        return {
            "text": extracted_text,
            "pages": len(results),
            "provider": "paddleocr_pp_structure_v3",
        }
    except Exception:
        logger.exception("PP-StructureV3 could not process the uploaded PDF")
        raise
