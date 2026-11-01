"""Score Wikipedia critical-reception text with VADER sentiment (derived scores only).

Reads the local, git-ignored text cache written by collect_wikipedia_reviews.py
and writes ml/review-sentiment.json, which keeps only numeric scores plus the
article URL and revision id needed for CC BY-SA attribution. No review text is
committed or published. Outcome-leaking sentences (box office, closings,
awards) are removed before scoring.
"""

import argparse
import json
from pathlib import Path

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

try:
    from scripts import collect_wikipedia_reviews as wiki
except ImportError:  # pragma: no cover - direct script execution
    import collect_wikipedia_reviews as wiki

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = "ml/review-sentiment.json"
POSITIVE, NEGATIVE = 0.05, -0.05


def score_text(text, analyzer):
    kept = wiki.review_sentences(text)
    if not kept:
        return None
    scores = [analyzer.polarity_scores(s)["compound"] for s in kept]
    return {"sentences": len(kept),
            "compoundMean": round(sum(scores) / len(scores), 4),
            "positiveShare": round(sum(s >= POSITIVE for s in scores) / len(scores), 4),
            "negativeShare": round(sum(s <= NEGATIVE for s in scores) / len(scores), 4)}


def score(cache, analyzer=None):
    analyzer = analyzer or SentimentIntensityAnalyzer()
    shows = {}
    for show_key, page in cache["pages"].items():
        scores = score_text(page["text"], analyzer)
        if scores:
            shows[show_key] = {"show": page["show"], "article": page["article"],
                               "url": page["url"], "revisionId": page["revisionId"],
                               "revisionTimestamp": page["revisionTimestamp"], **scores}
    return {
        "method": ("VADER lexicon sentiment (vaderSentiment) per sentence of each article's "
                   "critical-reception section, after removing sentences about box office, "
                   "closings, awards or ticket sales"),
        "source": cache["source"], "license": cache["license"],
        "licenseUrl": cache["licenseUrl"],
        "attribution": ("Scores derived from the linked English Wikipedia articles, by "
                        "Wikipedia contributors, CC BY-SA 4.0. Only derived scores are stored."),
        "showsConsidered": cache["showsConsidered"], "showsScored": len(shows),
        "shows": dict(sorted(shows.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    cache = json.loads((args.root / wiki.OUTPUT).read_text(encoding="utf-8"))
    result = score(cache)
    path = args.root / OUTPUT
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=True, indent=1) + "\n", encoding="utf-8")
    print(f"Scored {result['showsScored']} of {result['showsConsidered']} shows -> {OUTPUT}")


if __name__ == "__main__":
    main()
