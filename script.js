document.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.preventDefault();
  },
  { passive: false }
);

document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("gesturechange", (event) => event.preventDefault());
document.addEventListener("gestureend", (event) => event.preventDefault());

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("svg").attr("width", width).attr("height", height);

let container = svg.select("#container");
if (container.empty()) {
  container = svg.append("g").attr("id", "container");
}

let infoBox = d3.select("body").select("#info-box");
if (infoBox.empty()) {
  infoBox = d3.select("body").append("div").attr("id", "info-box");
}

// ---- Effetto blur ----
const EDGE_BLUR_ENABLED = false;
const EDGE_BLUR_PAUSE_WHILE_MOVING = false;
const FOCUS_BLUR_PX = 2;
const NOT_OBSERVED_CONTRAST = 0.55;
const NOT_OBSERVED_LIFT = 0.25;

const EDGE_COLOR = "#464646";
const EDGE_COLOR_ACTIVE = "#F4F4F4";

const FOCUS_DIM_OPACITY = 0.15;
const INTERACTION_HOVER_DIM = 0.25;

if (EDGE_BLUR_ENABLED && d3.select("body").select("#edge-blur").empty()) {
  const edgeBlur = d3.select("body").append("div").attr("id", "edge-blur");
  [1, 2].forEach((i) =>
    edgeBlur
      .append("div")
      .attr("class", `edge-blur-layer edge-blur-layer--${i}`)
  );
}

let edgeTooltip = d3.select("body").select("#edge-tooltip");
if (edgeTooltip.empty()) {
  edgeTooltip = d3.select("body").append("div").attr("id", "edge-tooltip");
}

let lightbox = d3.select("body").select("#lightbox-overlay");
if (lightbox.empty()) {
  lightbox = d3
    .select("body")
    .append("div")
    .attr("id", "lightbox-overlay")
    .style("display", "none");
  lightbox.append("img");
  lightbox.append("div").attr("class", "lightbox-credit");
}
const lightboxImg = lightbox.select("img");
const lightboxCredit = lightbox.select(".lightbox-credit");

function openLightbox(src, alt, creditHTML) {
  lightboxImg.attr("src", src).attr("alt", alt || "");
  lightboxCredit.html(creditHTML || "");
  lightbox.style("display", "flex");
}

// ---- Crediti delle foto (iNaturalist) ----
// "(c) Ana Molina, some rights reserved (CC BY-NC)" + "cc-by-nc"
//   -> { author: "Ana Molina", license: "CC BY-NC", page: "https://www.inaturalist.org/photos/…" }
function photoCredit(n) {
  if (!n || !n.image_credit) return null;
  const author = n.image_credit
    .replace(/^\(c\)\s*/i, "")
    .replace(/,?\s*(some|all|no) rights reserved.*$/i, "")
    .trim();
  const code = (n.image_license || "").toLowerCase();
  const license = !code
    ? "tutti i diritti riservati"
    : code === "cc0"
    ? "CC0"
    : code.toUpperCase().replace(/^CC-/, "CC ");
  const id = (n.image || "").match(/\/photos\/(\d+)\//);
  return {
    author,
    license,
    page: id ? `https://www.inaturalist.org/photos/${id[1]}` : null,
  };
}
function photoCreditText(n) {
  const c = photoCredit(n);
  return c ? `© ${c.author} · ${c.license}` : "";
}
function photoCreditHTML(n) {
  const c = photoCredit(n);
  if (!c) return "";
  const text = `© ${c.author} · ${c.license}`;
  return c.page
    ? `<a href="${c.page}" target="_blank" rel="noopener">${text}</a>`
    : text;
}

function closeLightbox() {
  lightbox.style("display", "none");
  lightboxImg.attr("src", null);
}

function syncInfoBoxClosed() {
  const el = infoBox.node();
  const o = el.style.opacity;
  const closed = o === "" || Number(o) === 0;
  el.classList.toggle("is-closed", closed);
  requestAnimationFrame(() => {
    const counter = document.getElementById("top-species-counter");
    if (!counter) return;
    const overlaps =
      !closed &&
      el.getBoundingClientRect().top <
        counter.getBoundingClientRect().bottom + 12;
    counter.classList.toggle("is-covered", overlaps);
  });
}
window.addEventListener("resize", syncInfoBoxClosed);
new MutationObserver(syncInfoBoxClosed).observe(infoBox.node(), {
  attributes: true,
  attributeFilter: ["style"],
});
syncInfoBoxClosed();

infoBox.node().addEventListener("click", (event) => {
  const img = event.target.closest("img");
  if (!img || img.closest(".ei-node")) return; // le specie dell'edge inspector aprono il nodo, non la lightbox
  if (infoBox.node().classList.contains("is-closed")) return;
  event.stopPropagation();
  const credit = img.parentElement.querySelector(".ni-credit");
  openLightbox(
    img.getAttribute("src"),
    img.getAttribute("alt"),
    credit ? credit.innerHTML : ""
  );
});

lightbox.on("click", (event) => {
  if (event.target.closest("a")) return; // il link ai crediti si apre senza chiudere
  closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLightbox();
});

let movingTimer = null;
function setMoving(on) {
  if (!EDGE_BLUR_PAUSE_WHILE_MOVING) return;
  clearTimeout(movingTimer);
  if (on) {
    document.body.classList.add("is-moving");
  } else {
    movingTimer = setTimeout(
      () => document.body.classList.remove("is-moving"),
      180
    );
  }
}

let simulation, node, curvedLinks, linkTextPaths, edgeLabels, zoom;
let nodeChevrons; // piccoli chevron direzionali intorno al nodo selezionato (uno per edge collegato)
let nodeFarChevrons; // stessi chevron, grigi, vicino al vicino (l'altro estremo di ogni edge)
let nodeNeutralDots; // pallini per le interazioni SIMMETRICHE (senza verso) intorno al nodo selezionato
let nodeFarNeutralDots; // stessi pallini, grigi, vicino al vicino
let viewMode = "rete"; // "rete" (disposizione libera) o "sguardo" (anelli per numero di osservazioni)
let hasAutoFitted = false; // evita che la vista si "resetti" ogni volta che la simulazione si stabilizza
let selectedNodeId = null; // id del nodo attualmente aperto, per tenere il bordo/i chevron agganciati
let selectedEdgeDatum = null; // edge il cui inspector è aperto in questo momento: resta bianco anche fuori hover

let tourLockPolicy = null;
function tourAllowsNodeClick(d) {
  const p = tourLockPolicy;
  if (!p) return true;
  if (p.nodes === "all") return true;
  if (p.nodes === "pair") return p.ids.includes(d.scientific_name);
  return false;
}

const NODE_CHEVRON_GAP = 5;

const INVERSE_TYPE = {
  mangia: "mangiato da",
  "mangiato da": "mangia",
  "si nutre di": "consumato da",
  "consumato da": "si nutre di",
  preda: "predato da",
  "predato da": "preda",
  impollina: "impollinato da",
  "impollinato da": "impollina",
  "visita i fiori di": "fiori visitati da",
  "fiori visitati da": "visita i fiori di",
  visita: "visitato da",
  "visitato da": "visita",
  "ospite di": "ha come ospite",
  "ha come ospite": "ospite di",
  "parassita di": "ha come parassita",
  "ha come parassita": "parassita di",
  "vettore di dispersione di": "ha come vettore di dispersione",
  "ha come vettore di dispersione": "vettore di dispersione di",
  "fornisce nutrienti a": "acquisisce nutrienti da",
  "acquisisce nutrienti da": "fornisce nutrienti a",
  uccide: "ucciso da",
  "ucciso da": "uccide",
  "causa la morte di": "ucciso da",
  "parassitoide di": "ha come parassitoide",
  "ha come parassitoide": "parassitoide di",
  "ectoparassita di": "ha come ectoparassita",
  "ha come ectoparassita": "ectoparassita di",
  "endoparassita di": "ha come endoparassita",
  "ha come endoparassita": "endoparassita di",
  "emiparassita di": "ha come parassita",
  "parassita radicale di": "ha come parassita",
  "patogeno di": "ha come patogeno",
  "ha come patogeno": "patogeno di",
  "vettore di": "ha come vettore",
  "ha come vettore": "vettore di",
  "epifita di": "ha come epifita",
  "ha come epifita": "epifita di",
  "crea habitat per": "ha come habitat",
  "ha come habitat": "crea habitat per",
  "fornisce habitat a": "occupa l'habitat di",
  "occupa l'habitat di": "fornisce habitat a",
  "ospite di micorrize arbuscolari per": "ha come ospite una specie micorrizata arbuscolarmente",
  "ha come ospite una specie micorrizata arbuscolarmente": "ospite di micorrize arbuscolari per",
  "ospite di ectomicorrize di": "ha come ospite ectomicorrizico",
  "ha come ospite ectomicorrizico": "ospite di ectomicorrize di",
  "specie allelopatica nei confronti di": "ha come specie allelopatica",
  "ha come specie allelopatica": "specie allelopatica nei confronti di",
  danneggia: "danneggiato da",
  "danneggiato da": "danneggia",
  aggredisce: "aggredito da",
  "aggredito da": "aggredisce",
  alleva: "allevato da",
  "allevato da": "alleva",
  "cleptoparassita di": "ha come cleptoparassita",
  "ha come cleptoparassita": "cleptoparassita di",
  "iperparassita di": "ha come iperparassita",
  "ha come iperparassita": "iperparassita di",
  "endoparassitoide di": "ha come endoparassitoide",
  "ha come endoparassitoide": "endoparassitoide di",
  "ectoparassitoide di": "ha come ectoparassitoide",
  "ha come ectoparassitoide": "ectoparassitoide di",
  "ospite serbatoio di": "ha come ospite serbatoio",
  "ha come ospite serbatoio": "ospite serbatoio di",
  "depone le uova su": "riceve le uova di",
  "riceve le uova di": "depone le uova su",
  "depone le uova in": "accoglie le uova di",
  "accoglie le uova di": "depone le uova in",
  abita: "abitato da",
  "abitato da": "abita",
  "vive su": "ospita sulla superficie",
  "ospita sulla superficie": "vive su",
  "vive dentro": "ospita all'interno",
  "ospita all'interno": "vive dentro",
  "vive sotto": "ripara sotto di sé",
  "ripara sotto di sé": "vive sotto",
  "vive vicino a": "ha vicino",
  "ha vicino": "vive vicino a",
  "ospite nella dimora di": "accoglie nella dimora",
  "accoglie nella dimora": "ospite nella dimora di",
  "si posa su": "fa da posatoio a",
  "fa da posatoio a": "si posa su",
  "riposa su": "fa da rifugio a",
  "fa da rifugio a": "riposa su",
  "fiore visitato da": "visita i fiori di",
  "visita il fiore di": "fiori visitati da",
  impollinato: "impollina",
  "ha ospite": "ospite di",
  "ha vettore": "vettore di",
  "è vettore di": "ha come vettore",
};

// Descrizioni dell'edge inspector. Regole: una frase, soggetto sottinteso = la
// specie a sinistra (accordo al femminile), l'altra è sempre "l'altra specie",
// attivo e passivo speculari; i tipi simmetrici iniziano con "Le due specie".
// "note" è una seconda riga facoltativa, solo dove evita un fraintendimento.
const INTERACTION_TAXONOMY = [
  {
    names: ["mangia"],
    dir: "A",
    desc: "Si nutre dell'altra specie, mangiandola per intero o in parte.",
    note: "Può riguardare anche individui giovani o non ancora nati, come le uova.",
  },
  {
    names: ["mangiato da"],
    dir: "B",
    desc: "Viene mangiata dall'altra specie, per intero o in parte.",
    note: "Può riguardare anche i suoi individui giovani o le uova.",
  },
  {
    names: ["preda"],
    dir: "A",
    desc: "Cattura e uccide l'altra specie per nutrirsene.",
    note: "A differenza di \"mangia\", implica la caccia.",
  },
  {
    names: ["predato da"],
    dir: "B",
    desc: "Viene catturata e uccisa dall'altra specie, che se ne nutre.",
    note: "A differenza di \"mangiato da\", implica la caccia.",
  },
  {
    names: ["impollina"],
    dir: "A",
    desc: "Trasporta il polline dell'altra specie da un fiore all'altro, permettendone la riproduzione.",
  },
  {
    names: ["impollinato da", "impollinato"],
    dir: "B",
    desc: "I suoi fiori vengono impollinati dall'altra specie, che ne trasporta il polline.",
  },
  {
    names: ["visita i fiori di", "visita il fiore di"],
    dir: "A",
    desc: "Visita i fiori dell'altra specie, per esempio in cerca di nettare o polline.",
    note: "Non è detto che la impollini.",
  },
  {
    names: ["fiori visitati da", "fiore visitato da"],
    dir: "B",
    desc: "I suoi fiori vengono visitati dall'altra specie, per esempio in cerca di nettare o polline.",
    note: "Non è detto che ne venga impollinata.",
  },
  {
    names: ["visita"],
    dir: "A",
    desc: "Frequenta l'altra specie, senza necessariamente danneggiarla o consumarla.",
  },
  {
    names: ["visitato da"],
    dir: "B",
    desc: "Viene frequentata dall'altra specie, senza necessariamente esserne danneggiata o consumata.",
  },
  {
    names: ["ospite di"],
    dir: "A",
    desc: "Ospita l'altra specie, che vive su di lei o al suo interno.",
  },
  {
    names: ["ha come ospite", "ha ospite"],
    dir: "B",
    desc: "Vive sull'altra specie o al suo interno, usandola come ospite.",
  },
  {
    names: ["parassita di"],
    dir: "A",
    desc: "Vive a spese dell'altra specie, traendone nutrimento e danneggiandola.",
  },
  {
    names: ["ha come parassita"],
    dir: "B",
    desc: "Ospita l'altra specie, che vive a sue spese danneggiandola.",
  },
  {
    names: ["simbionte di"],
    dir: "N",
    desc: "Le due specie vivono in un'associazione stretta e duratura.",
  },
  {
    names: ["vettore di dispersione di"],
    dir: "A",
    desc: "Trasporta lontano i semi o i frutti dell'altra specie, aiutandola a diffondersi.",
  },
  {
    names: ["ha come vettore di dispersione"],
    dir: "B",
    desc: "I suoi semi o frutti vengono trasportati lontano dall'altra specie, che la aiuta a diffondersi.",
  },
  {
    names: ["interagisce con"],
    dir: "N",
    desc: "Le due specie sono legate da un'interazione documentata, di cui la fonte non specifica il tipo.",
  },
  {
    names: ["adiacente a"],
    dir: "N",
    desc: "Le due specie vivono molto vicine, senza un legame diretto documentato.",
  },
  {
    names: ["si nutre di"],
    dir: "A",
    desc: "Si nutre dell'altra specie, mangiandola per intero o in parte.",
    note: "Può riguardare anche individui giovani o non ancora nati, come le uova.",
  },
  {
    names: ["consumato da"],
    dir: "B",
    desc: "Viene mangiata dall'altra specie, per intero o in parte.",
    note: "Può riguardare anche i suoi individui giovani o le uova.",
  },
  {
    names: ["acquisisce nutrienti da"],
    dir: "A",
    desc: "Ricava nutrimento dall'altra specie, senza necessariamente mangiarla.",
  },
  {
    names: ["fornisce nutrienti a"],
    dir: "B",
    desc: "Fornisce nutrimento all'altra specie, senza necessariamente esserne mangiata.",
  },
  {
    names: ["uccide"],
    dir: "A",
    desc: "Causa la morte dell'altra specie, senza nutrirsene.",
    note: "A differenza di \"preda\", non c'è alimentazione.",
  },
  {
    names: ["ucciso da"],
    dir: "B",
    desc: "Viene uccisa dall'altra specie, che non se ne nutre.",
    note: "A differenza di \"predato da\", non c'è alimentazione.",
  },
  {
    names: ["causa la morte di"],
    dir: "A",
    desc: "Causa la morte dell'altra specie, senza nutrirsene.",
    note: "A differenza di \"preda\", non c'è alimentazione.",
  },
  {
    names: ["parassitoide di"],
    dir: "A",
    desc: "Vive come larva dentro o sopra l'altra specie, finendo per ucciderla.",
    note: "Tipico di alcune vespe e mosche.",
  },
  {
    names: ["ha come parassitoide"],
    dir: "B",
    desc: "Ospita le larve dell'altra specie, che finiscono per ucciderla.",
  },
  {
    names: ["ectoparassita di"],
    dir: "A",
    desc: "Vive sulla superficie dell'altra specie, nutrendosi a sue spese.",
    note: "Per esempio zecche e pidocchi.",
  },
  {
    names: ["ha come ectoparassita"],
    dir: "B",
    desc: "Ospita sulla propria superficie l'altra specie, che si nutre a sue spese.",
  },
  {
    names: ["endoparassita di"],
    dir: "A",
    desc: "Vive all'interno del corpo dell'altra specie, nutrendosi a sue spese.",
    note: "Per esempio vermi intestinali.",
  },
  {
    names: ["ha come endoparassita"],
    dir: "B",
    desc: "Ospita all'interno del proprio corpo l'altra specie, che si nutre a sue spese.",
  },
  {
    names: ["emiparassita di"],
    dir: "A",
    desc: "È una pianta che sottrae acqua e sali all'altra specie, pur facendo anche fotosintesi.",
    note: "Per esempio il vischio.",
  },
  {
    names: ["parassita radicale di"],
    dir: "A",
    desc: "Si attacca alle radici dell'altra specie per sottrarle acqua e nutrienti.",
  },
  {
    names: ["patogeno di"],
    dir: "A",
    desc: "Causa una malattia all'altra specie.",
  },
  {
    names: ["ha come patogeno"],
    dir: "B",
    desc: "Viene fatta ammalare dall'altra specie.",
  },
  {
    names: ["vettore di", "è vettore di"],
    dir: "A",
    desc: "Trasmette all'altra specie agenti di malattia, portandoli da un individuo all'altro.",
  },
  {
    names: ["ha come vettore", "ha vettore"],
    dir: "B",
    desc: "Riceve agenti di malattia attraverso l'altra specie, che li trasporta da un individuo all'altro.",
  },
  {
    names: ["epifita di"],
    dir: "A",
    desc: "Cresce appoggiata sulla superficie dell'altra specie, senza radicarsi nel suolo e senza danneggiarla.",
    note: "Per esempio muschi e licheni sui tronchi.",
  },
  {
    names: ["ha come epifita"],
    dir: "B",
    desc: "Fa da appoggio all'altra specie, che le cresce sopra senza danneggiarla.",
  },
  {
    names: ["crea habitat per"],
    dir: "A",
    desc: "Crea con il proprio corpo o le proprie strutture un ambiente in cui vive l'altra specie.",
  },
  {
    names: ["ha come habitat"],
    dir: "B",
    desc: "Vive nell'ambiente creato dall'altra specie.",
  },
  {
    names: ["fornisce habitat a"],
    dir: "A",
    desc: "Offre all'altra specie un ambiente in cui vivere.",
  },
  {
    names: ["occupa l'habitat di"],
    dir: "B",
    desc: "Vive nell'ambiente offerto dall'altra specie.",
  },
  {
    names: ["ospite di micorrize arbuscolari per"],
    dir: "A",
    desc: "Ospita nelle radici l'altra specie, un fungo che vi penetra e scambia con lei acqua e nutrienti.",
    note: "Si chiama micorriza arbuscolare.",
  },
  {
    names: ["ha come ospite una specie micorrizata arbuscolarmente"],
    dir: "B",
    desc: "È un fungo che penetra nelle radici dell'altra specie, scambiando con lei acqua e nutrienti.",
    note: "Si chiama micorriza arbuscolare.",
  },
  {
    names: ["ospite di ectomicorrize di"],
    dir: "A",
    desc: "Ospita sulle radici l'altra specie, un fungo che le avvolge senza penetrarle e scambia con lei nutrienti.",
    note: "Si chiama ectomicorriza, tipica di alberi come querce e pini.",
  },
  {
    names: ["ha come ospite ectomicorrizico"],
    dir: "B",
    desc: "È un fungo che avvolge le radici dell'altra specie senza penetrarle, scambiando con lei nutrienti.",
    note: "Si chiama ectomicorriza.",
  },
  {
    names: ["specie allelopatica nei confronti di"],
    dir: "A",
    desc: "Rilascia sostanze chimiche che influenzano la crescita o la sopravvivenza dell'altra specie.",
  },
  {
    names: ["ha come specie allelopatica"],
    dir: "B",
    desc: "Subisce le sostanze chimiche rilasciate dall'altra specie, che ne influenzano la crescita o la sopravvivenza.",
  },
  {
    names: ["commensale di"],
    dir: "N",
    desc: "Le due specie convivono: una ne trae vantaggio, senza dare all'altra né danno né beneficio.",
  },
  {
    names: ["mutualista di"],
    dir: "N",
    desc: "Le due specie collaborano e ne traggono vantaggio entrambe.",
  },
  {
    names: ["coesiste con"],
    dir: "N",
    desc: "Le due specie vivono spesso nello stesso luogo e nello stesso periodo.",
  },
  {
    names: ["si trova in associazione con"],
    dir: "N",
    desc: "Le due specie vivono spesso nello stesso luogo e nello stesso periodo.",
  },
  {
    names: ["si verifica con"],
    dir: "N",
    desc: "Le due specie sono state osservate insieme, senza un legame diretto documentato.",
  },
  {
    names: ["condivide il sito di rifugio con"],
    dir: "N",
    desc: "Le due specie usano lo stesso posatoio o rifugio per riposare.",
    note: "Di solito uccelli o pipistrelli.",
  },
  {
    names: ["ecologicamente correlato a"],
    dir: "N",
    desc: "Le due specie sono legate in modo indiretto, attraverso l'ambiente che condividono.",
  },
  {
    names: ["interagisce troficamente con"],
    dir: "N",
    desc: "Le due specie sono legate da un rapporto alimentare, senza che la fonte dica chi mangia chi.",
  },
  {
    names: ["danneggia"],
    dir: "A",
    desc: "Danneggia l'altra specie, senza necessariamente ucciderla o mangiarla.",
  },
  {
    names: ["danneggiato da"],
    dir: "B",
    desc: "Viene danneggiata dall'altra specie, senza necessariamente essere uccisa o mangiata.",
  },
  {
    names: ["aggredisce"],
    dir: "A",
    desc: "Attacca l'altra specie, per esempio per difendere territorio o risorse.",
  },
  {
    names: ["aggredito da"],
    dir: "B",
    desc: "Viene attaccata dall'altra specie, per esempio per territorio o risorse.",
  },
  {
    names: ["alleva"],
    dir: "A",
    desc: "Alleva o coltiva l'altra specie per nutrirsene.",
    note: "Per esempio le formiche con gli afidi.",
  },
  {
    names: ["allevato da"],
    dir: "B",
    desc: "Viene allevata o coltivata dall'altra specie, che se ne nutre.",
  },
  {
    names: ["cleptoparassita di"],
    dir: "A",
    desc: "Ruba all'altra specie il cibo o le risorse che ha raccolto.",
    note: "Per esempio alcune api che depongono nei nidi altrui.",
  },
  {
    names: ["ha come cleptoparassita"],
    dir: "B",
    desc: "Viene derubata dall'altra specie del cibo o delle risorse raccolte.",
  },
  {
    names: ["iperparassita di"],
    dir: "A",
    desc: "Vive a spese dell'altra specie, che è a sua volta un parassita.",
  },
  {
    names: ["ha come iperparassita"],
    dir: "B",
    desc: "È un parassita che viene a sua volta parassitato dall'altra specie.",
  },
  {
    names: ["endoparassitoide di"],
    dir: "A",
    desc: "Vive come larva dentro l'altra specie, finendo per ucciderla.",
  },
  {
    names: ["ha come endoparassitoide"],
    dir: "B",
    desc: "Ospita al proprio interno le larve dell'altra specie, che finiscono per ucciderla.",
  },
  {
    names: ["ectoparassitoide di"],
    dir: "A",
    desc: "Vive come larva sopra l'altra specie, finendo per ucciderla.",
  },
  {
    names: ["ha come ectoparassitoide"],
    dir: "B",
    desc: "Porta su di sé le larve dell'altra specie, che finiscono per ucciderla.",
  },
  {
    names: ["ospite serbatoio di"],
    dir: "A",
    desc: "Ospita l'altra specie, un agente di malattia, senza ammalarsi e contribuendo a mantenerla nell'ambiente.",
  },
  {
    names: ["ha come ospite serbatoio"],
    dir: "B",
    desc: "È un agente di malattia che si mantiene nell'ambiente grazie all'altra specie, che lo ospita senza ammalarsi.",
  },
  {
    names: ["depone le uova su"],
    dir: "A",
    desc: "Depone le uova sulla superficie dell'altra specie.",
  },
  {
    names: ["riceve le uova di"],
    dir: "B",
    desc: "Riceve sulla propria superficie le uova dell'altra specie.",
  },
  {
    names: ["depone le uova in"],
    dir: "A",
    desc: "Depone le uova all'interno dell'altra specie.",
  },
  {
    names: ["accoglie le uova di"],
    dir: "B",
    desc: "Riceve al proprio interno le uova dell'altra specie.",
  },
  {
    names: ["abita"],
    dir: "A",
    desc: "Vive dentro o presso l'altra specie, usandola come dimora.",
  },
  {
    names: ["abitato da"],
    dir: "B",
    desc: "Fa da dimora all'altra specie, che vive dentro o presso di lei.",
  },
  {
    names: ["vive su"],
    dir: "A",
    desc: "Vive sulla superficie dell'altra specie.",
  },
  {
    names: ["ospita sulla superficie"],
    dir: "B",
    desc: "Porta sulla propria superficie l'altra specie, che ci vive.",
  },
  {
    names: ["vive dentro"],
    dir: "A",
    desc: "Vive all'interno dell'altra specie.",
  },
  {
    names: ["ospita all'interno"],
    dir: "B",
    desc: "Ospita al proprio interno l'altra specie, che ci vive.",
  },
  {
    names: ["vive sotto"],
    dir: "A",
    desc: "Vive sotto l'altra specie, per esempio sotto la corteccia o le foglie.",
  },
  {
    names: ["ripara sotto di sé"],
    dir: "B",
    desc: "Offre riparo sotto di sé all'altra specie, che ci vive.",
  },
  {
    names: ["vive vicino a"],
    dir: "A",
    desc: "Vive vicino all'altra specie.",
  },
  {
    names: ["ha vicino"],
    dir: "B",
    desc: "Ha vicino a sé l'altra specie, che ci vive.",
  },
  {
    names: ["vive con"],
    dir: "N",
    desc: "Le due specie vivono insieme, a stretto contatto.",
  },
  {
    names: ["ospite nella dimora di"],
    dir: "A",
    desc: "Vive nella tana o nel nido dell'altra specie, non nel suo corpo.",
  },
  {
    names: ["accoglie nella dimora"],
    dir: "B",
    desc: "Accoglie l'altra specie nella propria tana o nel proprio nido.",
  },
  {
    names: ["si posa su"],
    dir: "A",
    desc: "Si posa sull'altra specie, per esempio su un ramo.",
  },
  {
    names: ["fa da posatoio a"],
    dir: "B",
    desc: "Viene usata dall'altra specie come posatoio.",
  },
  {
    names: ["riposa su"],
    dir: "A",
    desc: "Usa l'altra specie come rifugio per riposare.",
  },
  {
    names: ["fa da rifugio a"],
    dir: "B",
    desc: "Fa da rifugio all'altra specie, che ci riposa.",
  },
];

const SYMMETRIC_TYPES = new Set();

const ARROW_REVERSED_TYPES = new Set();

const interactionDescriptions = {};
const interactionNotes = {};

INTERACTION_TAXONOMY.forEach(({ names, dir, desc, note }) => {
  names.forEach((name) => {
    interactionDescriptions[name] = desc;
    if (note) interactionNotes[name] = note;
    if (dir === "N") SYMMETRIC_TYPES.add(name);
    else if (dir === "B") ARROW_REVERSED_TYPES.add(name);
    // dir === "A": resta "attivo" di default, non va in nessun Set.
  });
});

const USE_ROLE_COLORS = false;

const INTERACTION_COLOR = USE_ROLE_COLORS
  ? { active: "#00FF9D", passive: "#FF7B00", neutral: "#F4F4F4" }
  : { active: "#F4F4F4", passive: "#F4F4F4", neutral: "#F4F4F4" };
function interactionRole(typeLabel) {
  if (SYMMETRIC_TYPES.has(typeLabel)) return "neutral";
  return ARROW_REVERSED_TYPES.has(typeLabel) ? "passive" : "active";
}
function interactionColor(typeLabel) {
  return INTERACTION_COLOR[interactionRole(typeLabel)];
}

const SHOW_INTERACTION_SYMBOLS = true;

function labelForViewpoint(edge, viewpointId) {
  const srcId =
    typeof edge.source === "object" ? edge.source.scientific_name : edge.source;
  if (SYMMETRIC_TYPES.has(edge.type) || srcId === viewpointId) {
    return edge.type;
  }
  return INVERSE_TYPE[edge.type] || edge.type;
}

function loadCsv(url) {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    })
    .then((txt) => {
      txt = txt.replace(/^\uFEFF/, "");
      const first = txt.split(/\r?\n/, 1)[0];
      const count = (c) => first.split(c).length - 1;
      const delim = [",", ";", "\t"].sort((x, y) => count(y) - count(x))[0];
      const rows = d3.dsvFormat(delim).parse(txt);
      return rows.map((row) => {
        const clean = {};
        Object.keys(row).forEach((k) => {
          const v = row[k];
          clean[k.trim()] = typeof v === "string" ? v.trim() : v;
        });
        return clean;
      });
    });
}

// crediti.csv completa i crediti delle foto che in nodes.csv mancano
// (generato da tools/aggiorna_crediti.py); se non c'è, il sito funziona uguale.
Promise.all([
  loadCsv("nodes.csv"),
  loadCsv("edges.csv"),
  loadCsv("crediti.csv").catch(() => []),
]).then(
  ([nodes, allLinks, crediti]) => {
    const creditiPerSpecie = new Map(crediti.map((c) => [c.scientific_name, c]));
    nodes.forEach((n) => {
      const c = creditiPerSpecie.get(n.scientific_name);
      if (c && !n.image_credit) {
        n.image_credit = c.image_credit;
        n.image_license = c.image_license;
      }
    });
    if (!nodes.length || nodes[0].scientific_name === undefined) {
      console.error(
        "nodes.csv: colonna 'scientific_name' non trovata. Colonne lette:",
        nodes[0] ? Object.keys(nodes[0]) : "(file vuoto)"
      );
    }
    nodes = nodes.filter((n) => n.scientific_name);
    {
      const seenNames = new Set();
      const dup = [];
      nodes = nodes.filter((n) => {
        if (seenNames.has(n.scientific_name)) {
          dup.push(n.scientific_name);
          return false;
        }
        seenNames.add(n.scientific_name);
        return true;
      });
      if (dup.length) console.warn("nodes.csv: righe doppie ignorate:", dup);
    }
    const knownIds = new Set(nodes.map((n) => n.scientific_name));
    const links = allLinks.filter(
      (l) => knownIds.has(l.source) && knownIds.has(l.target)
    );
    if (links.length < allLinks.length) {
      const missing = new Set();
      allLinks.forEach((l) => {
        if (!knownIds.has(l.source)) missing.add(l.source);
        if (!knownIds.has(l.target)) missing.add(l.target);
      });
      console.warn(
        `edges.csv: ${allLinks.length - links.length} collegamenti ignorati, ` +
          `specie non presenti in nodes.csv:`,
        [...missing].sort()
      );
    }
    const adjacency = {};
    links.forEach(({ source, target }) => {
      if (!adjacency[source]) adjacency[source] = new Set();
      if (!adjacency[target]) adjacency[target] = new Set();
      adjacency[source].add(target);
      adjacency[target].add(source);
    });

    nodes.forEach((d) => {
      // colonna "observed" (si/no) se presente, altrimenti vecchia logica sul conteggio
      const hasObsCol =
        d.observed !== undefined && String(d.observed).trim() !== "";
      d.observations =
        d.observations === "Nessuna"
          ? 0
          : d.observations === undefined || d.observations === ""
          ? NaN
          : +d.observations;
      d.notObserved = hasObsCol
        ? String(d.observed).trim().toLowerCase() === "no"
        : d.observations === 0; // specie non ancora osservata nel territorio
      if (d.notObserved && !Number.isFinite(d.observations)) d.observations = 0;
      d.color = "#000000";
      d.degree = adjacency[d.scientific_name]?.size || 0;
    });

    const visitedForComponents = new Set();
    const componentSizes = [];
    nodes.forEach((startNode) => {
      const startId = startNode.scientific_name;
      if (visitedForComponents.has(startId)) return;
      const compIndex = componentSizes.length;
      const queue = [startId];
      visitedForComponents.add(startId);
      let size = 0;
      while (queue.length) {
        const currentId = queue.shift();
        const currentNode = nodes.find((n) => n.scientific_name === currentId);
        if (currentNode) currentNode.componentId = compIndex;
        size++;
        (adjacency[currentId] || new Set()).forEach((neighborId) => {
          if (!visitedForComponents.has(neighborId)) {
            visitedForComponents.add(neighborId);
            queue.push(neighborId);
          }
        });
      }
      componentSizes.push(size);
    });

    const mainComponentId = componentSizes.indexOf(Math.max(...componentSizes));
    nodes.forEach((d) => {
      d.isMainComponent = d.componentId === mainComponentId;
    });

    // Trova la specie con il maggior numero di connessioni
    const maxDegreeNode = nodes.reduce(
      (max, node) => (node.degree > max.degree ? node : max),
      nodes[0]
    );

    const topSpeciesCounter = d3
      .select("body")
      .append("div")
      .attr("id", "top-species-counter")
      .html(
        `<div class="tsc-section tsc-totals">
          <div class="tsc-eyebrow">Contatore totale</div>
          <div class="tsc-count">
            <span class="ni-count-badge">${nodes.length.toLocaleString(
              "it-IT"
            )}</span>
            <span>specie</span>
          </div>
          <div class="tsc-count">
            <span class="ni-count-badge">${links.length.toLocaleString(
              "it-IT"
            )}</span>
            <span>interazioni</span>
          </div>
        </div>
        <div class="tsc-divider"></div>
        <div class="tsc-section tsc-top" role="button" tabindex="0"
             aria-label="Apri ${maxDegreeNode.name}, la specie più connessa">
          <div class="tsc-eyebrow">Specie più connessa</div>
          <div class="tsc-name">${maxDegreeNode.name}</div>
          <div class="tsc-sci">${maxDegreeNode.scientific_name}</div>
          <div class="tsc-count">
            <span class="ni-count-badge">${maxDegreeNode.degree}</span>
            <span>specie</span>
          </div>
        </div>`
      );
    // Solo la parte "specie più connessa" è cliccabile: il resto è informativo.
    const topSpeciesButton = topSpeciesCounter.select(".tsc-top");

    function openTopSpecies() {
      if (!tourAllowsNodeClick(maxDegreeNode)) return;
      closeSearchResults();
      selectNode(maxDegreeNode);
      focusOnNode(maxDegreeNode);
    }
    topSpeciesButton.on("click", (event) => {
      event.stopPropagation();
      openTopSpecies();
    });
    topSpeciesButton.on("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTopSpecies();
      }
    });

    const sizeScale = d3
      .scaleLinear()
      .domain(d3.extent(nodes, (d) => d.degree))
      .range([15, 45]);

    const nodeByName = new Map(nodes.map((n) => [n.scientific_name, n]));

    const LABEL_BREATHING_ROOM = 24; // px extra oltre al testo misurato
    const labelMeasureText = container
      .append("text")
      .attr("font-size", 8)
      .style("opacity", 0)
      .style("pointer-events", "none");
    function measureLabelWidth(str) {
      labelMeasureText.text(str);
      return labelMeasureText.node().getComputedTextLength();
    }
    links.forEach((l) => {
      const altType = INVERSE_TYPE[l.type] || l.type;
      const textWidth = Math.max(
        measureLabelWidth(l.type),
        measureLabelWidth(altType)
      );
      const r1 = sizeScale(nodeByName.get(l.source)?.degree || 0);
      const r2 = sizeScale(nodeByName.get(l.target)?.degree || 0);
      l.minCenterDistance = r1 + r2 + textWidth + LABEL_BREATHING_ROOM;
    });
    labelMeasureText.remove();

    function forceLabelGap() {
      return function () {
        links.forEach((l) => {
          const minDist = l.minCenterDistance;
          const s = l.source;
          const t = l.target;
          if (!minDist || !s || !t) return;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist >= minDist) return;
          const push = ((minDist - dist) / dist) * 0.5;
          const ox = dx * push;
          const oy = dy * push;
          if (t.fx == null) {
            t.vx = (t.vx || 0) + ox;
            t.vy = (t.vy || 0) + oy;
          }
          if (s.fx == null) {
            s.vx = (s.vx || 0) - ox;
            s.vy = (s.vy || 0) - oy;
          }
        });
      };
    }

    simulation = d3
      .forceSimulation(nodes)
      .velocityDecay(0.5)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => d.scientific_name)
          .distance(180)
      )
      .force("charge", d3.forceManyBody().strength(-600))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collide",
        d3.forceCollide((d) => sizeScale(d.degree) + 5)
      )
      .force("x", d3.forceX(width / 2).strength(0.02))
      .force("y", d3.forceY(height / 2).strength(0.02))
      .force("labelGap", forceLabelGap());

    function nodeIdOf(v) {
      return typeof v === "object" && v !== null ? v.scientific_name : v;
    }

    function otherNodeIdOf(d, nodeId) {
      return nodeIdOf(d.source) === nodeId
        ? nodeIdOf(d.target)
        : nodeIdOf(d.source);
    }

    const parallelGroups = new Map();
    links.forEach((l) => {
      const key = `${nodeIdOf(l.source)}\u0000${nodeIdOf(l.target)}`;
      if (!parallelGroups.has(key)) parallelGroups.set(key, []);
      parallelGroups.get(key).push(l);
    });
    parallelGroups.forEach((group) => {
      group.forEach((l, idx) => {
        l.parallelIndex = idx;
        l.parallelCount = group.length;
      });
    });

    const linkGroup = container.append("g").attr("class", "links");

    curvedLinks = linkGroup
      .selectAll("path.link-path")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link-path")
      .attr("stroke", EDGE_COLOR)
      .attr("stroke-width", 0.4)
      .attr("fill", "none")
      .attr("id", (d, i) => `link-path-${i}`)
      .attr("marker-end", "none")
      .style("pointer-events", "none"); // l'interazione passa alla hit-area più larga qui sotto

    const linkHitAreas = linkGroup
      .selectAll("path.link-hit")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link-hit")
      .attr("stroke", "transparent")
      .attr("stroke-width", 16)
      .attr("fill", "none")
      .style("pointer-events", "none");

    function setActiveEdges(activeLinks) {
      const activeSet = new Set(activeLinks);
      linkHitAreas.style("pointer-events", (d) =>
        activeSet.has(d) ? "stroke" : "none"
      );
    }

    const textPathGroup = container
      .append("g")
      .attr("class", "link-text-paths");
    linkTextPaths = textPathGroup
      .selectAll("path")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link-text-path")
      .attr("id", (d, i) => `link-text-path-${i}`)
      .attr("fill", "none")
      .attr("stroke", "none");

    function edgeRestStroke(d) {
      return d === selectedEdgeDatum ? EDGE_COLOR_ACTIVE : EDGE_COLOR;
    }
    function edgeRestWidth(d) {
      return d === selectedEdgeDatum ? 1.4 : 0.4;
    }

    function roleMarkerId(d, emphasized) {
      if (!SHOW_INTERACTION_SYMBOLS) return "none";
      const role = interactionRole(labelForViewpoint(d, selectedNodeId));
      return `url(#node-chevron-marker-${role}${emphasized ? "" : "-far"})`;
    }
    function nearChevronMarker(d) {
      return roleMarkerId(d, true);
    }
    function farChevronMarker(d) {
      return roleMarkerId(d, d === selectedEdgeDatum);
    }
    function farDotFill(d) {
      return d === selectedEdgeDatum ? EDGE_COLOR_ACTIVE : EDGE_COLOR;
    }
    function updateFarMarkerHighlight() {
      nodeFarChevrons.selectAll("path").attr("marker-end", farChevronMarker);
      nodeFarNeutralDots.selectAll("circle").attr("fill", farDotFill);
    }

    function openEdgeInfo(d) {
      if (selectedEdgeDatum && selectedEdgeDatum !== d) {
        d3.select(`#link-path-${links.indexOf(selectedEdgeDatum)}`)
          .attr("stroke", EDGE_COLOR)
          .attr("stroke-width", 0.4);
      }
      selectedEdgeDatum = d;
      d3.select(`#link-path-${links.indexOf(d)}`)
        .attr("stroke", EDGE_COLOR_ACTIVE)
        .attr("stroke-width", 1.4);
      updateFarMarkerHighlight();

      const viewpointId =
        selectedNodeId != null ? selectedNodeId : nodeIdOf(d.source);
      const otherId = otherNodeIdOf(d, viewpointId);
      const viewpointNode =
        nodes.find((n) => n.scientific_name === viewpointId) ||
        (typeof d.source === "object" ? d.source : undefined);
      const otherNode =
        nodes.find((n) => n.scientific_name === otherId) ||
        (typeof d.target === "object" ? d.target : undefined);

      const interaction = labelForViewpoint(d, viewpointId);
      const description = interactionDescriptions[interaction] || "";
      const note = interactionNotes[interaction] || "";

      infoBox
        .html(
          `
      <div class="ei-root">
        <div class="ei-header">
          <div class="ei-name">${viewpointNode.name}</div>
          <div class="ei-type" style="color:${interactionColor(
            interaction
          )}">${interaction}</div>
          <div class="ei-name">${otherNode.name}</div>
        </div>
        <div class="ei-photos">
          ${edgeNodeHTML(viewpointNode)}
          <span class="ei-icon-slot">${interactionIconHTML(interaction)}</span>
          ${edgeNodeHTML(otherNode)}
        </div>
        ${description ? `<div class="ei-description">${description}</div>` : ""}
        ${note ? `<div class="ei-note">${note}</div>` : ""}
      </div>
    `
        )
        .style("opacity", 1);

      // Le due specie sono nodi: cliccandone una si apre il suo inspector.
      infoBox.selectAll(".ei-node").on("click", function (event) {
        event.stopPropagation();
        if (tourLockPolicy) return;
        const target = nodes.find(
          (n) => n.scientific_name === this.dataset.species
        );
        if (!target) return;
        selectNode(target);
        focusOnNode(target);
      });
    }

    // Una specie nell'edge inspector, disegnata come il suo nodo nel grafo:
    // foto tonda, bordo sottile, tratteggio e grigio se non osservata.
    function edgeNodeHTML(n) {
      return `<button type="button" class="ei-node${
        n.notObserved ? " is-not-observed" : ""
      }" data-species="${n.scientific_name}" title="Apri ${n.name}${
        photoCreditText(n) ? `\n${photoCreditText(n)}` : ""
      }">
            <img src="${n.image}" alt="${n.name}" />
          </button>`;
    }

    linkHitAreas
      .on("mouseenter", (event, d) => {
        if (tourLockPolicy) return; // guida aperta: l'evidenziazione dello step non si tocca
        d3.select(`#link-path-${links.indexOf(d)}`)
          .attr("stroke", EDGE_COLOR_ACTIVE)
          .attr("stroke-width", 1.4);
        nodeFarChevrons
          .selectAll("path")
          .filter((p) => p === d)
          .attr("marker-end", (p) => roleMarkerId(p, true));
        nodeFarNeutralDots
          .selectAll("circle")
          .filter((p) => p === d)
          .attr("fill", "#F4F4F4");
      })
      .on("mouseleave", (event, d) => {
        if (tourLockPolicy) return;
        d3.select(`#link-path-${links.indexOf(d)}`)
          .attr("stroke", edgeRestStroke(d))
          .attr("stroke-width", edgeRestWidth(d));
        nodeFarChevrons
          .selectAll("path")
          .filter((p) => p === d)
          .attr("marker-end", farChevronMarker(d));
        nodeFarNeutralDots
          .selectAll("circle")
          .filter((p) => p === d)
          .attr("fill", farDotFill(d));
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        if (tourLockPolicy) return;
        openEdgeInfo(d);
      });

    edgeLabels = container.append("g").attr("class", "edge-labels");

    nodeChevrons = container.append("g").attr("class", "node-chevrons");

    nodeFarChevrons = container.append("g").attr("class", "node-far-chevrons");

    nodeNeutralDots = container.append("g").attr("class", "node-neutral-dots");

    nodeFarNeutralDots = container
      .append("g")
      .attr("class", "node-far-neutral-dots");

    const defs = svg.select("defs").empty()
      ? svg.append("defs")
      : svg.select("defs");

    [
      {
        id: "node-chevron-marker-active",
        stroke: INTERACTION_COLOR.active,
        opacity: 1,
      },
      {
        id: "node-chevron-marker-passive",
        stroke: INTERACTION_COLOR.passive,
        opacity: 1,
      },
      {
        id: "node-chevron-marker-active-far",
        stroke: INTERACTION_COLOR.active,
        opacity: 0.45,
      },
      {
        id: "node-chevron-marker-passive-far",
        stroke: INTERACTION_COLOR.passive,
        opacity: 0.45,
      },
    ].forEach(({ id, stroke, opacity }) => {
      if (defs.select(`#${id}`).empty()) {
        defs
          .append("marker")
          .attr("id", id)
          .attr("viewBox", "0 0 10 10")
          .attr("refX", 4.5)
          .attr("refY", 5)
          .attr("markerWidth", 6)
          .attr("markerHeight", 6)
          .attr("markerUnits", "userSpaceOnUse") // dimensione fissa, non legata allo stroke-width sottilissimo dell'edge
          .attr("orient", "auto")
          .append("path")
          .attr("d", "M2,1.5 L7,5 L2,8.5") // chevron aperto ">" invece di triangolo pieno, più leggero
          .attr("fill", "none")
          .attr("stroke", stroke)
          .attr("stroke-opacity", opacity)
          .attr("stroke-width", 1.5)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round");
      }
    });

    if (defs.select("#grayscale-filter").empty()) {
      defs
        .append("filter")
        .attr("id", "grayscale-filter")
        .call((f) => {
          // 1) toglie il colore
          f.append("feColorMatrix").attr("type", "saturate").attr("values", 0);
          // 2) riduce il contrasto e schiarisce: out = slope * in + intercept
          const slope = NOT_OBSERVED_CONTRAST;
          const intercept = (1 - NOT_OBSERVED_CONTRAST) / 2 + NOT_OBSERVED_LIFT;
          const t = f.append("feComponentTransfer");
          ["R", "G", "B"].forEach((ch) =>
            t
              .append(`feFunc${ch}`)
              .attr("type", "linear")
              .attr("slope", slope)
              .attr("intercept", intercept)
          );
        });
    }

    defs
      .selectAll("pattern")
      .data(nodes)
      .enter()
      .append("pattern")
      .attr("id", (d) => `img-${d.scientific_name.replace(/\s+/g, "_")}`)
      .attr("patternUnits", "objectBoundingBox")
      .attr("width", 1)
      .attr("height", 1)
      .append("image")
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("width", (d) => sizeScale(d.degree) * 2)
      .attr("height", (d) => sizeScale(d.degree) * 2)
      .attr("filter", (d) => (d.notObserved ? "url(#grayscale-filter)" : null))
      .style("opacity", 0)
      // Ogni foto compare con una dissolvenza appena è pronta (il nodo
      // intanto mostra un grigio scuro neutro, non il nero).
      .each(function (d) {
        const img = d3.select(this);
        const show = () =>
          img.transition().duration(700).ease(d3.easeCubicOut).style("opacity", 1);
        img.on("load", show).on("error", () => img.style("opacity", 0));
        img.attr("href", d.image); // il listener va prima dell'href, così non perde le foto in cache
      });

    container
      .selectAll("circle.bg")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "bg")
      .attr("r", (d) => sizeScale(d.degree))
      .attr("fill", "#8a8a8c") // segnaposto delle foto in caricamento
      .attr("fill-opacity", 1);

    node = container
      .selectAll("circle.node")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", (d) => sizeScale(d.degree))
      .attr("stroke", "#646466")
      .attr("stroke-width", 0.4) // <-- stroke nodo
      .attr("stroke-dasharray", (d) => (d.notObserved ? "4 3" : null)) // tratteggio = non osservata
      .attr(
        "fill",
        (d) => `url(#img-${d.scientific_name.replace(/\s+/g, "_")})`
      )
      .call(drag(simulation));

    let boundary = container.selectAll("circle.boundary").data([null]);
    boundary = boundary
      .enter()
      .append("circle")
      .attr("class", "boundary")
      .attr("fill", "none")
      .attr("stroke", "#646466")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "12 8")
      .style("opacity", 1)
      .merge(boundary);

    const textPathId = "circlePath";
    let defsPath = svg.select("defs");
    defsPath
      .selectAll(`#${textPathId}`)
      .data([null])
      .join("path")
      .attr("id", textPathId)
      .attr("fill", "none");

    let textElement = container
      .selectAll("text.circle-text")
      .data([null])
      .join("text")
      .attr("class", "circle-text")
      .attr("fill", "#646466")
      .attr("font-size", 44)
      .attr("font-family", "Arial, sans-serif");

    textElement
      .selectAll("textPath")
      .data([null])
      .join("textPath")
      .attr("xlink:href", `#${textPathId}`)
      .attr("startOffset", "65%")
      .attr("text-anchor", "middle")
      .text("Oasi Cave di Noale");

    const ARC_BULGE = 0.134;
    // Distanza fra archi paralleli fra la stessa coppia di specie, in px.
    const ARC_SEPARATION = 16;

    function shortenToRadius(x1, y1, x2, y2, radius) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: x2 - (dx / len) * radius,
        y: y2 - (dy / len) * radius,
      };
    }

    function arcCircleIntersection(ox, oy, R, cx, cy, r, towardX, towardY) {
      const dx = cx - ox;
      const dy = cy - oy;
      const dist = Math.hypot(dx, dy);
      if (!dist) return null;

      const a = (R * R - r * r + dist * dist) / (2 * dist);
      const h2 = R * R - a * a;
      if (!(h2 >= 0)) return null; // cerchi che non si incontrano (o NaN)

      const h = Math.sqrt(h2);
      const mx = ox + (a * dx) / dist;
      const my = oy + (a * dy) / dist;
      const px = (-dy * h) / dist;
      const py = (dx * h) / dist;

      const c1 = { x: mx + px, y: my + py };
      const c2 = { x: mx - px, y: my - py };
      return Math.hypot(c1.x - towardX, c1.y - towardY) <=
        Math.hypot(c2.x - towardX, c2.y - towardY)
        ? c1
        : c2;
    }

    function arcGeometry(d) {
      const x1 = d.source.x;
      const y1 = d.source.y;
      const x2 = d.target.x;
      const y2 = d.target.y;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const chord = Math.hypot(dx, dy);

      const r1 = sizeScale(d.source.degree);
      const r2 = sizeScale(d.target.degree);

      const index = d.parallelIndex || 0;
      const count = d.parallelCount || 1;

      let sagitta =
        chord * ARC_BULGE + (index - (count - 1) / 2) * ARC_SEPARATION;
      sagitta = Math.max(chord * 0.03, Math.min(sagitta, chord * 0.45));

      const R = ((chord * chord) / 4 + sagitta * sagitta) / (2 * sagitta);

      const h = Math.sqrt(Math.max(0, R * R - (chord * chord) / 4));
      const nx = -dy / chord;
      const ny = dx / chord;
      const ox = (x1 + x2) / 2 + h * nx;
      const oy = (y1 + y2) / 2 + h * ny;

      let p1 = null;
      let p2 = null;

      if (chord > r1 + r2 + 1) {
        p1 = arcCircleIntersection(ox, oy, R, x1, y1, r1, x2, y2);
        p2 = arcCircleIntersection(ox, oy, R, x2, y2, r2, x1, y1);
      }

      if (!p1 || !p2) {
        let m1 = r1;
        let m2 = r2;
        const maxMargin = (chord || 1) * 0.85;
        if (m1 + m2 > maxMargin) {
          const k = maxMargin / (m1 + m2);
          m1 *= k;
          m2 *= k;
        }
        p1 = shortenToRadius(x2, y2, x1, y1, m1);
        p2 = shortenToRadius(x1, y1, x2, y2, m2);
      }

      return { p1, p2, R, ox, oy };
    }

    function computeTextPathD(d) {
      const { p1, p2, R } = d.__arc || arcGeometry(d);
      return p1.x <= p2.x
        ? `M${p1.x},${p1.y} A${R},${R} 0 0,1 ${p2.x},${p2.y}`
        : `M${p2.x},${p2.y} A${R},${R} 0 0,0 ${p1.x},${p1.y}`;
    }

    function computeArcD(d) {
      const { p1, p2, R } = d.__arc || arcGeometry(d);
      if (ARROW_REVERSED_TYPES.has(d.type)) {
        return `M${p2.x},${p2.y} A${R},${R} 0 0,0 ${p1.x},${p1.y}`;
      }
      return `M${p1.x},${p1.y} A${R},${R} 0 0,1 ${p2.x},${p2.y}`;
    }

    function tangentAtPoint(point, center, chordX, chordY) {
      const rx = point.x - center.x;
      const ry = point.y - center.y;
      let tx = -ry;
      let ty = rx;
      if (tx * chordX + ty * chordY < 0) {
        tx = -tx;
        ty = -ty;
      }
      const len = Math.hypot(tx, ty) || 1;
      return { x: tx / len, y: ty / len };
    }

    function computeNearNodeAnchor(d, nodeId) {
      const arc = d.__arc;
      if (!arc) return null;
      const { p1, p2, ox, oy } = arc;
      const isOutgoing = nodeIdOf(d.source) === nodeId;
      const nearPoint = isOutgoing ? p1 : p2;
      const otherPoint = isOutgoing ? p2 : p1;

      const geomChordX = otherPoint.x - nearPoint.x;
      const geomChordY = otherPoint.y - nearPoint.y;
      const geomTangent = tangentAtPoint(
        nearPoint,
        { x: ox, y: oy },
        geomChordX,
        geomChordY
      );

      const rx = nearPoint.x - ox;
      const ry = nearPoint.y - oy;
      const radius = Math.hypot(rx, ry) || 1;
      const ccwSign = geomTangent.x * -ry + geomTangent.y * rx >= 0 ? 1 : -1;
      const dtheta = (ccwSign * NODE_CHEVRON_GAP) / radius;
      const cosT = Math.cos(dtheta);
      const sinT = Math.sin(dtheta);

      return {
        x: ox + rx * cosT - ry * sinT,
        y: oy + rx * sinT + ry * cosT,
        nearPoint,
        ox,
        oy,
        p1,
        p2,
      };
    }

    function computeNodeChevronD(d, nodeId) {
      const anchor = computeNearNodeAnchor(d, nodeId);
      if (!anchor) return null;
      const { p1, p2, ox, oy, nearPoint } = anchor;

      const flowReversed = ARROW_REVERSED_TYPES.has(d.type);
      const chordX = flowReversed ? p1.x - p2.x : p2.x - p1.x;
      const chordY = flowReversed ? p1.y - p2.y : p2.y - p1.y;

      const tangent = tangentAtPoint(
        nearPoint,
        { x: ox, y: oy },
        chordX,
        chordY
      );

      const backX = anchor.x - tangent.x * 4;
      const backY = anchor.y - tangent.y * 4;

      return `M${backX},${backY} L${anchor.x},${anchor.y}`;
    }

    function updateNodeChevrons() {
      nodeChevrons
        .selectAll("path")
        .attr("d", (d) => computeNodeChevronD(d, selectedNodeId));
      nodeFarChevrons
        .selectAll("path")
        .attr("d", (d) =>
          computeNodeChevronD(d, otherNodeIdOf(d, selectedNodeId))
        );
      nodeNeutralDots
        .selectAll("circle")
        .attr("cx", (d) => computeNearNodeAnchor(d, selectedNodeId)?.x ?? null)
        .attr("cy", (d) => computeNearNodeAnchor(d, selectedNodeId)?.y ?? null);
      nodeFarNeutralDots
        .selectAll("circle")
        .attr(
          "cx",
          (d) =>
            computeNearNodeAnchor(d, otherNodeIdOf(d, selectedNodeId))?.x ??
            null
        )
        .attr(
          "cy",
          (d) =>
            computeNearNodeAnchor(d, otherNodeIdOf(d, selectedNodeId))?.y ??
            null
        );
    }

    const nodeCircles = container.selectAll("circle.node");
    const bgCircles = container.selectAll("circle.bg");

    function syncTextPaths() {
      linkTextPaths.attr("d", computeTextPathD);
    }

    simulation.on("tick", () => {
      const cx = width / 2;
      const cy = height / 2;
      const maxDistSatellite = Math.min(width, height) * 1.1;

      nodes.forEach((d) => {
        if (d.fx != null || d.fy != null) return; // non toccare un nodo che si sta trascinando
        if (d.isMainComponent) return;
        if (viewMode === "sguardo") return;

        const dx = d.x - cx;
        const dy = d.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDistSatellite) {
          const overshoot = dist - maxDistSatellite;
          const pullStrength = 0.001; // più alto = rientro più rapido/deciso
          d.vx -= (dx / dist) * overshoot * pullStrength;
          d.vy -= (dy / dist) * overshoot * pullStrength;
        }
      });

      links.forEach((l) => {
        l.__arc = arcGeometry(l);
      });

      const hitNodes = linkHitAreas.nodes();
      curvedLinks.each(function (d, i) {
        const dStr = computeArcD(d);
        this.setAttribute("d", dStr);
        hitNodes[i].setAttribute("d", dStr);
      });

      if (selectedNodeId) syncTextPaths();

      nodeCircles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      bgCircles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);

      if (selectedNodeId) {
        updateNodeChevrons();
      }

      updateBoundary();
    });

    const RESET_BUTTON_ENABLED = false;

    d3.select("#reset").on("click", () => {
      if (!RESET_BUTTON_ENABLED) return;
      simulation.alpha(1).restart();
      resetHighlightAndLabels();
      infoBox.style("opacity", 0);
    });

    d3.select("body").on("keydown", (event) => {
      if (!RESET_BUTTON_ENABLED) return;
      const tag = event.target && event.target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (event.target && event.target.isContentEditable)
      )
        return;

      if (event.code === "Space") {
        event.preventDefault(); // Impedisce lo scroll della pagina
        d3.select("#reset").dispatch("click");
      }
    });

    function clearSelectedEdge() {
      if (selectedEdgeDatum) {
        d3.select(`#link-path-${links.indexOf(selectedEdgeDatum)}`)
          .attr("stroke", EDGE_COLOR)
          .attr("stroke-width", 0.4);
      }
      selectedEdgeDatum = null;
      updateFarMarkerHighlight();
    }

    function interactionIconHTML(typeLabel) {
      if (!SHOW_INTERACTION_SYMBOLS) return "";
      const role = interactionRole(typeLabel);
      if (role === "neutral") {
        return `<span class="ni-dot"></span>`;
      }
      const color = INTERACTION_COLOR[role];
      return `<span class="ni-chevron${
        role === "passive" ? " ni-chevron--in" : ""
      }" style="border-top-color:${color}; border-right-color:${color};"></span>`;
    }

    let notObservedSpotlightActive = false;
    const NOT_OBSERVED_TOOLTIP = {
      off: "Evidenzia le specie senza osservazioni su iNaturalist",
      on: "Torna alla vista completa",
    };
    function syncNotObservedToggle(active) {
      notObservedSpotlightActive = active;
      d3.select("#not-observed-toggle")
        .classed("active", active)
        .attr("data-tooltip", NOT_OBSERVED_TOOLTIP[active ? "on" : "off"]);
    }

    function selectNode(d) {
      syncNotObservedToggle(false);
      clearSelectedEdge();
      const clickedId = d.scientific_name;
      const connected = adjacency[clickedId] || new Set();

      node.style("opacity", (nd) =>
        nd.scientific_name === clickedId || connected.has(nd.scientific_name)
          ? 1
          : FOCUS_DIM_OPACITY
      );
      curvedLinks.style("opacity", (lk) =>
        lk.source.scientific_name === clickedId ||
        lk.target.scientific_name === clickedId
          ? 1
          : FOCUS_DIM_OPACITY
      );
      container
        .selectAll("circle.bg")
        .style("opacity", (bgd) =>
          bgd.scientific_name === clickedId ||
          connected.has(bgd.scientific_name)
            ? 1
            : FOCUS_DIM_OPACITY
        );

      if (FOCUS_BLUR_PX > 0) {
        const blurIfUnrelated = (nd) =>
          nd.scientific_name === clickedId || connected.has(nd.scientific_name)
            ? null
            : `blur(${FOCUS_BLUR_PX}px)`;
        node.style("filter", blurIfUnrelated);
        container.selectAll("circle.bg").style("filter", blurIfUnrelated);
      }

      edgeLabels.selectAll("*").remove();

      selectedNodeId = clickedId;

      node
        .attr("stroke", (nd) =>
          nd.scientific_name === clickedId ? "#F4F4F4" : "#646466"
        )
        .attr("stroke-width", (nd) =>
          nd.scientific_name === clickedId ? 1.2 : 0.4
        )
        .attr("stroke-dasharray", (nd) =>
          nd.scientific_name === clickedId
            ? null
            : nd.notObserved
            ? "4 3"
            : null
        );

      syncTextPaths(); // le etichette lavorano sui path-guida: vanno allineati ora
      const edgesToShow = links.filter((lk) => {
        const src =
          typeof lk.source === "object" ? lk.source.scientific_name : lk.source;
        const tgt =
          typeof lk.target === "object" ? lk.target.scientific_name : lk.target;
        return src === clickedId || tgt === clickedId;
      });

      const chevronEdges = edgesToShow.filter(
        (lk) => !SYMMETRIC_TYPES.has(lk.type)
      );
      nodeChevrons.selectAll("path").remove();
      nodeChevrons
        .selectAll("path")
        .data(chevronEdges)
        .enter()
        .append("path")
        .attr("class", "node-chevron")
        .attr("fill", "none")
        .attr("stroke", "none")
        .attr("marker-end", nearChevronMarker)
        .style("pointer-events", "none");

      nodeFarChevrons.selectAll("path").remove();
      nodeFarChevrons
        .selectAll("path")
        .data(chevronEdges)
        .enter()
        .append("path")
        .attr("class", "node-chevron-far")
        .attr("fill", "none")
        .attr("stroke", "none")
        .attr("marker-end", farChevronMarker)
        .style("pointer-events", "none");

      const neutralDotEdges = edgesToShow.filter((lk) =>
        SYMMETRIC_TYPES.has(lk.type)
      );
      nodeNeutralDots.selectAll("circle").remove();
      nodeNeutralDots
        .selectAll("circle")
        .data(neutralDotEdges)
        .enter()
        .append("circle")
        .attr("class", "node-neutral-dot")
        .attr("r", SHOW_INTERACTION_SYMBOLS ? 2 : 0)
        .attr("fill", "#F4F4F4")
        .attr("stroke", "none")
        .style("pointer-events", "none");

      nodeFarNeutralDots.selectAll("circle").remove();
      nodeFarNeutralDots
        .selectAll("circle")
        .data(neutralDotEdges)
        .enter()
        .append("circle")
        .attr("class", "node-neutral-dot-far")
        .attr("r", SHOW_INTERACTION_SYMBOLS ? 2 : 0)
        .attr("fill", farDotFill)
        .attr("stroke", "none")
        .style("pointer-events", "none");

      updateNodeChevrons();

      edgeLabels
        .selectAll("text")
        .data(edgesToShow)
        .enter()
        .append("text")
        .attr("class", "edge-label")
        .attr("font-size", 8)
        .attr("fill", (d) => interactionColor(labelForViewpoint(d, clickedId)))
        .attr("pointer-events", "none")
        .append("textPath")
        .attr("xlink:href", (d, i) => `#link-text-path-${links.indexOf(d)}`)
        .attr("startOffset", "50%")
        .attr("text-anchor", "middle")
        .text((d) => labelForViewpoint(d, clickedId));

      setActiveEdges(edgesToShow);

      const interactionCounts = {};
      edgesToShow.forEach((edge) => {
        const label = labelForViewpoint(edge, clickedId);
        if (!interactionCounts[label]) interactionCounts[label] = 0;
        interactionCounts[label]++;
      });

      const interactionRows = Object.entries(interactionCounts)
        .map(
          ([type, count]) => `
        <div class="ni-row" data-type="${type.replace(/"/g, "&quot;")}">
          <span class="ni-icon-slot">${interactionIconHTML(type)}</span>
          <span class="ni-type" style="color:${interactionColor(
            type
          )}">${type}</span>
          <span class="ni-count-badge">${count}</span>
          <span class="ni-unit">specie</span>
        </div>`
        )
        .join("");

      infoBox
        .html(
          `
      <div class="ni-root">
        <div class="ni-header">
          <div class="ni-name-block">
            <div class="ni-name">${d.name}</div>
            <div class="ni-sci">${d.scientific_name}</div>
          </div>
          <figure class="ni-figure">
            <img class="ni-photo" src="${d.image}" alt="${d.name}" />
            ${
              photoCreditHTML(d)
                ? `<figcaption class="ni-credit">${photoCreditHTML(d)}</figcaption>`
                : ""
            }
          </figure>
        </div>
        <div class="ni-stats">
          ${
            Number.isFinite(d.observations)
              ? `<div class="ni-stat-row">
            <span>Osservazioni iNaturalist</span>
            <span class="ni-stat-value">${d.observations}</span>
          </div>
          <div class="ni-divider"></div>`
              : ""
          }
          <div class="ni-stat-row">
            <span>Specie con cui interagisce</span>
            <span class="ni-stat-value">${
              adjacency[clickedId]?.size || 0
            }</span>
          </div>
          <div class="ni-divider"></div>
          <div class="ni-interactions">
            <div class="ni-interactions-title">Interazioni</div>
            ${
              interactionRows ||
              `<div class="ni-row ni-row--empty">Nessuna</div>`
            }
          </div>
        </div>
      </div>
    `
        )
        .style("opacity", 1);

      infoBox.selectAll(".ni-row[data-type]").each(function () {
        const row = this;
        row.querySelectorAll(".ni-count-badge").forEach((hot) => {
          hot.addEventListener("mouseenter", () =>
            applyInteractionHover(row.dataset.type)
          );
          hot.addEventListener("mouseleave", () => applyInteractionHover(null));
        });
      });
    }

    function applyInteractionHover(type) {
      if (!selectedNodeId || tourLockPolicy) return;
      const clickedId = selectedNodeId;
      const connected = adjacency[clickedId] || new Set();
      const endId = (e) => (typeof e === "object" ? e.scientific_name : e);
      const touches = (lk) =>
        endId(lk.source) === clickedId || endId(lk.target) === clickedId;
      const isMatch = (lk) =>
        touches(lk) && labelForViewpoint(lk, clickedId) === type;

      if (type === null) {
        const base = (nd) =>
          nd.scientific_name === clickedId || connected.has(nd.scientific_name)
            ? 1
            : FOCUS_DIM_OPACITY;
        const blurBase = (nd) =>
          nd.scientific_name === clickedId || connected.has(nd.scientific_name)
            ? null
            : FOCUS_BLUR_PX > 0
            ? `blur(${FOCUS_BLUR_PX}px)`
            : null;
        node.style("opacity", base).style("filter", blurBase);
        container
          .selectAll("circle.bg")
          .style("opacity", base)
          .style("filter", blurBase);
        curvedLinks.style("opacity", (lk) =>
          touches(lk) ? 1 : FOCUS_DIM_OPACITY
        );
        edgeLabels.selectAll("text").style("opacity", null);
        [nodeChevrons, nodeFarChevrons].forEach((g) =>
          g.selectAll("path").style("opacity", null)
        );
        [nodeNeutralDots, nodeFarNeutralDots].forEach((g) =>
          g.selectAll("circle").style("opacity", null)
        );
        return;
      }

      const matchIds = new Set();
      links.forEach((lk) => {
        if (!isMatch(lk)) return;
        const a = endId(lk.source);
        const b = endId(lk.target);
        matchIds.add(a === clickedId ? b : a);
      });
      const lit = (nd) =>
        nd.scientific_name === clickedId || matchIds.has(nd.scientific_name);
      const opacityFor = (nd) =>
        lit(nd)
          ? 1
          : connected.has(nd.scientific_name)
          ? INTERACTION_HOVER_DIM
          : FOCUS_DIM_OPACITY;
      const blurFor = (nd) =>
        lit(nd) || FOCUS_BLUR_PX <= 0 ? null : `blur(${FOCUS_BLUR_PX}px)`;
      node.style("opacity", opacityFor).style("filter", blurFor);
      container
        .selectAll("circle.bg")
        .style("opacity", opacityFor)
        .style("filter", blurFor);
      curvedLinks.style("opacity", (lk) =>
        isMatch(lk)
          ? 1
          : touches(lk)
          ? INTERACTION_HOVER_DIM
          : FOCUS_DIM_OPACITY
      );
      const edgeOpacity = (lk) => (isMatch(lk) ? 1 : INTERACTION_HOVER_DIM);
      edgeLabels.selectAll("text").style("opacity", edgeOpacity);
      [nodeChevrons, nodeFarChevrons].forEach((g) =>
        g.selectAll("path").style("opacity", edgeOpacity)
      );
      [nodeNeutralDots, nodeFarNeutralDots].forEach((g) =>
        g.selectAll("circle").style("opacity", edgeOpacity)
      );
    }

    node.on("click", (event, d) => {
      event.stopPropagation();
      if (!tourAllowsNodeClick(d)) return;
      selectNode(d);
    });

    svg.on("click", () => {
      if (tourLockPolicy) return;
      resetHighlightAndLabels();
      infoBox.style("opacity", 0);
      closeSearchResults();
    });

    // ======================================================================
    // BARRA DI RICERCA

    if (!document.getElementById("search-box-styles")) {
      const searchStyle = document.createElement("style");
      searchStyle.id = "search-box-styles";
      searchStyle.textContent = `
      #search-box {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        width: 320px;
        max-width: calc(100vw - 40px);
        font-family: Inconsolata, monospace;
        z-index: 10;
        box-sizing: border-box;
      }
      /* Il contatore "top-species-counter" è largo 300px e ancorato a
         right:0. Centrando la ricerca, sotto i ~960px di larghezza i due
         riquadri arriverebbero a toccarsi: qui la ricerca scende su una
         seconda riga (sotto il contatore) invece di sovrapporsi. La soglia
         (960px) è quella a cui, con ricerca centrata di 320px e contatore
         di 300px + 20px di margine, i due bordi si toccano. */
      @media (max-width: 960px) {
        #search-box { top: 110px; }
      }
      #search-box *,
      #search-box *::before,
      #search-box *::after {
        box-sizing: border-box;
      }
      /* Un CSS globale del tipo "svg { width: ...; height: ... }" ha
         specificità più alta degli attributi width/height messi
         sull'elemento: senza queste regole esplicite l'icona della
         lente erediterebbe quella dimensione, finendo per riempire
         l'intera barra invece di restare una piccola icona 14x14. */
      #search-box svg.search-icon {
        flex: 0 0 14px;
        width: 14px !important;
        height: 14px !important;
        max-width: 14px;
        max-height: 14px;
        display: block;
        background: none !important; /* lo svg erediterebbe lo sfondo nero della regola globale "svg { background: black }" */
      }
      #search-field {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 14px;
        background: var(--panel); /* come i bottoni: stesso fondo, bordo e pillola */
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        border-radius: var(--radius-pill);
        border: 1px solid var(--border-ctrl);
        transition: border-color var(--t), background-color var(--t);
      }
      #search-field:hover { border-color: var(--border-strong); }
      #search-box.is-focused #search-field { border-color: var(--border-strong); }
      #search-input {
        flex: 1 1 auto;
        min-width: 0;
        width: auto;
        background: transparent;
        border: none;
        outline: none;
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.2;
        padding: 0;
        height: auto;
      }
      #search-input::placeholder { color: var(--text-dim); }
      #search-clear {
        flex: 0 0 auto;
        width: auto;
        height: auto;
        background: none;
        border: none;
        color: var(--text-dim);
        font-family: inherit;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        padding: 0 2px;
        display: none;
      }
      #search-clear:hover { color: var(--text); }
      #search-box.has-query #search-clear { display: block; }
      #search-results {
        display: none;
        margin-top: 8px;
        background: var(--panel);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        border: 1px solid var(--border-ctrl);
        border-radius: 20px; /* estensione della barra a pillola: angoli tondi */
        padding: 6px;
        max-height: 46vh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      #search-box.is-open #search-results { display: block; }
      .search-result {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        cursor: pointer;
        border-radius: 14px;
      }
      .search-result:hover,
      .search-result.is-active { background: var(--hover-bg); }
      .search-result img {
        flex: 0 0 32px;
        width: 32px !important;
        height: 32px !important;
        max-width: 32px;
        max-height: 32px;
        border-radius: 50%;
        object-fit: cover;
        background: #222;
      }
      .search-result.not-observed img { filter: saturate(0); }
      .sr-text { flex: 1 1 auto; min-width: 0; }
      .sr-name {
        color: var(--text);
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sr-sci {
        color: var(--text-dim);
        font-size: 12px;
        font-style: italic;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sr-deg { flex: 0 0 auto; color: var(--text-dim); font-size: 12px; }
      .search-result mark { background: none; color: var(--text); font-weight: 700; }
      #search-empty { padding: 12px; color: var(--text-dim); font-size: 12px; }
    `;
      document.head.appendChild(searchStyle);
    }

    const searchFields = Array.from(
      new Set(
        ["name", "scientific_name"].concat(
          Object.keys(nodes[0] || {}).filter((k) =>
            /name|nome|specie|species/i.test(k)
          )
        )
      )
    ).filter((k) => nodes.some((n) => typeof n[k] === "string" && n[k].trim()));

    function normalizeForSearch(value) {
      return String(value == null ? "" : value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    nodes.forEach((d) => {
      d.__search = searchFields.map((f) => normalizeForSearch(d[f]));
    });

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function highlightMatch(raw, query) {
      const text = String(raw == null ? "" : raw);
      if (!query) return escapeHtml(text);
      const i = normalizeForSearch(text).indexOf(query);
      if (i < 0) return escapeHtml(text);
      return (
        escapeHtml(text.slice(0, i)) +
        "<mark>" +
        escapeHtml(text.slice(i, i + query.length)) +
        "</mark>" +
        escapeHtml(text.slice(i + query.length))
      );
    }

    function scoreNode(d, query) {
      let best = Infinity;
      d.__search.forEach((value, fieldRank) => {
        if (!value) return;
        const i = value.indexOf(query);
        if (i < 0) return;
        const position = i === 0 ? 0 : /[\s\-'']/.test(value[i - 1]) ? 1 : 2;
        best = Math.min(best, position * 10 + fieldRank);
      });
      return best === Infinity ? null : best;
    }

    const MAX_RESULTS = 12;
    let currentResults = [];
    let activeIndex = -1;

    const searchBox = d3.select("body").append("div").attr("id", "search-box");
    const searchField = searchBox.append("div").attr("id", "search-field");

    searchField
      .append("svg")
      .attr("class", "search-icon")
      .attr("width", 14)
      .attr("height", 14)
      .attr("viewBox", "0 0 14 14")
      .html(
        '<circle cx="6" cy="6" r="4.5" fill="none" stroke="#8a8a8c" stroke-width="1.4"/>' +
          '<line x1="9.4" y1="9.4" x2="13" y2="13" stroke="#8a8a8c" stroke-width="1.4" stroke-linecap="round"/>'
      );

    const searchInput = searchField
      .append("input")
      .attr("id", "search-input")
      .attr("type", "text")
      .attr("autocomplete", "off")
      .attr("spellcheck", "false")
      .attr("placeholder", "Cerca una specie\u2026");

    const searchClear = searchField
      .append("button")
      .attr("id", "search-clear")
      .attr("type", "button")
      .attr("aria-label", "Cancella la ricerca")
      .attr("data-tooltip", "Cancella la ricerca")
      .attr("data-tooltip-pos", "bottom")
      .attr("data-tooltip-align", "end")
      .text("\u00d7");

    const searchResults = searchBox.append("div").attr("id", "search-results");

    const inputEl = searchInput.node();
    const resultsEl = searchResults.node();

    function closeSearchResults() {
      searchBox.classed("is-open", false);
      activeIndex = -1;
    }

    function renderResults(query) {
      if (!query) {
        currentResults = [];
        closeSearchResults();
        return;
      }

      currentResults = nodes
        .map((d) => ({ node: d, score: scoreNode(d, query) }))
        .filter((r) => r.score !== null)
        .sort(
          (a, b) =>
            a.score - b.score ||
            b.node.degree - a.node.degree ||
            String(a.node.name).localeCompare(String(b.node.name))
        )
        .slice(0, MAX_RESULTS)
        .map((r) => r.node);

      activeIndex = currentResults.length ? 0 : -1;

      if (!currentResults.length) {
        resultsEl.innerHTML =
          '<div id="search-empty">Nessuna specie trovata.</div>';
      } else {
        resultsEl.innerHTML = currentResults
          .map(
            (d, i) => `
        <div class="search-result${i === activeIndex ? " is-active" : ""}${
              d.notObserved ? " not-observed" : ""
            }" data-index="${i}">
          <img src="${escapeHtml(d.image)}" alt="" />
          <div class="sr-text">
            <div class="sr-name">${highlightMatch(d.name, query)}</div>
            <div class="sr-sci">${highlightMatch(
              d.scientific_name,
              query
            )}</div>
          </div>
          <div class="sr-deg">${d.degree}</div>
        </div>
      `
          )
          .join("");
      }

      searchBox.classed("is-open", true);
    }

    function setActiveIndex(next) {
      if (!currentResults.length) return;
      // Scorrimento circolare: da fondo elenco si torna in cima e viceversa.
      activeIndex = (next + currentResults.length) % currentResults.length;
      const items = resultsEl.querySelectorAll(".search-result");
      items.forEach((el, i) =>
        el.classList.toggle("is-active", i === activeIndex)
      );
      const active = items[activeIndex];
      if (active) active.scrollIntoView({ block: "nearest" });
    }

    function focusOnNode(d) {
      hasAutoFitted = true;

      const current = d3.zoomTransform(svg.node());
      const scale = Math.min(Math.max(current.k, 1.1), 2.2);
      const targetX = width * 0.42;
      const targetY = height * 0.5;

      svg
        .transition()
        .duration(750)
        .ease(d3.easeCubicOut)
        .call(
          zoom.transform,
          d3.zoomIdentity
            .translate(targetX - scale * d.x, targetY - scale * d.y)
            .scale(scale)
        );
    }

    function chooseResult(d) {
      if (!d) return;
      inputEl.value = d.name;
      searchBox.classed("has-query", true);
      closeSearchResults();
      inputEl.blur();
      selectNode(d);
      focusOnNode(d);
    }

    searchInput
      .on("input", () => {
        const query = normalizeForSearch(inputEl.value);
        searchBox.classed("has-query", inputEl.value.length > 0);
        renderResults(query);
      })
      .on("focus", () => {
        searchBox.classed("is-focused", true);
        if (currentResults.length) searchBox.classed("is-open", true);
      })
      .on("blur", () => searchBox.classed("is-focused", false))
      .on("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex(activeIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex(activeIndex - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          chooseResult(currentResults[activeIndex]);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeSearchResults();
          inputEl.blur();
        }
      });

    function clearSearchInput() {
      inputEl.value = "";
      searchBox.classed("has-query", false);
      currentResults = [];
      closeSearchResults();
    }

    searchClear.on("click", () => {
      clearSearchInput();
      inputEl.focus();
      resetHighlightAndLabels();
      infoBox.style("opacity", 0);
    });

    searchResults
      .on("mousedown", (event) => event.preventDefault())
      .on("click", (event) => {
        const item = event.target.closest(".search-result");
        if (!item) return;
        chooseResult(currentResults[+item.dataset.index]);
      });

    document.addEventListener("click", (event) => {
      if (!searchBox.node().contains(event.target)) clearSearchInput();
    });

    document.addEventListener("keydown", (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (tourLockPolicy) return;
      if (event.key === "/") {
        event.preventDefault();
        inputEl.focus();
        inputEl.select();
      }
    });

    function resetHighlightAndLabels() {
      syncNotObservedToggle(false);
      clearSelectedEdge();
      node.style("opacity", 1);
      curvedLinks.style("opacity", 1);
      container.selectAll("circle.bg").style("opacity", 1);
      node.style("filter", null);
      container.selectAll("circle.bg").style("filter", null);
      edgeLabels.selectAll("*").remove();
      selectedNodeId = null;
      node
        .attr("stroke", "#646466")
        .attr("stroke-width", 0.4)
        .attr("stroke-dasharray", (nd) => (nd.notObserved ? "4 3" : null));
      nodeChevrons.selectAll("path").remove();
      nodeFarChevrons.selectAll("path").remove();
      nodeNeutralDots.selectAll("circle").remove();
      nodeFarNeutralDots.selectAll("circle").remove();
      setActiveEdges([]);
    }

    let isMouseDragging = false;

    zoom = d3
      .zoom()
      .scaleExtent([0.1, 5])
      .filter((event) => {
        if (event.type === "wheel") {
          if (isMouseDragging) return false;
          return true;
        }
        return !event.ctrlKey && !event.button;
      })
      .on("start", (event) => {
        setMoving(true);
        if (event.sourceEvent && event.sourceEvent.type === "mousedown") {
          isMouseDragging = true;
        }
        if (!selectedNodeId) {
          edgeLabels.style("display", "none");
        }
      })
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
        updateViewLabels(event.transform.k);
        if (lastBoundary)
          updateTextPath(lastBoundary.radius, lastBoundary.cx, lastBoundary.cy);
      })
      .on("end", () => {
        setMoving(false);
        isMouseDragging = false;
        edgeLabels.style("display", null);
      });

    svg.call(zoom);

    svg.on("dblclick.zoom", null);

    // Pre-assestamento: la rete si calcola subito (senza mostrarsi) e la
    // vista parte già inquadrata, senza il salto di zoom dopo la pausa.
    simulation.stop();
    // (in un microtask: parte appena finita l'inizializzazione, prima del primo disegno)
    Promise.resolve().then(() => {
      const tickHandler = simulation.on("tick");
      for (let i = 0; i < 300; i++) {
        simulation.tick();
        if (tickHandler && i % 50 === 49) tickHandler();
      }
      if (tickHandler) tickHandler();
      scaleAndCenter(nodes, false);
      hasAutoFitted = true;
      simulation.alpha(0.05).restart();
    });

    simulation.on("end", () => {
      if (!hasAutoFitted) {
        hasAutoFitted = true;
        scaleAndCenter(nodes);
      }
    });

    setTimeout(() => {
      if (!hasAutoFitted) {
        hasAutoFitted = true;
        scaleAndCenter(nodes);
      }
    }, 2000);

    function updateBoundary() {
      const padding = 100;
      const xs = simulation.nodes().map((d) => d.x);
      const ys = simulation.nodes().map((d) => d.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const radius =
        Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2 + padding;

      boundary.attr("cx", centerX).attr("cy", centerY).attr("r", radius);

      updateTextPath(radius, centerX, centerY);
    }

    // Il testo ha dimensione fissa a schermo (indipendente dallo zoom).
    const BOUNDARY_LABEL_PX = 20;
    let lastBoundary = null;
    function updateTextPath(radius, cx, cy) {
      lastBoundary = { radius, cx, cy };
      const k = d3.zoomTransform(svg.node()).k || 1;
      textElement.attr("font-size", BOUNDARY_LABEL_PX / k);
      const rText = radius - 10 / k - BOUNDARY_LABEL_PX / k;
      const d = `
      M ${cx + rText} ${cy}
      A ${rText} ${rText} 0 1 1 ${cx - rText} ${cy}
      A ${rText} ${rText} 0 1 1 ${cx + rText} ${cy}
    `;
      svg.select(`#${textPathId}`).attr("d", d);
    }

    // =====================================================================
    // TOUR GUIDATO "Come leggere la rete"
    // =====================================================================

    function findNodeByName(regex) {
      return nodes.find(
        (n) => regex.test(n.name || "") || regex.test(n.scientific_name || "")
      );
    }

    // Reset "di base" condiviso da tutte le funzioni del tour qui sotto.
    function tourResetVisuals() {
      resetHighlightAndLabels();
      tourClearEdgeEmphasis();
      infoBox.style("opacity", 0);
    }

    function tourClearSpotlight() {
      tourResetVisuals();
    }

    function tourOpenNodeReal(d) {
      if (!d) return;
      selectNode(d);
    }

    let tourHighlightedEdge = null;
    let tourDimmedSiblingEdges = [];
    const TOUR_SIBLING_DIM = 0.4;
    const TOUR_PAIR_FOCUS = { pad: 110, padX: 430, maxScale: 2.8 };

    let tourFocusLayer = null;
    function tourRaiseEdge(edge) {
      tourClearFocusLayer();
      tourFocusLayer = container
        .append("g")
        .attr("class", "tour-focus-layer")
        .style("pointer-events", "none");
      const add = (sel) =>
        sel.each(function () {
          if (!this.id) this.id = `tfl-${Math.random().toString(36).slice(2)}`;
          tourFocusLayer.append("use").attr("href", `#${this.id}`);
        });
      add(d3.select(`#link-path-${links.indexOf(edge)}`));
      [nodeChevrons, nodeFarChevrons].forEach((g) =>
        add(g.selectAll("path").filter((d) => d === edge))
      );
      [nodeNeutralDots, nodeFarNeutralDots].forEach((g) =>
        add(g.selectAll("circle").filter((d) => d === edge))
      );
      // anche la label del collegamento, altrimenti i nodi la coprono
      add(edgeLabels.selectAll("text").filter((d) => d === edge));
    }
    function tourClearFocusLayer() {
      if (tourFocusLayer) tourFocusLayer.remove();
      tourFocusLayer = null;
    }

    function tourApplyEdgeEmphasis(edge, ownerNodeId) {
      tourClearEdgeEmphasis();
      if (!edge) return;
      tourHighlightedEdge = edge;
      d3.select(`#link-path-${links.indexOf(edge)}`)
        .attr("stroke", EDGE_COLOR_ACTIVE)
        .attr("stroke-width", 1.4);
      if (!ownerNodeId) {
        tourRaiseEdge(edge);
        return;
      }

      const otherId =
        nodeIdOf(edge.source) === ownerNodeId
          ? nodeIdOf(edge.target)
          : nodeIdOf(edge.source);

      tourDimmedSiblingEdges = links.filter((lk) => {
        if (lk === edge) return false;
        const s = nodeIdOf(lk.source);
        const t = nodeIdOf(lk.target);
        return s === ownerNodeId || t === ownerNodeId;
      });
      const isSibling = (d) => tourDimmedSiblingEdges.includes(d);

      tourDimmedSiblingEdges.forEach((lk) => {
        d3.select(`#link-path-${links.indexOf(lk)}`).style(
          "opacity",
          TOUR_SIBLING_DIM
        );
      });

      const siblingNeighborIds = new Set();
      tourDimmedSiblingEdges.forEach((lk) => {
        const s = nodeIdOf(lk.source);
        const t = nodeIdOf(lk.target);
        siblingNeighborIds.add(s === ownerNodeId ? t : s);
      });
      siblingNeighborIds.delete(otherId);
      siblingNeighborIds.delete(ownerNodeId);

      node
        .filter((nd) => siblingNeighborIds.has(nd.scientific_name))
        .style("opacity", TOUR_SIBLING_DIM);
      container
        .selectAll("circle.bg")
        .filter((bgd) => siblingNeighborIds.has(bgd.scientific_name))
        .style("opacity", TOUR_SIBLING_DIM);

      nodeChevrons
        .selectAll("path")
        .filter(isSibling)
        .style("opacity", TOUR_SIBLING_DIM);
      nodeFarChevrons
        .selectAll("path")
        .filter(isSibling)
        .style("opacity", TOUR_SIBLING_DIM);
      nodeNeutralDots
        .selectAll("circle")
        .filter(isSibling)
        .style("opacity", TOUR_SIBLING_DIM);
      nodeFarNeutralDots
        .selectAll("circle")
        .filter(isSibling)
        .style("opacity", TOUR_SIBLING_DIM);
      edgeLabels
        .selectAll("text")
        .filter(isSibling)
        .style("opacity", TOUR_SIBLING_DIM);

      const isFocusEdge = (d) => d === edge;
      nodeNeutralDots
        .selectAll("circle")
        .filter(isFocusEdge)
        .attr("r", SHOW_INTERACTION_SYMBOLS ? 4 : 0);
      nodeFarNeutralDots
        .selectAll("circle")
        .filter(isFocusEdge)
        .attr("r", SHOW_INTERACTION_SYMBOLS ? 4 : 0);
      tourRaiseEdge(edge);
    }
    function tourClearEdgeEmphasis() {
      tourClearFocusLayer();
      if (tourHighlightedEdge) {
        d3.select(`#link-path-${links.indexOf(tourHighlightedEdge)}`)
          .attr("stroke", EDGE_COLOR)
          .attr("stroke-width", 0.4);
      }
      tourHighlightedEdge = null;
      tourDimmedSiblingEdges.forEach((lk) => {
        d3.select(`#link-path-${links.indexOf(lk)}`).style("opacity", null);
      });
      tourDimmedSiblingEdges = [];
    }

    function tourOpenNodeWithEdgeFocus(d, edge) {
      tourOpenNodeReal(d);
      tourApplyEdgeEmphasis(edge, d ? d.scientific_name : null);
    }

    let tourFocusToken = 0;
    function tourFocusOnPoints(points, options, isRefit) {
      if (!points || points.length === 0) return;
      hasAutoFitted = true;
      const token = isRefit ? tourFocusToken : ++tourFocusToken;
      if (!isRefit) {
        const snap = points.map((p) => [p.x, p.y]);
        setTimeout(() => {
          if (token !== tourFocusToken) return;
          const moved = points.some(
            (p, i) => Math.hypot(p.x - snap[i][0], p.y - snap[i][1]) > 4
          );
          if (moved) tourFocusOnPoints(points, options, true);
        }, 800);
      }
      const pad = options?.pad ?? 180;
      const padX = options?.padX ?? pad; // margine laterale (può essere più largo: l'inspector sta a destra)
      const maxScale = options?.maxScale ?? 2.2;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const spanX = Math.max(maxX - minX, 1);
      const spanY = Math.max(maxY - minY, 1);
      const usableHeight = height * 0.6; // la card occupa la fascia bassa
      const scale = Math.min(
        (width - padX * 2) / spanX,
        (usableHeight - pad * 2) / spanY,
        maxScale
      );
      const scaleClamped = Math.max(Math.min(scale, maxScale), 0.7);
      const targetX = width / 2;
      const targetY = height * 0.38;
      svg
        .transition()
        .duration(700)
        .ease(d3.easeCubicOut)
        .call(
          zoom.transform,
          d3.zoomIdentity
            .translate(targetX - scaleClamped * cx, targetY - scaleClamped * cy)
            .scale(scaleClamped)
        );
    }

    function tourFocusOnWholeGraph() {
      hasAutoFitted = true;
      scaleAndCenter(nodes);
    }

    // ---- Step "interazioni direzionali": Biacco/Scoiattolo dal vivo ----
    let tourPairIds = null; // {a, b, edge} risolti all'inizio del tour (step "cover")

    function resolveDirectionalExample() {
      const biacco = findNodeByName(/biacco/i);
      const poiana = findNodeByName(/poiana/i);
      let edge = null;
      let aId = null;
      let bId = null;
      if (biacco && poiana) {
        edge = links.find((lk) => {
          const s = nodeIdOf(lk.source);
          const t = nodeIdOf(lk.target);
          return (
            (s === biacco.scientific_name && t === poiana.scientific_name) ||
            (s === poiana.scientific_name && t === biacco.scientific_name)
          );
        });
        if (edge) {
          aId = biacco.scientific_name;
          bId = poiana.scientific_name;
        }
      }
      if (!edge || SYMMETRIC_TYPES.has(edge.type)) {
        edge = links.find((lk) => !SYMMETRIC_TYPES.has(lk.type));
        aId = edge ? nodeIdOf(edge.source) : null;
        bId = edge ? nodeIdOf(edge.target) : null;
      }
      tourPairIds = edge ? { a: aId, b: bId, edge } : null;
    }

    function directionalIntroHTML() {
      const glyph = (inner) =>
        `<span class="ni-count-badge guide-glyph">${inner}</span>`;
      return `
        <p class="guide-step-body">Ogni interazione ha un verso, segnalato da una freccia che può essere:</p>
        <div class="guide-legend">
          <span>uscente</span>${glyph(
            '<span class="ni-chevron"></span>'
          )}<span>(attiva)</span>
          <span>entrante</span>${glyph(
            '<span class="ni-chevron ni-chevron--in"></span>'
          )}<span>(passiva)</span>
          <span>pallino</span>${glyph(
            '<span class="ni-dot"></span>'
          )}<span>(neutra)</span>
        </div>`;
    }

    function directionalSwitchHTML() {
      if (!tourPairIds) {
        return `<p class="guide-step-body">Esempio non disponibile con i dati caricati in questo momento.</p>`;
      }
      const nodeA = nodeByName.get(tourPairIds.a);
      const nodeB = nodeByName.get(tourPairIds.b);
      const labelA = labelForViewpoint(tourPairIds.edge, tourPairIds.a);
      const labelB = labelForViewpoint(tourPairIds.edge, tourPairIds.b);
      const verb = (label, subject) => {
        const passive = interactionRole(label) === "passive";
        const text =
          passive && /a$/i.test(subject.trim())
            ? label.replace(/(\w)ato da$/i, "$1ata da")
            : label;
        return `${passive ? "è " : ""}<em>${text}</em>`;
      };
      const flow = (from, label, to) => {
        const dir = interactionRole(label) === "passive" ? "in" : "out";
        return `<div class="guide-flow-row">
          <span class="guide-flow-name">${from.name}</span>
          <span class="guide-flow-arrow guide-flow-arrow--${dir}"><span class="guide-flow-label">${label}</span></span>
          <span class="guide-flow-name">${to.name}</span>
        </div>`;
      };
      return `
        <p class="guide-step-body">A seconda del nodo cliccato, la stessa interazione si modifica. <strong>${
          nodeA.name
        }</strong> ${verb(labelA, nodeA.name)} <strong>${
        nodeB.name
      }</strong>, la stessa relazione può essere letta anche come <strong>${
        nodeB.name
      }</strong> ${verb(labelB, nodeB.name)} <strong>${nodeA.name}</strong>.</p>
        <div class="guide-flow">
          ${flow(nodeA, labelA, nodeB)}
          <div class="guide-flow-eq">=</div>
          ${flow(nodeB, labelB, nodeA)}
        </div>`;
    }

    // ---- Step "interazioni reciproche": prima coppia neutra reale trovata ----
    let tourNeutralPair = null;
    function resolveNeutralExample() {
      const edge = links.find((lk) => SYMMETRIC_TYPES.has(lk.type));
      tourNeutralPair = edge
        ? { a: nodeIdOf(edge.source), b: nodeIdOf(edge.target), edge }
        : null;
    }
    function neutralGuidanceHTML() {
      return `<p class="guide-step-body">In alcuni casi le interazioni non hanno verso, sono reciproche. In queste relazioni non esistono attori attivi o passivi.</p>`;
    }

    // ---- Step "specie non osservate": bianco e nero = 0 osservazioni ----
    const NOT_OBSERVED_ANIM_MS = 0;
    let spotlightAnimTimer = null;
    function playSpotlightAnimation() {
      const reduce =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (NOT_OBSERVED_ANIM_MS <= 0 || reduce) return;
      document.body.style.setProperty(
        "--spotlight-ms",
        `${NOT_OBSERVED_ANIM_MS}ms`
      );
      document.body.classList.add("spotlight-anim");
      clearTimeout(spotlightAnimTimer);
      spotlightAnimTimer = setTimeout(
        () => document.body.classList.remove("spotlight-anim"),
        NOT_OBSERVED_ANIM_MS + 60
      );
    }

    function applyNotObservedSpotlight(active) {
      playSpotlightAnimation();
      if (active) {
        tourResetVisuals();
        syncNotObservedToggle(true);
        node.style("opacity", (nd) => (nd.notObserved ? 1 : 0.08));
        container
          .selectAll("circle.bg")
          .style("opacity", (bgd) => (bgd.notObserved ? 1 : 0.08));
        curvedLinks.style("opacity", 0.05);
        if (FOCUS_BLUR_PX > 0) {
          const blurIfObserved = (nd) =>
            nd.notObserved ? null : `blur(${FOCUS_BLUR_PX}px)`;
          node.style("filter", blurIfObserved);
          container.selectAll("circle.bg").style("filter", blurIfObserved);
        }
      } else {
        syncNotObservedToggle(false);
        node.style("opacity", 1);
        node.style("filter", null);
        container.selectAll("circle.bg").style("opacity", 1);
        container.selectAll("circle.bg").style("filter", null);
        curvedLinks.style("opacity", 1);
      }
    }
    function notObservedGuidanceHTML() {
      return `
        <p class="guide-step-body">Tutti possono contribuire ad ampliare o completare la rete, scopri quali specie non sono ancora state osservate nelle Cave di Noale, esplora l'oasi e prova a trovarle tu.</p>
        <a class="guide-link" href="https://www.inaturalist.org/" target="_blank" rel="noopener">Scopri iNaturalist</a>`;
    }

    let notObservedToggle = d3.select("body").select("#not-observed-toggle");
    if (notObservedToggle.empty()) {
      notObservedToggle = d3
        .select("body")
        .append("button")
        .attr("id", "not-observed-toggle");
    }
    notObservedToggle
      .attr("aria-label", "Solo specie non osservate")
      .html(
        `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3.2"/></svg>`
      );
    notObservedToggle
      .attr("data-tooltip", NOT_OBSERVED_TOOLTIP.off)
      .attr("data-tooltip-align", "start");
    notObservedToggle.on("click", () =>
      applyNotObservedSpotlight(!notObservedSpotlightActive)
    );

    // ---- Vista "Sguardo": stessa rete, stessa dimensione dei nodi, ma
    // disposti in anelli per numero di osservazioni a Cave di Noale ----
    const VIEW_RING_LABELS = [
      "3+ osservazioni",
      "2 osservazioni",
      "1 osservazione",
      "nessuna osservazione",
    ];
    const VIEW_TOOLTIP = {
      off: "Disponi le specie per numero di osservazioni",
      on: "Torna alla rete",
    };
    const obsRing = (d) => {
      const o = Number.isFinite(d.observations) ? d.observations : 0;
      return o >= 3 ? 0 : o === 2 ? 1 : o === 1 ? 2 : 3;
    };
    const linkForce = simulation.force("link");
    const chargeForce = simulation.force("charge");
    const labelGapForce = simulation.force("labelGap");
    const linkStrengthRete = linkForce.strength();
    const viewRings = container
      .insert("g", ":first-child")
      .attr("id", "view-rings")
      .style("pointer-events", "none")
      .style("opacity", 0);

    // Fasce: ogni fascia ha un'area proporzionale ai nodi che contiene, così
    // le fasce affollate si allargano in spessore invece di spingere lontano
    // l'anello e lasciare vuoti tra una fascia e l'altra.
    function computeViewRings() {
      const pad = 8;
      const gap = 300; // distanza tra una fascia e la successiva
      const groups = [[], [], [], []];
      nodes.forEach((d) => groups[obsRing(d)].push(d));
      const target = new Map();
      const R = [];
      let rIn = 0;
      groups.forEach((g, k) => {
        const area = g.reduce(
          (sum, d) => sum + Math.PI * Math.pow(sizeScale(d.degree) + pad, 2) * 1.7,
          0
        );
        const rOut = Math.sqrt(rIn * rIn + area / Math.PI);
        g.sort((p, q) => q.degree - p.degree).forEach((d, i) => {
          const t = (i + 0.5) / g.length;
          target.set(d, Math.sqrt(rIn * rIn + t * (rOut * rOut - rIn * rIn)));
        });
        R[k] = rOut;
        rIn = rOut + gap;
      });
      R.target = target;
      return R;
    }
    const VIEW_LABEL_PX = 15; // dimensione a schermo, indipendente dallo zoom
    let viewRingRadii = [];
    function updateViewLabels(k) {
      if (!viewRingRadii.length) return;
      viewRings
        .selectAll("text.view-ring-label")
        .attr("font-size", VIEW_LABEL_PX / k)
        .style("stroke-width", 6 / k)
        .attr("y", (d, i) => height / 2 - viewRingRadii[i] - 10 / k);
    }
    function drawViewRings(R) {
      viewRings.selectAll("*").remove();
      viewRingRadii = R.slice();
      R.forEach((r, k) => {
        viewRings
          .append("circle")
          .attr("class", "view-ring")
          .attr("cx", width / 2)
          .attr("cy", height / 2)
          .attr("r", r);
        viewRings
          .append("text")
          .datum(k)
          .attr("class", "view-ring-label")
          .attr("x", width / 2)
          .text(VIEW_RING_LABELS[k]);
      });
      updateViewLabels(d3.zoomTransform(svg.node()).k);
    }

    let viewFitTimer = null;
    let viewRampTimer = null;
    let viewW = 0; // 0 = rete, 1 = sguardo (valore attuale della transizione)
    let viewMidFitTimer = null;
    const VIEW_DECAY_BASE = simulation.velocityDecay();
    let pendingViewFit = false;
    function setViewMode(mode) {
      if (mode === viewMode) return;
      viewMode = mode;
      const sguardo = mode === "sguardo";
      d3.select("#view-toggle")
        .classed("active", sguardo)
        .attr("data-tooltip", VIEW_TOOLTIP[sguardo ? "on" : "off"]);
      // Transizione morbida: invece di cambiare di colpo le forze, le
      // faccio scorrere piano dal valore attuale a quello di arrivo.
      const RAMP_MS = 800;
      const ease = d3.easeCubicInOut;
      let radialForce = simulation.force("radial");
      if (sguardo) {
        const R = computeViewRings();
        drawViewRings(R);
        radialForce = d3
          .forceRadial((d) => R.target.get(d), width / 2, height / 2)
          .strength(0);
        simulation.force("radial", radialForce).force("labelGap", null);
      }
      const w0 = viewW;
      const w1 = sguardo ? 1 : 0;
      simulation.velocityDecay(0.62); // più attrito: i nodi scivolano
      if (viewRampTimer) viewRampTimer.stop();
      viewRampTimer = d3.timer((elapsed) => {
        const t = ease(Math.min(1, elapsed / RAMP_MS));
        viewW = w0 + (w1 - w0) * t;
        const w = viewW;
        if (radialForce) radialForce.strength(0.9 * w);
        linkForce.strength(
          (l, i, ls) => linkStrengthRete(l, i, ls) * (1 - w) + 0.004 * w
        );
        chargeForce.strength(-600 * (1 - w) - 60 * w);
        const xy = 0.02 * (1 - w) + 0.004 * w;
        simulation
          .force("x", d3.forceX(width / 2).strength(xy))
          .force("y", d3.forceY(height / 2).strength(xy));
        if (elapsed >= RAMP_MS) {
          viewRampTimer.stop();
          viewRampTimer = null;
          if (!sguardo) {
            simulation.force("radial", null).force("labelGap", labelGapForce);
            linkForce.strength(linkStrengthRete);
          }
          simulation.velocityDecay(VIEW_DECAY_BASE).alphaTarget(0);
          simulation.alpha(0.3).restart();
        }
      });
      viewRings
        .transition()
        .duration(600)
        .style("opacity", sguardo ? 1 : 0);
      hasAutoFitted = true;
      simulation.alphaTarget(0.3).restart(); // resta viva durante la transizione
      // Inquadra di nuovo quando i nodi si sono assestati.
      pendingViewFit = true;
      clearTimeout(viewFitTimer);
      clearTimeout(viewMidFitTimer);
      viewMidFitTimer = setTimeout(() => {
        if (pendingViewFit && viewMode === mode && !selectedNodeId && !tourLockPolicy)
          scaleAndCenter(nodes); // primo avvicinamento mentre i nodi si muovono
      }, 900);
      viewFitTimer = setTimeout(() => {
        if (pendingViewFit && viewMode === mode && !selectedNodeId && !tourLockPolicy) {
          pendingViewFit = false;
          scaleAndCenter(nodes);
        }
      }, 3200);
    }
    simulation.on("end.view", () => {
      if (pendingViewFit && !selectedNodeId && !tourLockPolicy) {
        pendingViewFit = false;
        scaleAndCenter(nodes);
      }
    });

    let viewToggle = d3.select("body").select("#view-toggle");
    if (viewToggle.empty()) {
      viewToggle = d3.select("body").append("button").attr("id", "view-toggle");
    }
    viewToggle
      .attr("aria-label", "Vista per osservazioni")
      .html(
        `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>`
      )
      .attr("data-tooltip", VIEW_TOOLTIP.off)
      .attr("data-tooltip-align", "start")
      .on("click", () => setViewMode(viewMode === "rete" ? "sguardo" : "rete"));

    let tourClickExampleNode = null; // nodo aperto dallo step "click-species"
    // ---- I 7 step del tour ----
    const GUIDE_STEPS = [
      {
        key: "cover",
        modifier: "cover",
        title: "Come leggere la rete",
        onEnter() {
          resolveDirectionalExample();
          resolveNeutralExample();
          tourClearSpotlight();
          tourFocusOnWholeGraph();
        },
        body: () =>
          `<p class="guide-step-body">Ogni nodo è una specie.<br>Ogni collegamento è un'interazione.<br> Ogni interazione ha un verso.</p>`,
      },
      {
        key: "click-species",
        title: "Le specie",
        onEnter() {
          tourResetVisuals();
          if (!tourPairIds) resolveDirectionalExample();
          tourClickExampleNode =
            findNodeByName(/biacco/i) ||
            (tourPairIds && nodeByName.get(tourPairIds.b)) ||
            null;
          if (tourClickExampleNode) {
            tourOpenNodeReal(tourClickExampleNode);
            tourFocusOnPoints([tourClickExampleNode], { maxScale: 2.4 });
          } else {
            tourFocusOnWholeGraph();
          }
        },
        body: () =>
          `<p class="guide-step-body">Clicca una specie per visualizzare le sue interazioni, scopri i dettagli nell'inspector sulla destra.</p>`,
      },
      {
        key: "directional-intro",
        title: "Il verso dell'interazione",
        onEnter() {
          if (!tourPairIds) resolveDirectionalExample();
          if (tourPairIds) {
            tourResetVisuals();
            tourOpenNodeWithEdgeFocus(
              nodeByName.get(tourPairIds.a),
              tourPairIds.edge
            );
            tourFocusOnPoints(
              [nodeByName.get(tourPairIds.a), nodeByName.get(tourPairIds.b)],
              TOUR_PAIR_FOCUS
            );
          } else {
            tourClearSpotlight();
          }
        },
        body: () => directionalIntroHTML(),
      },
      {
        key: "directional-switch",
        title: "Il verso dell'interazione",
        onEnter() {
          if (!tourPairIds) {
            tourClearSpotlight();
            return;
          }
          tourResetVisuals();
          tourOpenNodeWithEdgeFocus(
            nodeByName.get(tourPairIds.b),
            tourPairIds.edge
          );
          tourFocusOnPoints(
            [nodeByName.get(tourPairIds.a), nodeByName.get(tourPairIds.b)],
            TOUR_PAIR_FOCUS
          );
        },
        body: () => directionalSwitchHTML(),
      },
      {
        key: "neutral",
        title: "Interazioni neutre",
        onEnter() {
          if (!tourNeutralPair) resolveNeutralExample();
          if (tourNeutralPair) {
            tourResetVisuals();
            tourOpenNodeWithEdgeFocus(
              nodeByName.get(tourNeutralPair.a),
              tourNeutralPair.edge
            );
            openEdgeInfo(tourNeutralPair.edge);
            tourFocusOnPoints(
              [
                nodeByName.get(tourNeutralPair.a),
                nodeByName.get(tourNeutralPair.b),
              ],
              { pad: 60, maxScale: 3.4 }
            );
          } else {
            tourClearSpotlight();
          }
        },
        body: () => neutralGuidanceHTML(),
      },
      {
        key: "notobserved",
        title: "Specie non ancora osservate",
        onEnter() {
          applyNotObservedSpotlight(true);
          const pts = nodes.filter((n) => n.notObserved);
          if (pts.length) tourFocusOnPoints(pts);
          else tourFocusOnWholeGraph();
        },
        onLeave() {
          applyNotObservedSpotlight(false);
        },
        body: () => notObservedGuidanceHTML(),
      },
      {
        key: "closing",
        modifier: "cover",
        title: "Esplora la rete",
        onEnter() {
          tourClearSpotlight();
          tourFocusOnWholeGraph();
        },
        body: () =>
          `<p class="guide-step-body">Avvicinati, allontanati, spostati nello spazio, trascina i nodi per districare la rete e farti spazio tra le interazioni non-umane che tengono viva l'oasi.</p>`,
      },
    ];

    let guideStepIndex = 0;
    let guideIsOpen = false;

    let guideCard = d3.select("body").select("#guide-card");
    if (guideCard.empty()) {
      guideCard = d3.select("body").append("div").attr("id", "guide-card");
      guideCard
        .append("button")
        .attr("id", "guide-close")
        .attr("aria-label", "Chiudi il tour")
        .text("×");
      guideCard.append("div").attr("id", "guide-step-content");
      const guideNav = guideCard.append("div").attr("id", "guide-nav");
      guideNav
        .append("button")
        .attr("id", "guide-prev")
        .attr("aria-label", "Step precedente")
        .text("");
      guideNav.append("div").attr("id", "guide-dots");
      guideNav
        .append("button")
        .attr("id", "guide-next")
        .attr("aria-label", "Step successivo")
        .text("");
    }

    function tourLockForStep(key) {
      if (key === "click-species") return { nodes: "all" };
      if (key === "directional-intro" || key === "directional-switch") {
        return tourPairIds
          ? { nodes: "pair", ids: [tourPairIds.a, tourPairIds.b] }
          : { nodes: "none" };
      }
      if (key === "neutral") {
        return tourNeutralPair
          ? { nodes: "pair", ids: [tourNeutralPair.a, tourNeutralPair.b] }
          : { nodes: "none" };
      }
      return { nodes: "none" };
    }
    function setTourLock(policy) {
      tourLockPolicy = policy;
      const locked = !!policy;
      document.body.classList.toggle("tour-locked", locked);
      // "inert" toglie anche focus e tastiera, non solo il mouse.
      searchBox.node().inert = locked;
      topSpeciesCounter.node().inert = locked;
      const noBtn = document.getElementById("not-observed-toggle");
      if (noBtn) noBtn.inert = locked;
      const viewBtn = document.getElementById("view-toggle");
      if (viewBtn) viewBtn.inert = locked;
      if (locked && viewMode !== "rete") setViewMode("rete");
      if (
        locked &&
        document.activeElement &&
        document.activeElement !== document.body
      ) {
        if (searchBox.node().contains(document.activeElement))
          document.activeElement.blur();
      }
      node.style("cursor", (d) =>
        locked && !tourAllowsNodeClick(d) ? "default" : null
      );
    }

    function renderGuideStep() {
      const step = GUIDE_STEPS[guideStepIndex];
      step.onEnter?.();
      setTourLock(tourLockForStep(step.key));
      const content = d3.select("#guide-step-content");
      content
        .attr(
          "class",
          `guide-step${step.modifier ? ` guide-step--${step.modifier}` : ""}`
        )
        .html(`<h3 class="guide-step-title">${step.title}</h3>${step.body()}`);
      if (guideStepIndex === GUIDE_STEPS.length - 1) {
        content.select("#guide-cta").on("click", closeGuide);
      }

      const dots = d3.select("#guide-dots");
      dots.selectAll("span").remove();
      GUIDE_STEPS.forEach((_, i) => {
        dots
          .append("span")
          .attr(
            "class",
            `guide-dot${i === guideStepIndex ? " guide-dot--active" : ""}`
          )
          .on("click", () => goToGuideStep(i));
      });

      const isLastStep = guideStepIndex === GUIDE_STEPS.length - 1;
      d3.select("#guide-prev").property("disabled", guideStepIndex === 0);
      d3.select("#guide-next")
        .property("disabled", false)
        .text(isLastStep ? "✓" : "");
    }

    function goToGuideStep(i) {
      const next = Math.max(0, Math.min(GUIDE_STEPS.length - 1, i));
      if (next === guideStepIndex) return;
      GUIDE_STEPS[guideStepIndex].onLeave?.();
      guideStepIndex = next;
      renderGuideStep();
    }

    function openGuide() {
      guideIsOpen = true;
      guideStepIndex = 0;
      renderGuideStep();
      guideCard.style("display", "flex");
    }
    function closeGuide() {
      GUIDE_STEPS[guideStepIndex].onLeave?.();
      tourClearSpotlight();
      setTourLock(null);
      guideIsOpen = false;
      guideCard.style("display", "none");
    }

    d3.select("#guide-prev").on("click", () =>
      goToGuideStep(guideStepIndex - 1)
    );
    d3.select("#guide-next").on("click", () => {
      if (guideStepIndex === GUIDE_STEPS.length - 1) closeGuide();
      else goToGuideStep(guideStepIndex + 1);
    });
    d3.select("#guide-close").on("click", closeGuide);

    let guideTouchStartX = null;
    guideCard.node().addEventListener("touchstart", (event) => {
      guideTouchStartX = event.touches[0].clientX;
    });
    guideCard.node().addEventListener("touchend", (event) => {
      if (guideTouchStartX == null) return;
      const dx = event.changedTouches[0].clientX - guideTouchStartX;
      guideTouchStartX = null;
      if (Math.abs(dx) < 40) return;
      if (dx < 0) goToGuideStep(guideStepIndex + 1);
      else goToGuideStep(guideStepIndex - 1);
    });

    document.addEventListener("keydown", (event) => {
      if (!guideIsOpen) return;
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "Escape") closeGuide();
      else if (event.key === "ArrowRight") goToGuideStep(guideStepIndex + 1);
      else if (event.key === "ArrowLeft") goToGuideStep(guideStepIndex - 1);
    });

    let guideToggle = d3.select("body").select("#guide-toggle");
    if (guideToggle.empty()) {
      guideToggle = d3
        .select("body")
        .append("button")
        .attr("id", "guide-toggle")
        .attr("aria-label", "Apri il tour")
        .text("?");
    }
    guideToggle.attr("aria-label", "Come leggere la rete");
    guideToggle.on("click", openGuide);

    node.on("click.tour", (event, d) => {
      if (!guideIsOpen || !tourAllowsNodeClick(d)) return;
      const key = GUIDE_STEPS[guideStepIndex].key;
      if (
        (key === "directional-intro" || key === "directional-switch") &&
        tourPairIds
      ) {
        tourApplyEdgeEmphasis(tourPairIds.edge, d.scientific_name);
        return;
      }
      if (key !== "neutral" || !tourNeutralPair) return;
      tourApplyEdgeEmphasis(tourNeutralPair.edge, d.scientific_name);
      openEdgeInfo(tourNeutralPair.edge);
    });

    let guideShouldOpen = new URLSearchParams(location.search).has("guide");
    try {
      if (!localStorage.getItem("autopoiesi-guide-seen")) {
        guideShouldOpen = true;
        localStorage.setItem("autopoiesi-guide-seen", "1");
      }
    } catch (e) {
      guideShouldOpen = true;
    }
    if (guideShouldOpen) openGuide();
  }
);

function scaleAndCenter(nodes, animate = true) {
  const padding = 40;
  const nodesX = nodes.map((d) => d.x);
  const nodesY = nodes.map((d) => d.y);
  const minX = Math.min(...nodesX);
  const maxX = Math.max(...nodesX);
  const minY = Math.min(...nodesY);
  const maxY = Math.max(...nodesY);

  const graphWidth = maxX - minX;
  const graphHeight = maxY - minY;

  const scale = Math.min(
    (window.innerWidth - 2 * padding) / graphWidth,
    (window.innerHeight - 2 * padding) / graphHeight,
    1
  );

  const translateX = (window.innerWidth - scale * (minX + maxX)) / 2;
  const translateY = (window.innerHeight - scale * (minY + maxY)) / 2;

  const t = d3.zoomIdentity.translate(translateX, translateY).scale(scale);

  if (!animate) {
    svg.call(zoom.transform, t);
    return;
  }
  svg.transition().duration(1000).ease(d3.easeCubicOut).call(zoom.transform, t); // stessa istanza di zoom usata da svg.call(zoom) sopra,
  // così l'evento "zoom" viene ricevuto dall'handler che
  // aggiorna container.attr("transform", ...) ad ogni frame
  // della transizione, invece di scattare di colpo alla fine
}

function drag(simulation) {
  const DRAG_HEAT_THRESHOLD_PX = 4;
  let startX = 0;
  let startY = 0;
  let heated = false;
  let homeX = 0;
  let homeY = 0;
  return (
    d3
      .drag()
      .filter((event) => !tourLockPolicy && !event.ctrlKey && !event.button)
      .on("start", (event, d) => {
        heated = false;
        homeX = d.x;
        homeY = d.y;
        startX = event.sourceEvent.clientX;
        startY = event.sourceEvent.clientY;
      })
      .on("drag", (event, d) => {
        if (
          !heated &&
          Math.hypot(
            event.sourceEvent.clientX - startX,
            event.sourceEvent.clientY - startY
          ) < DRAG_HEAT_THRESHOLD_PX
        ) {
          return;
        }
        if (!heated) {
          heated = true;
          // (nel gesto "drag" event.active vale già 1: si riscalda sempre)
          simulation.alphaTarget(viewMode === "sguardo" ? 0.02 : 0.1).restart();
        }
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (heated) {
          if (!event.active) simulation.alphaTarget(0);
          if (viewMode === "sguardo") {
            // nella vista ad anelli la struttura resta fissa: il nodo
            // torna al suo posto con un movimento morbido
            const fromX = d.fx;
            const fromY = d.fy;
            const ix = d3.interpolate(fromX, homeX);
            const iy = d3.interpolate(fromY, homeY);
            simulation.alphaTarget(0.02).restart();
            d3.transition()
              .duration(450)
              .ease(d3.easeCubicOut)
              .tween("home" + d.index, () => (t) => {
                d.fx = ix(t);
                d.fy = iy(t);
              })
              .on("end", () => {
                d.fx = null;
                d.fy = null;
                simulation.alphaTarget(0);
              });
          } else {
            d.fx = null;
            d.fy = null;
          }
        }
        heated = false;
      })
  );
}
