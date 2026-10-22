#!/usr/bin/env python3
"""Recupera e verifica i crediti delle foto di nodes.csv da iNaturalist.

Uso (dalla cartella del sito):
    python3 tools/aggiorna_crediti.py

nodes.csv viene solo letto, mai modificato. Per ogni specie lo script legge
l'id della foto dall'URL in "image", chiede a iNaturalist autore e licenza e
scrive tutto in crediti_report.csv: crediti attuali, crediti corretti, licenza,
pagina della foto e stato (ok / da aggiungere / da correggere / da sostituire).

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
    with open(NODES, encoding="utf-8-sig", newline="") as f:
        righe = list(csv.DictReader(f))

    report = []
    for i, r in enumerate(righe, 1):
        nome = r["scientific_name"]
        m = re.search(r"/photos/(\d+)/", r.get("image", ""))
        stato, alt, pagina = "", "", ""
        attr, lic = "", ""
        vecchi = (r.get("image_credit", ""), r.get("image_license", ""))
        if not m:
            stato = "url foto non riconosciuto"
        else:
            pid = m.group(1)
            pagina = f"https://www.inaturalist.org/photos/{pid}"
            try:
                lic, attr = info_foto(pid)
            except Exception as e:
                stato = f"errore: {e}"
            else:
                if lic not in LICENZE_LIBERE:
                    stato = "da sostituire: tutti i diritti riservati"
                    time.sleep(PAUSA)
                    try:
                        a = foto_alternativa(nome)
                        alt = f"{a[0]} | {a[1]} | {a[2]}" if a else "nessuna alternativa libera"
                    except Exception as e:
                        alt = f"errore ricerca alternativa: {e}"
                elif not any(vecchi):
                    stato = "da aggiungere"
                elif vecchi != (attr, lic):
                    stato = "da correggere"
                else:
                    stato = "ok"
            time.sleep(PAUSA)
        print(f"[{i}/{len(righe)}] {nome}: {stato}")
        report.append({"scientific_name": nome, "stato": stato,
                       "credit_attuale": vecchi[0],
                       "licenza_attuale": vecchi[1],
                       "credit_inaturalist": attr,
                       "licenza_inaturalist": lic,
                       "pagina_foto": pagina,
                       "foto_alternativa (url | crediti | licenza)": alt})

    with open(REPORT, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(report[0].keys()))
        w.writeheader()
        w.writerows(report)

    conta = {}
    for x in report:
        k = x["stato"].split(":")[0]
        conta[k] = conta.get(k, 0) + 1
    print("\nRiepilogo:", conta)
    print(f"Report salvato in {REPORT} (nodes.csv non è stato modificato)")


if __name__ == "__main__":
    main()
