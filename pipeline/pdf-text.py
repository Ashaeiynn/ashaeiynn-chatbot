"""Pull clean, teachable text out of a PDF.

Straight pypdf output is not fit to teach from: every page carries its running
header, its footer and its page number, so the same line lands in dozens of
chunks and competes with Bhaiya's actual words during search. Long words break
across lines with a hyphen. Scanned PDFs return nothing at all, with no
explanation for the person who uploaded them.

Used by server/teach.mjs.  Usage:  python3 pdf-text.py <file.pdf>
"""
import re
import sys
from collections import Counter

# A line that is nothing but a number (or roman numeral) is a page number.
PAGE_NUM = re.compile(r"^[\divxlcIVXLC]{1,6}$")
PAGE_OF = re.compile(r"^page\s*\d+\s*(?:of|/)?\s*\d*$", re.I)
# "medita-\ntion" and "साध-\nना" are one word, split by the page layout.
HYPHEN_BREAK = re.compile(r"(\w)[-‐‑]\n(\w)")


def clean_pages(pages):
    """pages: list of raw page strings → one cleaned document string."""
    n = len(pages)
    # A line appearing on most pages is furniture, not teaching. Needs at least
    # 3 pages before we can tell repetition from coincidence.
    seen = Counter()
    for page in pages:
        for line in {l.strip() for l in page.splitlines() if l.strip()}:
            seen[line] += 1
    boiler = set()
    if n >= 3:
        threshold = max(2, int(n * 0.6))
        boiler = {l for l, c in seen.items() if c >= threshold and len(l) <= 120}

    out = []
    for page in pages:
        kept = []
        for line in page.splitlines():
            s = line.strip()
            if not s:
                kept.append("")
                continue
            if s in boiler or PAGE_NUM.match(s) or PAGE_OF.match(s):
                continue
            kept.append(s)
        out.append("\n".join(kept))

    text = "\n\n".join(out)
    text = HYPHEN_BREAK.sub(r"\1\2", text)
    # collapse the ragged blank lines a PDF leaves behind
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main():
    from pypdf import PdfReader

    reader = PdfReader(sys.argv[1])
    pages = [(p.extract_text() or "") for p in reader.pages]
    text = clean_pages(pages)
    # A scan is a picture of a page: pypdf finds no text at all. Say so, rather
    # than letting it fail later as a vague "no readable text".
    if len(re.sub(r"\s", "", text)) < 40:
        sys.stderr.write(
            "This PDF has no text in it — it looks like a scan or photos of pages. "
            "The bot can only study text. Please upload a text PDF (or a Word/txt file), "
            "or paste the teaching into the 'Paste text' box.\n"
        )
        sys.exit(2)
    print(text)


if __name__ == "__main__":
    main()
