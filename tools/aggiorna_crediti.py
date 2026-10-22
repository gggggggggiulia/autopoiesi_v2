#!/usr/bin/env python3
"""Recupera e verifica i crediti delle foto di nodes.csv da iNaturalist.

Uso (dalla cartella che contiene nodes.csv):
    python3 aggiorna_crediti.py --prova   # prova veloce sulle prime 3 specie
    python3 aggiorna_crediti.py           # tutte le specie

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
import html
import json
import re
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


def get(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def get_json(url):
    return json.loads(get(url))


def cerca_taxon(nome_scientifico):
    """Il taxon iNaturalist con quel nome (o il primo risultato), o None."""
    q = urllib.parse.quote(nome_scientifico)
    risultati = get_json(f"https://api.inaturalist.org/v1/taxa?q={q}&per_page=10").get("results", [])
    for t in risultati:
        if t.get("name", "").lower() == nome_scientifico.lower():
            return t
    return risultati[0] if risultati else None


def da_foto_del_taxon(taxon, photo_id):
    """Cerca la foto tra quelle del taxon: (licenza, crediti) o None."""
    time.sleep(PAUSA)
    dettagli = get_json(f"https://api.inaturalist.org/v1/taxa/{taxon['id']}").get("results", [])
    foto = [tp.get("photo", {}) for tp in (dettagli[0].get("taxon_photos", []) if dettagli else [])]
    foto.append(taxon.get("default_photo") or {})
    for p in foto:
        if str(p.get("id")) == str(photo_id):
            return (p.get("license_code") or "").lower(), p.get("attribution") or ""
    return None


def da_pagina_foto(photo_id):
    """Legge licenza e crediti dalla pagina web della foto: (licenza, crediti)."""
    time.sleep(PAUSA)
    pagina = html.unescape(get(f"https://www.inaturalist.org/photos/{photo_id}", "text/html"))
    m = re.search(r"\(c\)[^<>\n]{1,150}?(?:all rights reserved|some rights reserved(?: \([^)<>]*\))?|no rights reserved)", pagina, re.I)
    attr = m.group(0).strip() if m else ""
    lic = ""
    cc = re.search(r"creativecommons\.org/(?:licenses|publicdomain)/([a-z-]+)/", pagina)
    if cc:
        lic = "cc0" if cc.group(1) == "zero" else "cc-" + cc.group(1)
    if not attr and not cc:
        raise RuntimeError("crediti non trovati nella pagina della foto")
    return lic, attr


def info_foto(nome_scientifico, photo_id):
    """(licenza, crediti, fonte) della foto, o solleva un errore."""
    taxon = cerca_taxon(nome_scientifico)
    if taxon:
        trovata = da_foto_del_taxon(taxon, photo_id)
        if trovata:
            return trovata + ("foto del taxon",)
    return da_pagina_foto(photo_id) + ("pagina della foto (da ricontrollare)",)


def foto_alternativa(nome_scientifico):
    """Foto predefinita del taxon, se ha licenza libera: (url, crediti, licenza) o None."""
    t = cerca_taxon(nome_scientifico)
    p = (t or {}).get("default_photo") or {}
    lic = (p.get("license_code") or "").lower()
    if lic in LICENZE_LIBERE and p.get("medium_url"):
        return p["medium_url"], p.get("attribution", ""), lic
    return None


def main():
    with open(NODES, encoding="utf-8-sig", newline="") as f:
        righe = list(csv.DictReader(f))
    if "--prova" in sys.argv:
        righe = righe[:3]

    report = []
    for i, r in enumerate(righe, 1):
        nome = r["scientific_name"]
        m = re.search(r"/photos/(\d+)/", r.get("image", ""))
        stato, alt, pagina, fonte = "", "", "", ""
        attr, lic = "", ""
        vecchi = (r.get("image_credit", ""), r.get("image_license", ""))
        if not m:
            stato = "url foto non riconosciuto"
        else:
            pid = m.group(1)
            pagina = f"https://www.inaturalist.org/photos/{pid}"
            try:
                lic, attr, fonte = info_foto(nome, pid)
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
        print(f"[{i}/{len(righe)}] {nome}: {stato}" + (f" · {attr} [{lic or 'nessuna licenza'}]" if attr else ""))
        report.append({"scientific_name": nome, "stato": stato,
                       "credit_attuale": vecchi[0],
                       "licenza_attuale": vecchi[1],
                       "credit_inaturalist": attr,
                       "licenza_inaturalist": lic,
                       "pagina_foto": pagina,
                       "fonte": fonte,
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
