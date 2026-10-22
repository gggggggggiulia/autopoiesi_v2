#!/usr/bin/env python3
"""Recupera e verifica i crediti delle foto di nodes.csv da iNaturalist.

Uso (dalla cartella del sito):
    python3 tools/aggiorna_crediti.py            # controlla e aggiorna nodes.csv
    python3 tools/aggiorna_crediti.py --prova    # solo report, non tocca nodes.csv

Per ogni specie legge l'id della foto dall'URL in "image", chiede a iNaturalist
autore e licenza, e:
  - riempie/corregge le colonne image_credit e image_license;
  - aggiunge la colonna image_page (pagina della foto su iNaturalist);
  - scrive crediti_report.csv con lo stato di ogni foto.

Le foto senza licenza Creative Commons ("tutti i diritti riservati") non si
possono usare senza permesso dell'autore: per quelle il report propone la foto
predefinita del taxon su iNaturalist, se ha una licenza libera. La sostituzione
non è automatica: si sceglie a mano.

Serve solo Python 3 (nessuna libreria da installare) e una connessione a
internet. iNaturalist chiede di non superare ~1 richiesta al secondo, quindi
per 177 specie servono circa 4-5 minuti.
"""

import csv
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request

NODES = "nodes.csv"
REPORT = "crediti_report.csv"
PAUSA = 1.1  # secondi tra una richiesta e l'altra
UA = "autopoiesi-crediti/1.0 (sito autopoiesi, verifica crediti foto)"

# Licenze che permettono di usare la foto citando l'autore.
LICENZE_LIBERE = {"cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa", "cc-by-nd", "cc-by-nc-nd"}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def info_foto(photo_id):
    """Restituisce (license_code, attribution) della foto, o solleva un errore."""
    tentativi = [
        f"https://api.inaturalist.org/v1/photos/{photo_id}",
        f"https://www.inaturalist.org/photos/{photo_id}.json",
    ]
    ultimo_errore = None
    for url in tentativi:
        try:
            data = get_json(url)
        except Exception as e:  # prova l'indirizzo successivo
            ultimo_errore = e
            time.sleep(PAUSA)
            continue
        if isinstance(data, dict) and "results" in data:
            data = data["results"][0] if data["results"] else {}
        lic = (data.get("license_code") or "").lower()
        attr = data.get("attribution") or ""
        return lic, attr
    raise RuntimeError(f"foto {photo_id} non trovata ({ultimo_errore})")


def foto_alternativa(nome_scientifico):
    """Foto predefinita del taxon, se ha licenza libera: (url, crediti, licenza) o None."""
    q = urllib.parse.quote(nome_scientifico)
    data = get_json(f"https://api.inaturalist.org/v1/taxa?q={q}&per_page=1")
    for t in data.get("results", []):
        p = t.get("default_photo") or {}
        lic = (p.get("license_code") or "").lower()
        if lic in LICENZE_LIBERE and p.get("medium_url"):
            return p["medium_url"], p.get("attribution", ""), lic
    return None


def main():
    prova = "--prova" in sys.argv
    with open(NODES, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        campi = list(reader.fieldnames)
        righe = list(reader)
    for c in ("image_credit", "image_license", "image_page"):
        if c not in campi:
            campi.append(c)

    report = []
    for i, r in enumerate(righe, 1):
        nome = r["scientific_name"]
        m = re.search(r"/photos/(\d+)/", r.get("image", ""))
        stato, alt = "", ""
        if not m:
            stato = "url foto non riconosciuto"
        else:
            pid = m.group(1)
            r["image_page"] = f"https://www.inaturalist.org/photos/{pid}"
            try:
                lic, attr = info_foto(pid)
            except Exception as e:
                stato = f"errore: {e}"
            else:
                vecchi = (r.get("image_credit", ""), r.get("image_license", ""))
                r["image_credit"], r["image_license"] = attr, lic
                if lic not in LICENZE_LIBERE:
                    stato = "TUTTI I DIRITTI RISERVATI: da sostituire"
                    time.sleep(PAUSA)
                    try:
                        a = foto_alternativa(nome)
                        alt = f"{a[0]} | {a[1]} | {a[2]}" if a else "nessuna alternativa libera"
                    except Exception as e:
                        alt = f"errore ricerca alternativa: {e}"
                elif not any(vecchi):
                    stato = "crediti aggiunti"
                elif vecchi != (attr, lic):
                    stato = "crediti corretti"
                else:
                    stato = "ok"
            time.sleep(PAUSA)
        print(f"[{i}/{len(righe)}] {nome}: {stato}")
        report.append({"scientific_name": nome, "stato": stato,
                       "image_credit": r.get("image_credit", ""),
                       "image_license": r.get("image_license", ""),
                       "image_page": r.get("image_page", ""),
                       "foto_alternativa (url | crediti | licenza)": alt})

    with open(REPORT, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(report[0].keys()))
        w.writeheader()
        w.writerows(report)

    if not prova:
        shutil.copyfile(NODES, NODES + ".bak")
        with open(NODES, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campi, lineterminator="\r\n")
            w.writeheader()
            w.writerows(righe)

    conta = {}
    for x in report:
        k = x["stato"].split(":")[0]
        conta[k] = conta.get(k, 0) + 1
    print("\nRiepilogo:", conta)
    print(f"Report: {REPORT}" + ("" if prova else f" · nodes.csv aggiornato (copia in {NODES}.bak)"))


if __name__ == "__main__":
    main()
