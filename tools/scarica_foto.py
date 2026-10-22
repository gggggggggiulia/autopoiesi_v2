#!/usr/bin/env python3
"""Scarica in img/foto/ le foto delle specie di nodes.csv, per la mostra.

Uso (da qualsiasi cartella):
    python3 tools/scarica_foto.py

In modalità mostra (index.html?mostra=1) il sito prende le foto da img/foto/
invece che da iNaturalist, così funziona anche senza internet. Ogni foto si
chiama come il suo id su iNaturalist (es. img/foto/140174901.jpeg); quelle già
scaricate vengono saltate, quindi lo script si può rilanciare.

La cartella img/foto/ è esclusa da git (.gitignore): molte foto sono "tutti i
diritti riservati", quindi si tengono solo sul computer della mostra e non si
ripubblicano nel repository. nodes.csv viene solo letto, mai modificato.

Serve solo Python 3 (nessuna libreria da installare) e una connessione a
internet.
"""

import csv
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODES = ROOT / "nodes.csv"
OUT = ROOT / "img" / "foto"
# Stesso schema di photoSrc() in script.js: id della foto + estensione.
PHOTO_RE = re.compile(r"/photos/(\d+)/[^/?]*?(\.\w+)(?:\?|$)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with open(NODES, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    scaricate = saltate = errori = 0
    for row in rows:
        url = (row.get("image") or "").strip()
        m = PHOTO_RE.search(url)
        if not m:
            print(f"  senza foto riconoscibile: {row['scientific_name']}")
            errori += 1
            continue
        dest = OUT / f"{m.group(1)}{m.group(2)}"
        if dest.exists() and dest.stat().st_size > 0:
            saltate += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "autopoiesi/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                dest.write_bytes(resp.read())
            scaricate += 1
            print(f"  ok {row['scientific_name']}")
        except Exception as e:  # una foto mancante non deve fermare le altre
            print(f"  ERRORE {row['scientific_name']}: {e}")
            errori += 1
        time.sleep(0.2)

    print(f"\nScaricate {scaricate}, già presenti {saltate}, errori {errori} (su {len(rows)} specie).")
    print(f"Cartella: {OUT}")
    return 1 if errori else 0


if __name__ == "__main__":
    sys.exit(main())
