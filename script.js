// Impedisce lo zoom nativo del browser (pagina intera) durante il pinch
// sul trackpad, indipendentemente da dove si trova il cursore — es. sopra
// l'info-box che appare quando un nodo è aperto. Senza questo, il pinch
// sopra elementi HTML esterni all'<svg> viene gestito dal browser invece
// che da D3, creando il "salto" percepito nello zoom.
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
// 1) Alone sfocato "progressivo" lungo i bordi dello schermo (più sfocato
//    verso il bordo, nitido verso il centro): un overlay fisso, non
//    cliccabile, fatto di 2 strati con backdrop-filter e maschera a
//    gradiente (vedi #edge-blur in style.css). Mettere false per toglierlo.
const EDGE_BLUR_ENABLED = true;
// Durante zoom, pan e spostamenti automatici (guida, "top specie", ricerca)
// l'alone viene spento e poi rimesso a riposo: è l'elemento più pesante da
// ridisegnare in movimento. Mettere false per tenerlo sempre acceso.
const EDGE_BLUR_PAUSE_WHILE_MOVING = true;
// 2) Quando si apre un nodo, le specie non collegate perdono opacità E
//    vengono sfocate di questi pixel. 0 = solo opacità, come prima.
const FOCUS_BLUR_PX = 2;
// 3) Opacità a cui scendono nodi, collegamenti e cerchi di sfondo NON
//    collegati al nodo aperto (0 = spariscono, 1 = nessun calo). Era 0.1.
// Aspetto dei nodi non osservati (bianco e nero): CONTRAST 1 = contrasto
// originale, più basso = più sbiadito; LIFT schiarisce (0 = nessuna
// variazione, 0.3 = molto più chiari).
const NOT_OBSERVED_CONTRAST = 0.55;
const NOT_OBSERVED_LIFT = 0.25;

// Colore dei collegamenti (edge): EDGE_COLOR a riposo, EDGE_COLOR_ACTIVE
// quando l'edge è in hover / selezionato. Accetta qualsiasi colore CSS
// ("#646466", "rgb(...)", "orange"...). Gli edge sono sottili (0.4px) e
// semitrasparenti nel CSS di base: se il nuovo colore ti sembra troppo
// tenue, schiariscilo o aumenta lo spessore (stroke-width, cerca "link-path").
const EDGE_COLOR = "#646466";
const EDGE_COLOR_ACTIVE = "#F4F4F4";

const FOCUS_DIM_OPACITY = 0.15;
// 4) Hover su un numero di interazioni nel pannello del nodo (es. il "33"
//    di "mangia"): le specie di quel tipo restano accese, le altre specie
//    COLLEGATE al nodo scendono a questa opacità (0 = spariscono, 1 =
//    nessun calo). Le non collegate restano a FOCUS_DIM_OPACITY.
const INTERACTION_HOVER_DIM = 0.25;

if (EDGE_BLUR_ENABLED && d3.select("body").select("#edge-blur").empty()) {
  const edgeBlur = d3.select("body").append("div").attr("id", "edge-blur");
  [1, 2].forEach((i) =>
    edgeBlur
      .append("div")
      .attr("class", `edge-blur-layer edge-blur-layer--${i}`)
  );
}

// Anteprima al volo del tipo di interazione, mostrata solo sugli edge
// "attivi" (collegati al nodo attualmente selezionato) — sugli altri il
// hover resta muto, per non distrarre da ciò che l'utente ha scelto di
// esplorare.
let edgeTooltip = d3.select("body").select("#edge-tooltip");
if (edgeTooltip.empty()) {
  edgeTooltip = d3.select("body").append("div").attr("id", "edge-tooltip");
}

// Lightbox per ingrandire le immagini dentro l'inspector (sia quello dei
// nodi sia quello degli edge, che condividono lo stesso #info-box). Il
// pannello viene riscritto con .html() ogni volta che si apre qualcosa,
// quindi un listener su ogni singola <img> andrebbe perso a ogni apertura:
// il listener va invece su #info-box stesso, che esiste sempre, e usa
// event delegation per intercettare il click qualunque immagine ci sia
// dentro in quel momento.
let lightbox = d3.select("body").select("#lightbox-overlay");
if (lightbox.empty()) {
  lightbox = d3
    .select("body")
    .append("div")
    .attr("id", "lightbox-overlay")
    .style("display", "none");
  lightbox.append("img");
}
const lightboxImg = lightbox.select("img");

function openLightbox(src, alt) {
  lightboxImg.attr("src", src).attr("alt", alt || "");
  lightbox.style("display", "flex");
}

function closeLightbox() {
  lightbox.style("display", "none");
  lightboxImg.attr("src", null);
}

// Inspector chiuso = non cliccabile. Il pannello sparisce solo con
// opacity:0 (resta nel DOM con il suo contenuto) e le immagini hanno
// pointer-events:auto, che vince su quello "none" del contenitore: senza
// questo, una foto "fantasma" intercettava click e drag sul grafo dopo
// la chiusura. Si osserva lo style inline (dove d3 scrive l'opacità
// di destinazione) e si tiene la classe .is-closed allineata.
function syncInfoBoxClosed() {
  const el = infoBox.node();
  const o = el.style.opacity;
  const closed = o === "" || Number(o) === 0;
  el.classList.toggle("is-closed", closed);
  // Se il pannello aperto è così alto da arrivare sotto il contatore in
  // alto a destra (schermi bassi), il contatore si fa da parte invece di
  // restare sovrapposto.
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
  if (!img) return;
  if (infoBox.node().classList.contains("is-closed")) return;
  // Ferma la propagazione QUI, non su document: altrimenti lo stesso click
  // arriverebbe anche al listener "click fuori dalla ricerca" (che
  // svuoterebbe la barra di ricerca) e a quello sull'svg (che chiuderebbe
  // l'inspector) — nessuno dei due deve scattare per un click su
  // un'immagine dentro il pannello.
  event.stopPropagation();
  openLightbox(img.getAttribute("src"), img.getAttribute("alt"));
});

// Click ovunque sull'overlay (immagine inclusa) per chiudere: pattern
// standard di una lightbox minimale.
lightbox.on("click", closeLightbox);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLightbox();
});

// Segna sul body "sto muovendo la vista" (classe .is-moving) mentre dura
// uno zoom/pan; la classe si toglie un attimo dopo la fine, così l'alone
// non lampeggia fra due movimenti ravvicinati.
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
let hasAutoFitted = false; // evita che la vista si "resetti" ogni volta che la simulazione si stabilizza
let selectedNodeId = null; // id del nodo attualmente aperto, per tenere il bordo/i chevron agganciati
let selectedEdgeDatum = null; // edge il cui inspector è aperto in questo momento: resta bianco anche fuori hover

// Blocco delle interazioni mentre la guida è aperta: ogni step mostra
// uno stato preciso (nodo aperto, collegamento evidenziato, zoom) che non
// deve essere alterato da hover, click sullo sfondo, ricerca o trascinamenti.
// Resta libero solo muoversi nello spazio (pan/zoom) e, dove lo step lo
// prevede, cliccare i nodi indicati.
//   null                       -> nessun blocco (guida chiusa)
//   { nodes: "none" }          -> nessun nodo cliccabile
//   { nodes: "all" }           -> tutti i nodi cliccabili
//   { nodes: "pair", ids: [] } -> solo i nodi con questi scientific_name
let tourLockPolicy = null;
function tourAllowsNodeClick(d) {
  const p = tourLockPolicy;
  if (!p) return true;
  if (p.nodes === "all") return true;
  if (p.nodes === "pair") return p.ids.includes(d.scientific_name);
  return false;
}

// Distanza dei chevron dal bordo del nodo selezionato: sensazione di un
// "anello" separato invece che chevron attaccati al cerchio. Un solo
// numero da cambiare se in futuro si preferisce un'altra distanza (0 =
// attaccati al bordo).
const NODE_CHEVRON_GAP = 5;

// Coppie di tipi che raccontano lo STESSO fatto da due punti di vista
// opposti (es. "mangia" / "mangiato da"): edges.csv contiene solo UNA
// riga per fatto — quale delle due forme sia salvata dipende da quale
// era più frequente in fase di pulizia del dataset — ma nella
// visualizzazione vogliamo sempre il verbo corretto rispetto al nodo
// che si ha aperto: aprendo il predatore si legge "mangia", aprendo la
// preda si legge "mangiato da", stesso identico edge.
const INVERSE_TYPE = {
  mangia: "mangiato da",
  "mangiato da": "mangia",
  preda: "predato da",
  "predato da": "preda",
  impollina: "impollinato da",
  impollinato: "impollina",
  "impollinato da": "impollina",
  "fiore visitato da": "visita il fiore di",
  "visita il fiore di": "fiore visitato da",
  // forme plurali, quelle realmente presenti in edges.csv (le singolari
  // sopra restano come alias): senza queste l'ape, aprendo "fiori
  // visitati da", si leggeva "fiori visitati da" invece di "visita i fiori di"
  "fiori visitati da": "visita i fiori di",
  "visita i fiori di": "fiori visitati da",
  "ha come ospite": "ospite di",
  "parassita di": "ha come parassita",
  "ha come parassita": "parassita di",
  "ectoparassita di": "ha come ectoparassita",
  "ha come ectoparassita": "ectoparassita di",
  "endoparassita di": "ha come endoparassita",
  "ha come endoparassita": "endoparassita di",
  "parassitoide di": "ha come parassitoide",
  "ha come parassitoide": "parassitoide di",
  "patogeno di": "ha come patogeno",
  "ha come patogeno": "patogeno di",
  "epifita di": "ha come epifita",
  "ha come epifita": "epifita di",
  "visitato da": "visita",
  visita: "visitato da",
  "ospite di": "ha come ospite",
  "ha ospite": "ospite di",
  "ha come vettore di dispersione": "vettore di dispersione di",
  "vettore di dispersione di": "ha come vettore di dispersione",
  uccide: "ucciso da",
  "ucciso da": "uccide",
  "crea habitat per": "ha come habitat",
  "ha come habitat": "crea habitat per",
  "ha vettore": "è vettore di",
  "è vettore di": "ha vettore",
};

// Tassonomia completa delle interazioni (dataset fornito): per ciascun
// tipo, il verso ("A" = attivo/A→B, "B" = passivo/B→A, "N" = nessun
// verso) e la didascalia estesa mostrata nell'Edge-Inspector. Alcuni
// tipi hanno più nomi equivalenti nel dataset (separati da "/" nella
// colonna originale): li registriamo come alias, sotto ciascuno dei
// quali compare la STESSA voce, così qualunque stringa compaia nel csv
// viene riconosciuta allo stesso modo.
const INTERACTION_TAXONOMY = [
  {
    names: ["acquisisce nutrienti da"],
    dir: "A",
    desc: "Un'interazione biotica in cui un'entità materiale fornisce nutrimento a un organismo.",
  },
  {
    names: ["adiacente a"],
    dir: "A",
    desc: "A è adiacente a B se e solo se esiste una distanza piccola, ma diversa da zero, tra A e B.",
  },
  {
    names: ["specie allelopatica nei confronti di"],
    dir: "A",
    desc: "Una relazione tra organismi in cui un organismo è influenzato dalle sostanze biochimiche prodotte da un altro. L'allelopatia è un fenomeno in cui un organismo rilascia sostanze chimiche per influenzare positivamente o negativamente la crescita, la sopravvivenza o la riproduzione di altri organismi nelle sue vicinanze.",
  },
  {
    names: ["ospite di micorrize arbuscolari per"],
    dir: "B",
    desc: "La micorriza arbuscolare (AM) (plurale micorrize) è un tipo di micorriza in cui il fungo simbionte (funghi micorrizici arbuscolari, o AMF) penetra nelle cellule corticali delle radici di una pianta vascolare formando degli arbuscoli. La micorriza arbuscolare è un tipo di endomicorriza, insieme alla micorriza ericoide e alla micorriza delle orchidee (da non confondere con l'ectomicorriza).",
  },
  {
    names: ["si trova in associazione con", "coesiste con"],
    dir: "N",
    desc: "Una relazione di interazione che descrive organismi che spesso coesistono nello stesso tempo e nello stesso spazio o nello stesso ambiente.",
  },
  {
    names: ["condivide il sito di rifugio con"],
    dir: "N",
    desc: "Si riferisce a organismi di specie diverse che condividono lo stesso rifugio o riparo.",
  },
  {
    names: ["commensale di"],
    dir: "N",
    desc: "Relazione ecologica in cui un organismo trae beneficio da un altro (l'ospite) senza causargli alcun danno o beneficio significativo.",
  },
  {
    names: ["crea habitat per", "fornisce habitat a"],
    dir: "A",
    desc: "Una relazione di interazione in cui un organismo crea una struttura o un ambiente in cui vive un altro organismo.",
  },
  {
    names: ["vettore di dispersione di"],
    dir: "A",
    desc: "Un processo ecologico durante il quale semi o altri propaguli vegetali vengono trasportati lontano dalla pianta madre da vettori biotici o abiotici, riducendo la competizione tra piante sorelle e consentendo la colonizzazione di nuovi siti.",
  },
  {
    names: ["predato da", "consumato da"],
    dir: "B",
    desc: "Il soggetto viene consumato da un altro organismo attraverso la bocca o un'altra apertura orale di quest'ultimo.",
  },
  {
    names: ["si nutre di", "preda"],
    dir: "A",
    desc: "Un'interazione biotica in cui un organismo consuma un'entità materiale attraverso una sorta di bocca o altra apertura orale.",
  },
  {
    names: ["ecologicamente correlato a"],
    dir: "N",
    desc: "Una relazione che è in qualche modo mediata dall'ambiente o da una caratteristica ambientale.",
  },
  {
    names: ["ospite di ectomicorrize di"],
    dir: "A",
    desc: "Le ectomicorrize si formano sulle radici di circa il 2% delle specie vegetali, solitamente piante legnose. A differenza di altre relazioni micorriziche, i funghi ectomicorrizici non penetrano la parete cellulare dell'ospite. Formano invece un'interfaccia interamente intercellulare nota come rete di Hartig, costituita da ife altamente ramificate che formano un reticolo tra le cellule epidermiche e corticali della radice.",
  },
  {
    names: ["ectoparassita di"],
    dir: "A",
    desc: "Una sottorelazione di parassita in cui il parassita vive sul o all'interno del sistema tegumentario dell'ospite.",
  },
  {
    names: ["endoparassita di"],
    dir: "A",
    desc: "Una sottorelazione di endoparassiti in cui il parassita abita gli spazi tra le cellule dell'ospite.",
  },
  {
    names: ["epifita di"],
    dir: "A",
    desc: "Un rapporto di interazione in cui una pianta o un'alga vive sulla superficie esterna di un'altra pianta.",
  },
  {
    names: ["fiori visitati da"],
    dir: "B",
    desc: "Un'interazione in cui un organismo visita i fiori di una pianta.",
  },
  {
    names: ["ha come ospite una specie micorrizata arbuscolarmente"],
    dir: "B",
    desc: "Il soggetto, un fungo micorrizico arbuscolare (AMF), penetra le cellule corticali delle radici di questa pianta ospite formando degli arbuscoli: una forma di endomicorriza, distinta dalla micorriza ericoide e da quella delle orchidee (da non confondere con l'ectomicorriza).",
  },
  {
    names: ["ha come vettore di dispersione"],
    dir: "B",
    desc: "Il soggetto (una pianta, o i suoi semi e propaguli) viene trasportato lontano dalla pianta madre da questo vettore di dispersione, biotico o abiotico, riducendo la competizione tra piante sorelle e favorendo la colonizzazione di nuovi siti.",
  },
  {
    names: ["ha come ospite ectomicorrizico"],
    dir: "B",
    desc: "Il fungo ectomicorrizico forma con le radici di questa pianta ospite un'interfaccia intercellulare nota come rete di Hartig: a differenza di altre relazioni micorriziche, non ne penetra le cellule, ma si dispone a reticolo tra quelle epidermiche e corticali della radice. Le ectomicorrize coinvolgono circa il 2% delle specie vegetali, perlopiù legnose.",
  },
  {
    names: ["ha come ectoparassita"],
    dir: "B",
    desc: "Il soggetto ospita un ectoparassita, che vive sul suo sistema tegumentario o al suo interno.",
  },
  {
    names: ["ha come endoparassita"],
    dir: "B",
    desc: "Il soggetto ospita un endoparassita, che abita gli spazi tra le sue cellule.",
  },
  {
    names: ["ha come epifita"],
    dir: "B",
    desc: "Il soggetto ospita sulla propria superficie esterna un'epifita: una pianta o un'alga che vive appoggiata su di esso, senza radicarsi nel suolo.",
  },
  {
    names: ["ha come habitat", "occupa l'habitat di"],
    dir: "B",
    desc: 'x "ha un habitat" y se e solo se: x è un organismo, y è un habitat e y può sostenere e consentire la crescita di una popolazione di x.',
  },
  {
    names: ["ha come parassita"],
    dir: "B",
    desc: "Il soggetto ospita un parassita, che trae beneficio a sue spese.",
  },
  {
    names: ["ha come parassitoide"],
    dir: "B",
    desc: "Il soggetto è ospite di un parassitoide, che lo ucciderà o lo sterilizzerà.",
  },
  {
    names: ["ha come patogeno"],
    dir: "B",
    desc: "Un'interazione tra ospiti in cui il membro più piccolo di una simbiosi causa una malattia nel membro più grande.",
  },
  {
    names: ["ha come vettore"],
    dir: "B",
    desc: "Il soggetto viene infettato tramite un vettore: un organismo che trasmette agenti infettivi da un ospite all'altro.",
  },
  {
    names: ["emiparassita di"],
    dir: "A",
    desc: "Una sottorelazione di parassita-di in cui il parassita è una pianta, ed è parassitario in condizioni naturali ed è anche fotosintetico in una certa misura.",
  },
  {
    names: ["ospite di"],
    dir: "A",
    desc: "L'organismo più grande o di supporto che ospita, nutre o fornisce un habitat a un altro organismo più piccolo o dipendente.",
  },
  {
    names: ["interagisce con"],
    dir: "A",
    desc: "Una relazione che intercorre tra due entità in cui i processi eseguiti dalle due entità sono causalmente connessi.",
  },
  {
    names: ["ucciso da", "causa di mortalità per"],
    dir: "B",
    desc: "Il soggetto viene ucciso da un altro organismo, senza che vi sia un trasferimento di energia trofica (alimentazione) come nella predazione.",
  },
  {
    names: ["uccide", "causa la morte di"],
    dir: "A",
    desc: "Una specifica relazione ecologica in cui un organismo causa la morte di un altro senza trasferimento di energia trofica (alimentazione).",
  },
  {
    names: ["mutualista di"],
    dir: "N",
    desc: "Una specie che partecipa a una relazione mutualistica, un tipo di interazione biotica in cui entrambi gli organismi coinvolti traggono beneficio l'uno dall'altro.",
  },
  {
    names: ["parassita di"],
    dir: "A",
    desc: "Un'interazione in cui un organismo trae beneficio a spese di un altro.",
  },
  {
    names: ["parassitoide di"],
    dir: "A",
    desc: "Un parassita che uccide o sterilizza il suo ospite.",
  },
  {
    names: ["patogeno di"],
    dir: "A",
    desc: "Il soggetto è un patogeno: un organismo di dimensioni minori che, in una relazione simbiotica, causa una malattia nell'organismo di dimensioni maggiori che lo ospita.",
  },
  {
    names: ["impollinato da"],
    dir: "B",
    desc: "Il soggetto, una pianta, viene impollinato da un organismo che ne trasporta il polline dalle strutture riproduttive maschili a quelle femminili, facilitandone la riproduzione.",
  },
  {
    names: ["impollina"],
    dir: "A",
    desc: "Un'interazione in cui l'organismo trasporta il polline dalle strutture riproduttive maschili a quelle femminili di una pianta, facilitando la riproduzione.",
  },
  {
    names: ["predato da"],
    dir: "B",
    desc: "Il soggetto viene ucciso da un predatore per esserne cibo, anche a beneficio dei fratelli, della prole o di altri membri del gruppo del predatore.",
  },
  {
    names: ["preda"],
    dir: "A",
    desc: "Una relazione di interazione che implica un processo di predazione, in cui il soggetto uccide la preda per cibarsene o per nutrire fratelli, prole o membri del gruppo.",
  },
  {
    names: ["fornisce nutrienti a"],
    dir: "A",
    desc: "Un'interazione biotica in cui un'entità materiale fornisce nutrimento a un organismo.",
  },
  {
    names: ["parassita radicale di"],
    dir: "A",
    desc: "Una forma specializzata di parassitismo in cui un organismo parassita si attacca direttamente alla radice di una pianta ospite per rubare acqua, minerali o sostanze nutritive.",
  },
  {
    names: ["simbionte di"],
    dir: "A",
    desc: "Un tipo di interazione biotica che descrive un'associazione stretta e a lungo termine in cui un organismo agisce come simbionte (il partner più piccolo o dipendente) vivendo all'interno o con un organismo ospite.",
  },
  {
    names: ["vettore di"],
    dir: "A",
    desc: "Interazione in cui un organismo trasmette agenti infettivi da un ospite all'altro.",
  },
  {
    names: ["visitato da"],
    dir: "B",
    desc: "Il soggetto viene visitato da un altro organismo, senza che questo implichi necessariamente un danno immediato o il consumo totale della risorsa.",
  },
  {
    names: ["visita"],
    dir: "A",
    desc: "Relazione in cui un organismo visita un altro organismo o una specifica posizione geografica/struttura biologica, senza necessariamente implicare danni immediati o il consumo totale della risorsa.",
  },
  {
    names: ["visita i fiori di"],
    dir: "A",
    desc: "Il soggetto visita i fiori di una pianta, ad esempio per nutrirsi di nettare o polline.",
  },
];

// Tipi SIMMETRICI: stesso significato indipendentemente da chi è source
// o target nel csv, nessuna rietichettatura necessaria.
const SYMMETRIC_TYPES = new Set();

// Tipi per cui, dopo la pulizia di edges.csv, la forma "vincente" è
// quella PASSIVA (source = chi subisce, target = chi agisce): senza
// questo elenco la freccia (che SVG piazza sempre sull'ultimo punto del
// path, cioè sul target salvato) finirebbe per puntare verso chi COMPIE
// l'azione invece che verso chi la subisce — il contrario di quanto ci
// si aspetta leggendo "il predatore mangia la preda". Qui dentro solo i
// tipi per cui la direzione azione→ricevente è inequivocabile.
const ARROW_REVERSED_TYPES = new Set();

const interactionDescriptions = {};

INTERACTION_TAXONOMY.forEach(({ names, dir, desc }) => {
  names.forEach((name) => {
    interactionDescriptions[name] = desc;
    if (dir === "N") SYMMETRIC_TYPES.add(name);
    else if (dir === "B") ARROW_REVERSED_TYPES.add(name);
    // dir === "A": resta "attivo" di default, non va in nessun Set.
  });
});

// Aggiunte manuali: terminologia già in uso in edges.csv ma non presente
// nel dataset fornito (il csv usa "mangia"/"mangiato da", il dataset usa
// "preda"/"predato da" come forma canonica dello stesso fatto).
SYMMETRIC_TYPES.add("si verifica con");
ARROW_REVERSED_TYPES.add("mangiato da");
// "mangia" resta implicitamente attivo: non va aggiunto a nessun Set.
interactionDescriptions["mangia"] =
  "Notare che questa interazione può riferirsi anche a individui cuccioli della specie, o a individui che devono ancora nascere, come ad esempio nel caso delle uova.";
interactionDescriptions["mangiato da"] =
  "Il soggetto viene mangiato dall'altro organismo, eventualmente anche allo stadio di cucciolo o di uovo.";
interactionDescriptions["si verifica con"] =
  "Una relazione neutra che indica che le due specie sono state osservate verificarsi insieme, senza un verso definito tra le due.";

// Altre forme "corte" già in uso nel csv ma assenti dal dataset (che usa
// la forma estesa): senza questi alias restavano fuori da ARROW_REVERSED_
// TYPES e finivano classificate come attive per difetto — il bug
// segnalato ("ha vettore" verde invece che arancio) più altri casi dello
// stesso tipo, trovati controllando ogni coppia attivo/passivo del
// vecchio INVERSE_TYPE una per una.
ARROW_REVERSED_TYPES.add("ha vettore"); // alias di "ha come vettore"
interactionDescriptions["ha vettore"] =
  interactionDescriptions["ha come vettore"];

ARROW_REVERSED_TYPES.add("fiore visitato da"); // forma singolare, il dataset ha solo "fiori visitati da" (plurale)
interactionDescriptions["fiore visitato da"] =
  interactionDescriptions["fiori visitati da"];

ARROW_REVERSED_TYPES.add("impollinato"); // forma breve, oltre a "impollinato da"
interactionDescriptions["impollinato"] =
  interactionDescriptions["impollinato da"];

ARROW_REVERSED_TYPES.add("ha come ospite"); // forma usata in edges.csv (inverso di "ospite di")
interactionDescriptions["ha come ospite"] =
  interactionDescriptions["ospite di"];
ARROW_REVERSED_TYPES.add("ha ospite"); // inverso di "ospite di" (attivo): manca dal dataset, ma per coerenza va passivo
interactionDescriptions["ha ospite"] = interactionDescriptions["ospite di"];

// Descrizioni per le forme attive gemelle di quelle sopra: già corrette
// come verso (attivo è il default), mancava solo la didascalia.
interactionDescriptions["visita il fiore di"] =
  interactionDescriptions["visita i fiori di"];
interactionDescriptions["è vettore di"] = interactionDescriptions["vettore di"];

// ATTENZIONE — scelta in sospeso: il dataset classifica "interagisce
// con" e "adiacente a" come "A → B" (quindi direzionali), ma qui erano
// stati scelti di proposito come NEUTRI (pallino anziché chevron),
// decisione presa a inizio sessione. Finché non mi confermi come
// procedere, mantengo il trattamento neutro già in uso.
SYMMETRIC_TYPES.add("interagisce con");
SYMMETRIC_TYPES.add("adiacente a");

// INTERRUTTORE RAPIDO: a false, tutto quello che oggi è colorato
// (marker, label curve, righe degli inspector) torna bianco come prima
// — un solo valore da cambiare per confrontare le due versioni.
const USE_ROLE_COLORS = false;

// Colori semantici per leggere a colpo d'occhio chi agisce e chi subisce
// in un'interazione, senza dover interpretare l'angolo di un chevron in
// mezzo a decine di edge che si incrociano: il verde è sempre "questo
// nodo/questa label sta agendo", l'arancio "lo sta subendo". I tipi
// SIMMETRICI restano neutri (bianco), non hanno un verso da segnalare.
// Usati sia per i marker sul grafo (vedi <defs> più sotto) sia per le
// label curve e per le righe degli inspector.
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

// INTERRUTTORE TEMPORANEO (test "solo colore"): a false, nessun
// chevron/pallino viene disegnato — né sul grafo né negli inspector —
// resta solo il colore su label ed etichette di tipo. Rimettere a true
// per tornare ad avere anche i simboli direzionali.
const SHOW_INTERACTION_SYMBOLS = true;

// Dato un edge e l'id del nodo attualmente aperto (`viewpointId`),
// restituisce la label corretta DAL SUO PUNTO DI VISTA: se il nodo è il
// source salvato nel csv, il tipo resta quello originale (il nodo
// compie l'azione); se è il target, viene sostituito con la forma
// inversa quando ne esiste una nota — altrimenti resta quella
// originale come fallback sicuro (mai un crash, solo eventualmente una
// label non riformulata per un tipo non ancora mappato qui sopra).
function labelForViewpoint(edge, viewpointId) {
  const srcId =
    typeof edge.source === "object" ? edge.source.scientific_name : edge.source;
  if (SYMMETRIC_TYPES.has(edge.type) || srcId === viewpointId) {
    return edge.type;
  }
  return INVERSE_TYPE[edge.type] || edge.type;
}

// Legge un CSV in modo tollerante: toglie il BOM (Excel/Numbers/Sheets lo aggiungono
// e rovinano il nome della prima colonna), riconosce il separatore (virgola,
// punto e virgola, tab) e ripulisce gli spazi nei nomi delle colonne.
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

Promise.all([loadCsv("nodes.csv"), loadCsv("edges.csv")]).then(
  ([nodes, allLinks]) => {
    if (!nodes.length || nodes[0].scientific_name === undefined) {
      console.error(
        "nodes.csv: colonna 'scientific_name' non trovata. Colonne lette:",
        nodes[0] ? Object.keys(nodes[0]) : "(file vuoto)"
      );
    }
    nodes = nodes.filter((n) => n.scientific_name);
    // Una sola riga per nome scientifico: se ci sono doppioni resta la prima
    // (le altre sarebbero nodi "fantasma" senza collegamenti).
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
    // Scarta i collegamenti che citano una specie assente da nodes.csv
    // (altrimenti d3.forceLink si blocca con "node not found" e la pagina resta nera).
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

    // Individua le componenti connesse: gruppi di nodi collegati tra loro
    // ma isolati dal resto della rete (es. 3 specie che interagiscono solo
    // fra loro e con nessun'altra). Un nodo del genere può avere grado 2 o
    // 3 "al suo interno", quindi un controllo basato solo sul grado non lo
    // intercetta: qui invece marchiamo ogni nodo con l'id della sua
    // componente, per poter trattare diversamente chi sta nella rete
    // principale da chi sta in un gruppetto satellite.
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

    // La componente più grande è la "rete principale"; tutte le altre sono
    // cluster satellite da tenere vicini, indipendentemente dal grado
    // interno dei loro nodi.
    const mainComponentId = componentSizes.indexOf(Math.max(...componentSizes));
    nodes.forEach((d) => {
      d.isMainComponent = d.componentId === mainComponentId;
    });

    // Trova la specie con il maggior numero di connessioni
    const maxDegreeNode = nodes.reduce(
      (max, node) => (node.degree > max.degree ? node : max),
      nodes[0]
    );

    // Contatore in alto a destra: stessa struttura della scheda del nodo
    // (etichetta, nome, separatore, riga con il numero) e cliccabile, come
    // un risultato di ricerca: porta alla specie e la apre. Lo stile sta
    // in style.css (#top-species-counter).
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

    // A questo punto i link hanno ancora source/target come STRINGHE
    // (sarà d3.forceLink, fra un attimo, a sostituirle con gli oggetti
    // nodo veri): per risalire al raggio di un nodo dato il suo id serve
    // quindi una mappa esplicita.
    const nodeByName = new Map(nodes.map((n) => [n.scientific_name, n]));

    // Distanza minima "di respiro" fra due nodi, SOLO dove serve a non
    // far diventare illeggibile la label del loro edge. L'idea: la
    // distanza fra nodi resta governata come sempre da forceLink/charge/
    // collide, MA se in un caso estremo il layout li vorrebbe più vicini
    // di quanto la label richieda per stare leggibile lungo la curva,
    // qui sotto interviene una regola con priorità più alta che li
    // separa quel tanto che basta — mai il contrario (non avvicina mai
    // nodi che il layout normale terrebbe più lontani).
    //
    // La larghezza del testo è misurata con un vero elemento <text>
    // (stesso font-size delle label reali, e appeso dentro l'SVG vero
    // così eredita lo stesso font della pagina) invece di stimarla a
    // occhio: numero di caratteri e larghezze non sono uniformi, e così
    // la misura è esatta indipendentemente dal font usato. Un edge può
    // leggersi in due modi diversi a seconda di quale nodo è selezionato
    // (es. "mangia" / "mangiato da"): si misurano entrambe le forme e si
    // tiene la più lunga, così il vincolo vale a prescindere da quale
    // nodo verrà aperto in seguito.
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

    // Forza "custom" nello stile di forceCollide: ad ogni tick controlla
    // solo le coppie il cui edge è più corto del minimo richiesto dalla
    // sua label, e le allontana quel poco che serve. Le coppie già più
    // larghe del necessario non vengono toccate: strength()/distance()
    // di forceLink restano l'unico regolatore in tutti i casi normali.
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
      // Coesione leggera e uniforme per tutti i nodi (aiuta il layout
      // generale, non basta da sola a "salvare" i nodi isolati)
      .force("x", d3.forceX(width / 2).strength(0.02))
      .force("y", d3.forceY(height / 2).strength(0.02))
      .force("labelGap", forceLabelGap());

    // d3.forceLink ha già sostituito le stringhe con i veri oggetti-nodo,
    // ma in alcuni punti del codice gli edge vengono letti prima: questo
    // helper normalizza i due casi.
    function nodeIdOf(v) {
      return typeof v === "object" && v !== null ? v.scientific_name : v;
    }

    // Dato un edge e uno dei suoi due nodi, restituisce l'ALTRO. Serve
    // per il chevron/pallino "lontano": lo stesso calcolo del chevron
    // vicino, applicato all'estremo opposto del nodo selezionato.
    function otherNodeIdOf(d, nodeId) {
      return nodeIdOf(d.source) === nodeId
        ? nodeIdOf(d.target)
        : nodeIdOf(d.source);
    }

    // Precalcolo, UNA VOLTA SOLA, quanti edge paralleli collegano la stessa
    // coppia (sorgente → target) e che posizione occupa ciascuno nel gruppo.
    // Prima veniva ricalcolato con un filter() su tutti i link, per ogni
    // link e ad ogni fotogramma del tick: costoso e fragile.
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

    // Un path di 0.4px è scomodissimo da colpire col mouse (impossibile col
    // dito). Sovrapponiamo a ogni edge un path invisibile ma spesso ~16px:
    // stessa forma, hitbox molto più larga, aspetto visivo invariato.
    // Di default nessun edge è interattivo: lo stroke largo esiste già nel
    // DOM (serve per il calcolo del path), ma non intercetta il mouse finché
    // non viene "attivato" dal click su uno dei suoi due nodi.
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

    // Rende cliccabili gli edge passati (quelli del nodo selezionato); con
    // un array vuoto disattiva tutto, com'è allo stato iniziale. La
    // direzione non si legge più da un marker sul path visibile: è tutta
    // affidata ai due chevron ad anello (vicino al nodo aperto e vicino
    // al vicino), vedi updateNodeChevrons.
    function setActiveEdges(activeLinks) {
      const activeSet = new Set(activeLinks);
      linkHitAreas.style("pointer-events", (d) =>
        activeSet.has(d) ? "stroke" : "none"
      );
    }

    // Path "gemelli" invisibili, uno per ogni edge: hanno la stessa forma
    // dell'arco visibile ma vengono ridisegnati (vedi tick) in modo da
    // andare sempre da sinistra verso destra. Il testo si aggancia a
    // questi invece che al path visibile, così non appare mai capovolto,
    // indipendentemente da come sono orientati nodo sorgente e nodo target.
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

    // Colore/spessore di base (fuori hover) di un edge: bianco e spesso
    // come l'hover se è quello il cui inspector è aperto in questo
    // momento, grigio e sottile altrimenti. Per l'edge selezionato lo
    // spessore resta quello "acceso" anche fuori hover — è proprio
    // quello il segnale — mentre per tutti gli altri l'ispessimento
    // resta un segnale esclusivo dell'hover.
    function edgeRestStroke(d) {
      return d === selectedEdgeDatum ? EDGE_COLOR_ACTIVE : EDGE_COLOR;
    }
    function edgeRestWidth(d) {
      return d === selectedEdgeDatum ? 1.4 : 0.4;
    }

    // Marker (chevron) vicino al nodo aperto O al suo vicino: sceglie fra
    // i 4 marker attivo/passivo × vicino/lontano in base al ruolo
    // dell'interazione vista dal nodo aperto (chi agisce/chi subisce) e a
    // se quell'edge è quello "acceso" (selezionato o in hover) — in quel
    // caso usa la variante vicino (piena opacità) anche per il capo
    // lontano, esattamente come prima faceva passando dal grigio al
    // bianco.
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
    // Va richiamata ogni volta che selectedEdgeDatum cambia: i marker
    // lontani sono elementi già presenti nel DOM (creati una volta da
    // selectNode), quindi il loro colore va ri-applicato esplicitamente,
    // non si aggiorna da solo.
    function updateFarMarkerHighlight() {
      nodeFarChevrons.selectAll("path").attr("marker-end", farChevronMarker);
      nodeFarNeutralDots.selectAll("circle").attr("fill", farDotFill);
    }

    // Apre il pannello informativo dedicato a un singolo edge (l'interazione
    // fra le due specie), nello stesso "inspector" in basso a destra usato
    // per i nodi. Non tocca la selezione del nodo: rimani nella vista
    // filtrata su di esso, cambia solo il contenuto del pannello. Marca
    // anche l'edge come "quello aperto": resta bianco e spesso finché
    // non se ne apre un altro o non si cambia/deseleziona il nodo, e
    // accende in bianco anche il marker vicino al vicino.
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

      // Il pannello dell'edge non mostra più il tipo "grezzo" del csv, ma
      // quello visto dal nodo attualmente selezionato (stessa logica usata
      // per le label e i marker): se il nodo aperto è il "soggetto"
      // dell'interazione resta com'è, altrimenti viene invertito. Di
      // conseguenza anche l'ordine soggetto/oggetto nell'header e nelle
      // foto segue il punto di vista corrente, non l'ordine del csv.
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
          <img class="ei-photo" src="${viewpointNode.image}" alt="${
            viewpointNode.name
          }" />
          <span class="ei-icon-slot">${interactionIconHTML(interaction)}</span>
          <img class="ei-photo" src="${otherNode.image}" alt="${
            otherNode.name
          }" />
        </div>
        ${description ? `<div class="ei-description">${description}</div>` : ""}
      </div>
    `
        )
        .style("opacity", 1);
    }

    linkHitAreas
      .on("mouseenter", (event, d) => {
        if (tourLockPolicy) return; // guida aperta: l'evidenziazione dello step non si tocca
        d3.select(`#link-path-${links.indexOf(d)}`)
          .attr("stroke", EDGE_COLOR_ACTIVE)
          .attr("stroke-width", 1.4);
        // Anche il marker lontano di QUESTO edge (non tutti) passa a piena
        // opacità durante l'hover, stesso trattamento della selezione.
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
        // Torna al colore di riposo — bianco se questo edge è comunque
        // quello selezionato, altrimenti grigio (farChevronMarker/
        // farDotFill guardano già selectedEdgeDatum).
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

    // Gruppo per i chevron direzionali vicino al nodo selezionato: la
    // sua unica funzione è portare il chevron direzionale bianco vicino a
    // ciascun edge collegato al nodo aperto (uno per edge, entrante o
    // uscente). Vedi computeNodeChevronD/updateNodeChevrons più sotto.
    nodeChevrons = container.append("g").attr("class", "node-chevrons");

    // Stesso identico chevron, ma grigio (stesso colore degli edge) e
    // vicino all'estremo OPPOSTO — cioè al vicino B, non al nodo aperto
    // A. Racconta lo stesso edge dal suo punto di vista, con lo stesso
    // linguaggio visivo, così non serve più nessun marker sul path
    // dell'edge stesso. Vedi computeNodeChevronD/updateNodeChevrons.
    nodeFarChevrons = container.append("g").attr("class", "node-far-chevrons");

    // Gruppo per i pallini delle interazioni SIMMETRICHE (interagisce
    // con, si verifica con, adiacente a...) vicino al nodo selezionato:
    // niente verso da mostrare, quindi solo un piccolo indicatore neutro
    // invece del chevron direzionale. Stesso punto di ancoraggio dei
    // chevron (vedi computeNearNodeAnchor), disegnato con un cerchio.
    nodeNeutralDots = container.append("g").attr("class", "node-neutral-dots");

    // Equivalente "lontano" (vicino a B, grigio) dei pallini neutri, per
    // coerenza con i chevron: stesso trattamento su entrambi gli estremi
    // dell'edge, cambia solo colore/posizione.
    nodeFarNeutralDots = container
      .append("g")
      .attr("class", "node-far-neutral-dots");

    const defs = svg.select("defs").empty()
      ? svg.append("defs")
      : svg.select("defs");

    // Un solo linguaggio visivo per la direzione, invece di due: niente
    // più freccia "lontana" sul path visibile (duplicava, per la
    // maggioranza degli edge, la stessa informazione già data dal
    // chevron vicino al nodo aperto — la stessa cosa raccontata due
    // volte, in due punti diversi dello schermo). Restano solo i chevron
    // "ad anello": uno bianco vicino al nodo selezionato (A), e uno
    // grigio — stesso trattamento, stessa distanza, stessa forma, solo
    // colore diverso — vicino a ciascun vicino (B) collegato, per lo
    // stesso edge letto dal suo punto di vista. Vedi
    // computeNodeChevronD/updateNodeChevrons più sotto: la funzione è
    // generica sul nodo, quindi il chevron "lontano" è semplicemente lo
    // stesso calcolo applicato all'altro estremo dell'edge.
    //
    // refX qui è 4.5 (il CENTRO della sagoma, che va da x=2 a x=7), non
    // 7 (la punta): l'SVG piazza sempre il punto refX/refY esattamente
    // sul punto finale del path e ruota attorno a quello. Con refX=7 (la
    // punta) la sagoma peserebbe quasi tutta verso il nodo quando il
    // chevron punta in fuori (uscita), e quasi tutta lontano dal nodo
    // quando punta in dentro (entrata) — stessa distanza esatta del
    // punto-ancora, ma il disegno vero e proprio finirebbe sbilanciato in
    // direzioni opposte. Centrando il punto di rotazione, la sagoma resta
    // centrata sulla stessa distanza in entrambi i versi.
    // Un marker per ruolo (attivo/passivo) e per distanza (vicino al nodo
    // aperto/vicino al vicino): stessa identica sagoma e dimensione di
    // prima, cambia solo colore e opacità. Il "lontano" resta più
    // discreto (stroke-opacity ridotta) esattamente come prima faceva col
    // grigio — qui però la tinta è quella del ruolo, non più un grigio
    // neutro, così i due capi dello stesso edge raccontano insieme chi
    // agisce e chi subisce senza dover decifrare l'angolo della freccia.
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

    // Filtro di desaturazione per le specie non ancora osservate: più
    // intuitivo e più elegante di un semplice abbassamento di opacità,
    // e coerente con l'idea di "presenza non confermata".
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
      .attr("href", (d) => d.image)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .attr("width", (d) => sizeScale(d.degree) * 2)
      .attr("height", (d) => sizeScale(d.degree) * 2)
      .attr("filter", (d) => (d.notObserved ? "url(#grayscale-filter)" : null));

    container
      .selectAll("circle.bg")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "bg")
      .attr("r", (d) => sizeScale(d.degree))
      .attr("fill", (d) => d.color)
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

    // Quanto l'arco si scosta dalla corda, in frazione della corda stessa.
    // 0.134 riproduce esattamente la curvatura di prima (raggio = corda).
    const ARC_BULGE = 0.134;
    // Distanza fra archi paralleli fra la stessa coppia di specie, in px.
    const ARC_SEPARATION = 16;

    // Il punto finale dell'arco coincide col centro del nodo target: la
    // punta della freccia finirebbe quindi sempre nascosta sotto il suo
    // cerchio. La accorciamo lungo la direzione (approssimata alla retta
    // fra i due centri, sufficiente vista la leggera curvatura degli archi)
    // di un raggio, così la freccia resta visibile appena fuori dal nodo.
    function shortenToRadius(x1, y1, x2, y2, radius) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: x2 - (dx / len) * radius,
        y: y2 - (dy / len) * radius,
      };
    }

    // Interseca il cerchio su cui giace l'arco (centro O, raggio R) con il
    // cerchio di un nodo (centro C, raggio r). Le intersezioni sono due:
    // teniamo quella rivolta verso l'altro nodo, cioè il punto in cui
    // l'arco esce davvero dal disco del nodo.
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

    // UNICA fonte di verità geometrica per un edge: restituisce i due
    // estremi E il raggio dell'arco. Sia il path visibile, sia la hit-area,
    // sia il path-guida del testo partono da qui, quindi sono garantiti
    // essere esattamente la stessa curva.
    //
    // La differenza rispetto a prima: gli estremi non sono più calcolati
    // sulla RETTA fra i due centri e poi usati per disegnare un ARCO (due
    // curve diverse: l'arco parte dal punto giusto ma se ne va per la sua
    // strada, e con gli edge paralleli l'estremo veniva pure traslato in
    // diagonale di (offset, offset), staccandolo dal nodo). Qui l'arco
    // viene definito prima, e gli estremi sono l'intersezione esatta fra
    // quell'arco e i bordi dei due nodi: per costruzione non può restare
    // "appeso". E gli edge paralleli si separano variando la curvatura,
    // non spostando gli attacchi.
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

      // Sagitta = scostamento massimo dell'arco dalla corda. Variandola si
      // "aprono a ventaglio" gli edge paralleli tenendoli però ancorati.
      // I limiti evitano sia l'arco quasi-dritto sia il semicerchio (che
      // richiederebbe large-arc-flag = 1).
      let sagitta =
        chord * ARC_BULGE + (index - (count - 1) / 2) * ARC_SEPARATION;
      sagitta = Math.max(chord * 0.03, Math.min(sagitta, chord * 0.45));

      const R = ((chord * chord) / 4 + sagitta * sagitta) / (2 * sagitta);

      // Centro del cerchio dell'arco, nella convenzione SVG usata qui
      // (large-arc-flag 0, sweep-flag 1).
      const h = Math.sqrt(Math.max(0, R * R - (chord * chord) / 4));
      const nx = -dy / chord;
      const ny = dx / chord;
      const ox = (x1 + x2) / 2 + h * nx;
      const oy = (y1 + y2) / 2 + h * ny;

      let p1 = null;
      let p2 = null;

      // Se i nodi sono praticamente sovrapposti l'intersezione non esiste o
      // è instabile: in quel caso si ripiega sull'accorciamento lineare,
      // con i raggi riscalati per non incrociarsi.
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

    // Path-guida per il testo: stessa identica curva del path visibile,
    // solo eventualmente percorsa al contrario (scambio degli estremi +
    // sweep-flag invertito, che produce la stessa forma sullo schermo) per
    // non far apparire il testo capovolto.
    function computeTextPathD(d) {
      const { p1, p2, R } = d.__arc || arcGeometry(d);
      return p1.x <= p2.x
        ? `M${p1.x},${p1.y} A${R},${R} 0 0,1 ${p2.x},${p2.y}`
        : `M${p2.x},${p2.y} A${R},${R} 0 0,0 ${p1.x},${p1.y}`;
    }

    // ARROW_REVERSED_TYPES, INTERACTION_COLOR e gli helper di ruolo sono
    // dichiarati a livello di modulo (vedi sopra, vicino a SYMMETRIC_TYPES):
    // servono sia qui sia nel blocco <defs> più sopra nel file, quindi
    // devono esistere PRIMA di entrambi, non in mezzo.

    // Path visibile e sua hit-area: stessa geometria del path-guida del
    // testo, così l'hitbox coincide sempre col tratto disegnato. Per i
    // tipi in ARROW_REVERSED_TYPES il path viene percorso al contrario
    // (stesso trucco di computeTextPathD: scambio estremi + sweep-flag
    // invertito, forma visiva identica) in modo che marker-end — sempre
    // applicato all'ultimo punto — finisca sull'estremo giusto: chi
    // SUBISCE l'azione, non chi la compie. Questa direzione è FISSA,
    // indipendente da quale nodo hai aperto — a differenza della label
    // (che invece cambia con labelForViewpoint), la freccia racconta
    // sempre lo stesso fatto biologico.
    function computeArcD(d) {
      const { p1, p2, R } = d.__arc || arcGeometry(d);
      if (ARROW_REVERSED_TYPES.has(d.type)) {
        return `M${p2.x},${p2.y} A${R},${R} 0 0,0 ${p1.x},${p1.y}`;
      }
      return `M${p1.x},${p1.y} A${R},${R} 0 0,1 ${p2.x},${p2.y}`;
    }

    // Vettore tangente all'arco nel punto `point`, sul cerchio di centro
    // `center`. Ci sono sempre due tangenti possibili (opposte): quella
    // giusta è disambiguata col prodotto scalare rispetto alla corda
    // dell'edge, cioè scegliamo il verso che "punta" nella direzione in
    // cui l'arco sta effettivamente andando in quel punto.
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

    // Punto di ancoraggio vicino al nodo `nodeId`, per l'edge `d`: parte
    // dal punto in cui l'arco esce dal disco del nodo (già calcolato in
    // arcGeometry) e si sposta di NODE_CHEVRON_GAP px lungo la VERA
    // circonferenza dell'arco (centro ox,oy) — NON in linea retta dal
    // centro del nodo (radiale): un arco non esce quasi mai in direzione
    // radiale, quindi quello spostamento portava il marker leggermente
    // FUORI dalla curva vera, sbandato di lato. Ruotando nearPoint di un
    // angolo pari allo spostamento d'arco, il risultato resta invece
    // esattamente SOPRA al tratto disegnato, qualunque sia l'angolo con
    // cui l'arco stacca dal nodo. Condiviso da chevron (direzionali) e
    // pallini (interazioni neutre): entrambi vanno nello stesso punto,
    // cambia solo cosa ci si disegna sopra.
    //
    // Il verso della rotazione è SEMPRE "verso l'altro nodo lungo la
    // curva" (l'unico per cui ci si allontana dal nodo selezionato
    // restando sul tratto disegnato) — un dettaglio puramente
    // geometrico, indipendente dal verso semantico del flusso (quello
    // usato invece per orientare la PUNTA del chevron, vedi
    // computeNodeChevronD).
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

    // Calcola il segmento del chevron vicino al nodo `nodeId`, per l'edge
    // `d`: usa il punto di ancoraggio comune (sopra), orientato nella
    // direzione tangente all'arco in quel punto — cioè nella direzione
    // reale in cui quell'edge sta "partendo" o "arrivando".
    function computeNodeChevronD(d, nodeId) {
      const anchor = computeNearNodeAnchor(d, nodeId);
      if (!anchor) return null;
      const { p1, p2, ox, oy, nearPoint } = anchor;

      // Stesso verso usato dal marker-end sul path visibile (computeArcD):
      // normalmente da p1 a p2, ma invertito per i tipi in
      // ARROW_REVERSED_TYPES, dove il csv salva come "source" chi SUBISCE
      // l'azione e come "target" chi la compie — il flusso reale va
      // quindi da p2 a p1, non da p1 a p2. Senza questo, il chevron di
      // quei tipi puntava esattamente al contrario.
      const flowReversed = ARROW_REVERSED_TYPES.has(d.type);
      const chordX = flowReversed ? p1.x - p2.x : p2.x - p1.x;
      const chordY = flowReversed ? p1.y - p2.y : p2.y - p1.y;

      // Tangente al cerchio DELL'ARCO (non a quello del nodo): è la vera
      // direzione lungo cui quell'edge sta viaggiando in quel punto — la
      // stessa cosa che SVG usa per orientare la freccia lontana sul path
      // visibile (orient=auto segue sempre la curva vera, non il nodo).
      // Un tentativo precedente orientava invece perpendicolarmente al
      // raggio del NODO: sembra una scelta innocua ("più liscia sulla
      // circonferenza") ma è concettualmente sbagliata — indica "di lato,
      // intorno al nodo", non "verso dove va l'edge". Quando molti vicini
      // sono raggruppati in una zona angolare simile, quella direzione
      // "di lato" risultava quasi identica per edge diversi: da lì i
      // chevron che sembravano puntare tutti nella stessa direzione senza
      // ragione. Con la tangente dell'arco, ogni chevron punta davvero
      // dove va la SUA curva.
      const tangent = tangentAtPoint(
        nearPoint,
        { x: ox, y: oy },
        chordX,
        chordY
      );

      // L'orientamento della sagoma è quello SEMANTICO (`tangent`): è
      // quello che decide se la chevron punta in fuori o in dentro,
      // indipendentemente da dove sta il punto di ancoraggio.
      const backX = anchor.x - tangent.x * 4;
      const backY = anchor.y - tangent.y * 4;

      return `M${backX},${backY} L${anchor.x},${anchor.y}`;
    }

    // Ricalcola posizione/orientamento di tutti i chevron intorno al nodo
    // attualmente selezionato. Va richiamata ad ogni tick (i nodi si
    // muovono) e ogni volta che cambia il nodo selezionato.
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

    // Selezioni tenute da parte: rifarle con selectAll a ogni fotogramma
    // costava una scansione del DOM per ogni tick.
    const nodeCircles = container.selectAll("circle.node");
    const bgCircles = container.selectAll("circle.bg");

    // Stessa curva dell'arco visibile, ma tracciata sempre da sinistra a
    // destra (vedi computeTextPathD): il testo lungo il path segue così
    // una direzione leggibile.
    function syncTextPaths() {
      linkTextPaths.attr("d", computeTextPathD);
    }

    simulation.on("tick", () => {
      // Vincolo rigido: qualunque nodo che NON fa parte della componente
      // connessa principale (cioè fa parte di un cluster satellite,
      // magari collegato solo ad altri 2-3 nodi ma isolato dal resto della
      // rete) non può mai superare una distanza massima dal centro,
      // qualunque cosa facciano le altre forze e quante volte si riavvii
      // la simulazione con la barra spaziatrice.
      const cx = width / 2;
      const cy = height / 2;
      const maxDistSatellite = Math.min(width, height) * 1.1;

      nodes.forEach((d) => {
        if (d.fx != null || d.fy != null) return; // non toccare un nodo che si sta trascinando
        if (d.isMainComponent) return;

        const dx = d.x - cx;
        const dy = d.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDistSatellite) {
          // Invece di teletrasportare il nodo esattamente sul bordo (il
          // che causava uno "scatto" visibile quando si rilasciava un
          // nodo trascinato fuori dal raggio), applichiamo una leggera
          // spinta verso il centro proporzionale a quanto si è sconfinato:
          // il nodo rientra scivolando dolcemente nei fotogrammi
          // successivi invece di saltare di colpo.
          const overshoot = dist - maxDistSatellite;
          const pullStrength = 0.001; // più alto = rientro più rapido/deciso
          d.vx -= (dx / dist) * overshoot * pullStrength;
          d.vy -= (dy / dist) * overshoot * pullStrength;
        }
      });

      // La geometria di ogni edge viene calcolata una volta sola per
      // fotogramma e riusata dai tre path che la condividono (visibile,
      // hit-area, guida del testo): prima veniva ricalcolata tre volte.
      links.forEach((l) => {
        l.__arc = arcGeometry(l);
      });

      // Arco visibile e hit-area hanno la stessa identica geometria: la
      // stringa del path si calcola una volta sola e si scrive su entrambi.
      const hitNodes = linkHitAreas.nodes();
      curvedLinks.each(function (d, i) {
        const dStr = computeArcD(d);
        this.setAttribute("d", dStr);
        hitNodes[i].setAttribute("d", dStr);
      });

      // I path-guida del testo servono SOLO alle etichette di un nodo
      // aperto: aggiornarne migliaia a ogni fotogramma, quando nessuna
      // etichetta è visibile, era lavoro sprecato (e una delle cause dei
      // rallentamenti). Si sincronizzano all'apertura di un nodo
      // (syncTextPaths) e qui solo finché un nodo è aperto.
      if (selectedNodeId) syncTextPaths();

      nodeCircles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      bgCircles.attr("cx", (d) => d.x).attr("cy", (d) => d.y);

      if (selectedNodeId) {
        updateNodeChevrons();
      }

      updateBoundary();
    });

    // Temporaneamente disattivato su richiesta: il bottone reset è
    // nascosto (vedi CSS) e la barra spaziatrice non deve più richiamarlo.
    // La funzione resta cablata, solo spenta da questo flag: per
    // riattivarla basta rimettere RESET_BUTTON_ENABLED a true e togliere
    // il display:none su button#reset in style.css.
    const RESET_BUTTON_ENABLED = false;

    d3.select("#reset").on("click", () => {
      if (!RESET_BUTTON_ENABLED) return;
      simulation.alpha(1).restart();
      resetHighlightAndLabels();
      infoBox.style("opacity", 0);
    });

    d3.select("body").on("keydown", (event) => {
      if (!RESET_BUTTON_ENABLED) return;
      // Se si sta scrivendo in un campo di testo (la barra di ricerca), lo
      // spazio deve restare uno spazio: senza questo controllo ogni parola
      // composta digitata nella ricerca faceva ripartire la simulazione.
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

    // Tutto ciò che accade quando una specie viene "aperta": evidenziazione,
    // anello di selezione, etichette sugli edge, pannello informativo.
    // Estratto dall'handler del click perché ora ci si arriva da due strade
    // diverse — il click sul nodo e la selezione dalla barra di ricerca —
    // e devono comportarsi in modo identico.
    // Annulla l'edge "aperto nell'inspector" (lo riporta al grigio di
    // riposo) e pulisce lo stato. Va richiamata ogni volta che cambia il
    // contesto — nodo diverso selezionato, o deselezione — perché
    // altrimenti il bianco resterebbe appeso a un edge che non ha più
    // niente a che fare con quello che si sta guardando ora.
    function clearSelectedEdge() {
      if (selectedEdgeDatum) {
        d3.select(`#link-path-${links.indexOf(selectedEdgeDatum)}`)
          .attr("stroke", EDGE_COLOR)
          .attr("stroke-width", 0.4);
      }
      selectedEdgeDatum = null;
      updateFarMarkerHighlight();
    }

    // Icona di ogni riga "Interazioni" nel Node-Inspector (e dell'Edge-
    // Inspector): stesso linguaggio visivo dei marker sul grafo (chevron a
    // punta per i tipi direzionali, pallino per quelli simmetrici), ora
    // colorato secondo lo stesso ruolo attivo/passivo/neutro.
    function interactionIconHTML(typeLabel) {
      if (!SHOW_INTERACTION_SYMBOLS) return "";
      const role = interactionRole(typeLabel);
      if (role === "neutral") {
        return `<span class="ni-dot"></span>`;
      }
      const color = INTERACTION_COLOR[role];
      // Niente <svg>: la regola globale "svg { width:100vw; height:100vh }"
      // (per il grafo principale) si applicherebbe a QUALSIASI tag svg
      // nella pagina, icona compresa, rendendola invisibile. Lo stesso
      // chevron ">"/"<" si ottiene con un quadratino ruotato 45° con
      // bordo solo su due lati — nessun conflitto possibile. Il colore è
      // inline (non in classe) perché cambia per singola riga, non per
      // tipo di inspector.
      return `<span class="ni-chevron${
        role === "passive" ? " ni-chevron--in" : ""
      }" style="border-top-color:${color}; border-right-color:${color};"></span>`;
    }

    // Stato del filtro "Solo non osservate" e del suo bottone. Vive qui,
    // prima di selectNode, perché qualunque altra azione che ridisegna la
    // rete (click sullo sfondo, apertura di un nodo, reset) esce di fatto
    // dalla modalità e deve spegnere anche il bottone: prima restava
    // "premuto" a vista pur non essendo più attivo.
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

      // Oltre all'opacità, le specie non collegate si sfocano (stesso
      // criterio di sopra): aiuta a staccare il nodo aperto dal resto.
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

      // Bordo solido bianco direttamente sul cerchio del nodo selezionato,
      // al posto del vecchio anello tratteggiato separato.
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

      // Un chevron bianco per ogni edge collegato (entrante o uscente),
      // posizionato appena fuori dal bordo del nodo selezionato e
      // orientato secondo la direzione reale di quell'edge. I tipi
      // SIMMETRICI (interagisce con, adiacente a...) non hanno una
      // direzione da mostrare: prendono un pallino neutro invece del
      // chevron (vedi subito sotto).
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

      // Lo stesso chevron, grigio, vicino al VICINO (l'altro estremo di
      // ogni edge): stesso edge, stesso linguaggio visivo, letto dal suo
      // punto di vista invece che da quello del nodo aperto.
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

      // Pallino neutro per gli edge SIMMETRICI: stesso punto di
      // ancoraggio dei chevron (nessuno spostamento diverso da
      // imparare), ma senza freccia/verso, dato che questi tipi non ne
      // hanno uno da comunicare.
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

      // Stesso pallino, grigio, vicino al vicino — coerente col
      // trattamento dei chevron sopra.
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
          <img class="ni-photo" src="${d.image}" alt="${d.name}" />
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

      // Hover sul numero (solo il riquadro, non la parola "specie" accanto):
      // evidenzia nella rete le specie di quel tipo di interazione.
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

    // Evidenzia, per il nodo aperto, solo le specie legate da `type` (null =
    // torna alla vista normale del nodo aperto). Riusa le stesse opacità e
    // lo stesso blur di selectNode; cambia solo CHI resta acceso.
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
      // Guida aperta: un click sullo sfondo non deve chiudere il nodo
      // mostrato dallo step.
      if (tourLockPolicy) return;
      resetHighlightAndLabels();
      infoBox.style("opacity", 0);
      closeSearchResults();
    });

    // ======================================================================
    // BARRA DI RICERCA
    // ======================================================================
    // Posizione: in alto al CENTRO, sopra al grafo. Il contatore della
    // specie più connessa resta in alto a destra e l'info-box in basso a
    // destra: nessuno dei due viene toccato. Sotto i 960px di larghezza
    // (vedi media query qui sotto) la ricerca scende su una seconda riga
    // per non sovrapporsi al contatore.

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

    // Quali colonne del CSV vengono interrogate. Invece di fissarle a mano,
    // vengono raccolte tutte quelle che "parlano di nomi": così se domani
    // il CSV guadagna una colonna (common_name, nome_dialettale...) entra
    // nella ricerca da sola, senza toccare questo file.
    const searchFields = Array.from(
      new Set(
        ["name", "scientific_name"].concat(
          Object.keys(nodes[0] || {}).filter((k) =>
            /name|nome|specie|species/i.test(k)
          )
        )
      )
    ).filter((k) => nodes.some((n) => typeof n[k] === "string" && n[k].trim()));

    // Accenti e maiuscole non devono mai far fallire una ricerca: "Ardea"
    // trova "ardea", "cicogna" trova "Cicógna".
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

    // Evidenzia in grassetto il pezzo di testo che corrisponde alla query,
    // così si capisce a colpo d'occhio PERCHÉ un risultato è nell'elenco
    // (utile quando il match è sul nome scientifico e non su quello comune).
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

    // Punteggio più basso = risultato migliore. Un match a inizio parola
    // vale più di uno a metà parola, e un match sul nome comune vale più
    // di uno su un campo secondario: così chi digita "air" vede prima
    // "Airone cenerino" e non una specie il cui nome scientifico contiene
    // "air" da qualche parte in mezzo.
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

    // Porta la vista sulla specie scelta. Senza questo la selezione da
    // ricerca "funzionerebbe" ma il nodo potrebbe restare fuori schermo,
    // e sembrerebbe che non sia successo nulla.
    function focusOnNode(d) {
      // Se l'utente cerca prima che la simulazione si sia stabilizzata,
      // l'auto-fit iniziale scatterebbe dopo, cancellando l'inquadratura.
      hasAutoFitted = true;

      const current = d3.zoomTransform(svg.node());
      const scale = Math.min(Math.max(current.k, 1.1), 2.2);
      // Leggermente a sinistra del centro: l'info-box occupa la parte
      // destra dello schermo appena la specie viene aperta.
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

    // Svuota il campo e chiude l'elenco. Condivisa fra il tasto × e il
    // click fuori dalla barra: in entrambi i casi non deve restare scritto
    // né il nome digitato a metà né quello di una specie già selezionata
    // dalla ricerca.
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

    // Il mousedown (non il click) previene il blur dell'input prima che il
    // risultato venga registrato: altrimenti su alcuni browser l'elenco si
    // chiude un istante prima che il click arrivi a destinazione.
    searchResults
      .on("mousedown", (event) => event.preventDefault())
      .on("click", (event) => {
        const item = event.target.closest(".search-result");
        if (!item) return;
        chooseResult(currentResults[+item.dataset.index]);
      });

    // Un click ovunque fuori dalla barra svuota il campo e chiude l'elenco:
    // non deve restare visibile né una ricerca a metà né il nome di una
    // specie scelta in precedenza. Il click sui risultati (dentro
    // searchBox) e quello sui nodi/sull'svg non rientrano in questo
    // branch — qui si gestisce solo il "click altrove".
    document.addEventListener("click", (event) => {
      if (!searchBox.node().contains(event.target)) clearSearchInput();
    });

    // "/" mette il cursore nella ricerca, come nelle interfacce di ricerca
    // più diffuse. Non interferisce con la barra spaziatrice del reset.
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
          // Non alterare lo zoom mentre si sta trascinando attivamente
          // con il click (evita conflitti durante il pan).
          if (isMouseDragging) return false;
          // Per il resto, lascia passare qualsiasi evento wheel: sia il
          // pinch (ctrlKey) sia lo scroll a due dita, sia la rotellina
          // del mouse.
          return true;
        }
        return !event.ctrlKey && !event.button;
      })
      .on("start", (event) => {
        setMoving(true);
        if (event.sourceEvent && event.sourceEvent.type === "mousedown") {
          isMouseDragging = true;
        }
        // Le etichette con textPath sono costose da ridisegnare ad ogni
        // fotogramma (il browser deve ricalcolare la posizione di ogni
        // lettera lungo la curva). Nascondendole durante il movimento
        // attivo si evita il crollo di frame rate che causava i "salti"
        // — soprattutto evidente sui nodi con molti collegamenti aperti.
        // Se però un nodo è selezionato, l'utente vuole vederle sempre:
        // in quel caso rinunciamo all'ottimizzazione e le lasciamo visibili.
        if (!selectedNodeId) {
          edgeLabels.style("display", "none");
        }
      })
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      })
      .on("end", () => {
        setMoving(false);
        isMouseDragging = false;
        edgeLabels.style("display", null);
      });

    svg.call(zoom);

    // Disattiva lo zoom-al-doppio-click integrato di D3: senza questo,
    // cliccare un nodo e poi cliccare altrove per chiuderlo (due click
    // ravvicinati) può essere interpretato dal browser come un doppio
    // click sull'svg, facendo scattare uno zoom improvviso non voluto.
    svg.on("dblclick.zoom", null);

    // L'auto-fit iniziale deve avvenire una sola volta: prima usava sia
    // "simulation end" sia un setTimeout, e "end" si riattiva ogni volta
    // che si trascina un nodo, quindi la vista si ricentrava da sola e
    // cancellava lo zoom/pan manuale dell'utente ("salto" percepito).
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

    function updateTextPath(radius, cx, cy) {
      const rText = radius - 60;
      const d = `
      M ${cx + rText} ${cy}
      A ${rText} ${rText} 0 1 1 ${cx - rText} ${cy}
      A ${rText} ${rText} 0 1 1 ${cx + rText} ${cy}
    `;
      svg.select(`#${textPathId}`).attr("d", d);
    }

    // =====================================================================
    // Tour guidato "Come leggere la rete": a differenza della vecchia guida
    // (schemi astratti A/B dentro un pannello isolato), questo pilota il
    // grafo VERO — illumina i nodi di cui si sta parlando, lascia che
    // l'utente li clicchi per davvero, e il testo si aggiorna in base a
    // cosa succede sullo schermo. Vive qui (non a livello di modulo come
    // la vecchia versione) perché ha bisogno di nodes/links/selectNode/
    // resetHighlightAndLabels, che esistono solo dopo il caricamento dei
    // csv. Il pannello è una card fissa in basso, non un overlay a schermo
    // intero: il grafo resta visibile e cliccabile dietro.
    // =====================================================================

    // Trova un nodo per nome comune o scientifico (case-insensitive):
    // usato per l'esempio Biacco/Scoiattolo, con un fallback sotto se uno
    // dei due non esistesse nel dataset caricato in quel momento.
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

    // Apre un nodo ESATTAMENTE come farebbe un click vero (stessa
    // funzione selectNode usata dal listener reale): bordo bianco,
    // chevron/pallini su tutta la sua adiacenza, inspector popolato,
    // resto del grafo spento. Il tour la usa al posto di una preview
    // "finta" così quello che l'utente vede durante la guida è
    // identico, pixel per pixel, a quello che vedrà dopo cliccando da
    // solo — è stato esplicitamente richiesto di non distinguere più i
    // due casi.
    function tourOpenNodeReal(d) {
      if (!d) return;
      selectNode(d);
    }

    // Un nodo aperto per davvero può avere decine di collegamenti tutti
    // alla stessa opacità/colore: quello di cui parla la guida si perde
    // nella miriade. tourApplyEdgeEmphasis lo illumina (bianco, più
    // spesso) e scurisce un po' tutti gli ALTRI collegamenti dello
    // stesso nodo (non quelli già spenti perché non collegati, quelli
    // restano com'erano) così l'occhio va dritto a quello giusto.
    let tourHighlightedEdge = null;
    let tourDimmedSiblingEdges = [];
    // Quanto scurire tutto ciò che è collegato al nodo aperto ma non
    // riguarda l'esempio di cui parla la card: più acceso dello sfondo
    // (0.1, i nodi/edge del tutto scollegati) ma chiaramente secondario
    // rispetto al collegamento in evidenza (1) — stesso valore per ogni
    // tipo di elemento (nodi, edge, chevron/pallini, label).
    const TOUR_SIBLING_DIM = 0.4;
    // Inquadratura dei due step "direzionali" (3 e 4): margine e zoom
    // massimo. pad/padX più bassi = coppia più grande a schermo (padX è
    // largo perché a destra c'è l'inspector); maxScale più alto = permette
    // zoom più vicini quando i due nodi sono ravvicinati.
    const TOUR_PAIR_FOCUS = { pad: 110, padX: 430, maxScale: 2.8 };

    // Strato in primo piano: copia "viva" (<use>) del collegamento in
    // evidenza con chevron e pallini, disegnata SOPRA i nodi, così nessun
    // nodo (anche se semitrasparente) lo copre. Le copie seguono gli
    // originali, quindi restano allineate anche se la simulazione si muove.
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

      // Tutti gli ALTRI collegamenti dello stesso nodo aperto (non quello
      // di cui si parla): vengono scuriti, e con loro anche i nodi
      // all'altro capo, i loro chevron/pallini (vicino e lontano) e la
      // label — altrimenti resterebbero accesi al massimo e il
      // collegamento giusto si perderebbe comunque in mezzo a loro.
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

      // I pallini delle interazioni simmetriche sono minuscoli (r:2) e,
      // anche zoomati, rischiano di restare poco leggibili: quello
      // dell'edge in evidenza (vicino E lontano) viene ingrandito un
      // filo, solo durante il tour — torna alla dimensione normale da
      // solo al prossimo giro di selectNode/resetHighlightAndLabels.
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

    // Scorciatoia usata da tutti gli step dal vivo: apre il nodo per
    // davvero E mette subito in evidenza l'unico collegamento di cui
    // parla la card, scurendo gli altri collegamenti dello stesso nodo.
    function tourOpenNodeWithEdgeFocus(d, edge) {
      tourOpenNodeReal(d);
      tourApplyEdgeEmphasis(edge, d ? d.scientific_name : null);
    }

    // Zoom/pan automatico sul soggetto dello step corrente: incornicia i
    // punti passati (uno o più nodi) spostando il centro un po' più in
    // alto del centro reale dello schermo, per lasciare libera l'area in
    // basso dove sta la card del tour. Disattiva l'auto-fit iniziale
    // della simulazione (hasAutoFitted) così non lo sovrascrive più tardi.
    // La simulazione può ancora muovere i nodi mentre lo zoom parte: dopo la
    // transizione si ricalcola l'inquadratura sulle posizioni aggiornate
    // (una sola volta, solo se i nodi si sono spostati davvero), così la
    // vista resta centrata. tourFocusToken invalida i ricontrolli
    // di uno step già abbandonato.
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

    // Per gli step senza un soggetto puntuale (copertina, chiusura):
    // inquadra l'intera rete, stesso fit usato all'avvio della pagina.
    function tourFocusOnWholeGraph() {
      hasAutoFitted = true;
      scaleAndCenter(nodes);
    }

    // ---- Step "interazioni direzionali": Biacco/Scoiattolo dal vivo ----
    let tourPairIds = null; // {a, b, edge} risolti all'inizio del tour (step "cover")

    function resolveDirectionalExample() {
      // Esempio fisso: Biacco (primo nodo, quello aperto) e Poiana
      // (secondo nodo, quello a cui si passa nello step dopo).
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
      // Fallback: se l'esempio Biacco/Poiana non è nel dataset caricato
      // in questo momento (es. dati di test), prende la prima interazione
      // direzionale che trova — il tour resta sempre funzionante.
      if (!edge || SYMMETRIC_TYPES.has(edge.type)) {
        edge = links.find((lk) => !SYMMETRIC_TYPES.has(lk.type));
        aId = edge ? nodeIdOf(edge.source) : null;
        bId = edge ? nodeIdOf(edge.target) : null;
      }
      tourPairIds = edge ? { a: aId, b: bId, edge } : null;
    }

    // Testo per lo step "intro": il tour ha già aperto per davvero il
    // primo nodo (a) prima che questa funzione sia chiamata.
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

    // Testo per lo step "switch": il tour stesso passa l'apertura dal
    // primo al secondo nodo (nessun click richiesto all'utente).
    function directionalSwitchHTML() {
      if (!tourPairIds) {
        return `<p class="guide-step-body">Esempio non disponibile con i dati caricati in questo momento.</p>`;
      }
      const nodeA = nodeByName.get(tourPairIds.a);
      const nodeB = nodeByName.get(tourPairIds.b);
      const labelA = labelForViewpoint(tourPairIds.edge, tourPairIds.a);
      const labelB = labelForViewpoint(tourPairIds.edge, tourPairIds.b);
      // "mangiato da" vuole l'ausiliare ("è mangiato da"), "mangia" no.
      // Il participio concorda col soggetto: nomi in -a → "mangiata da".
      const verb = (label, subject) => {
        const passive = interactionRole(label) === "passive";
        const text =
          passive && /a$/i.test(subject.trim())
            ? label.replace(/(\w)ato da$/i, "$1ata da")
            : label;
        return `${passive ? "è " : ""}<em>${text}</em>`;
      };
      // Una riga dello schema: "chi guarda" — etichetta sopra la freccia —
      // "l'altro". La freccia punta verso chi subisce: se per chi guarda
      // l'etichetta è passiva (es. "mangiato da") punta a sinistra.
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
    // Anche qui il nodo è già aperto per davvero (tourOpenNodeReal) quando
    // questa viene chiamata: essendo un'interazione simmetrica, non serve
    // un secondo click obbligatorio — la lettura non cambierebbe comunque.
    function neutralGuidanceHTML() {
      return `<p class="guide-step-body">In alcuni casi le interazioni non hanno verso, sono reciproche. In queste relazioni non esistono attori attivi o passivi.</p>`;
    }

    // ---- Step "specie non osservate": bianco e nero = 0 osservazioni ----
    // Condivisa con il bottone permanente "Solo non osservate" (sotto):
    // la stessa funzione serve sia il tour sia l'uso libero a tour chiuso.
    // (stato e syncNotObservedToggle sono dichiarati più in alto, prima di
    // selectNode, perché anche reset e selezione devono poterlo spegnere)
    // Durata (ms) della dissolvenza quando si accende/spegne il filtro
    // "Solo non osservate": opacità + blur passano gradualmente invece di
    // scattare. 0 = cambio istantaneo, come prima. Le transizioni CSS sono
    // attive SOLO per questa durata (classe "spotlight-anim" sul body):
    // tenerle sempre accese faceva sfarfallare i nodi cliccandone di
    // seguito parecchi.
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
        // Prima il reset (che azzera anche lo stato del bottone), poi lo
        // stato "attivo": nell'ordine inverso il bottone risultava spento.
        tourResetVisuals();
        syncNotObservedToggle(true);
        node.style("opacity", (nd) => (nd.notObserved ? 1 : 0.08));
        container
          .selectAll("circle.bg")
          .style("opacity", (bgd) => (bgd.notObserved ? 1 : 0.08));
        curvedLinks.style("opacity", 0.05);
        // Stesso blur usato quando si apre un nodo: le specie osservate
        // (spente) si sfocano, quelle non osservate restano nitide.
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

    // Bottone permanente, indipendente dal tour: resta sulla pagina anche
    // dopo che il tour è stato chiuso, così il filtro è riusabile quando
    // si vuole, non solo durante la guida.
    let notObservedToggle = d3.select("body").select("#not-observed-toggle");
    if (notObservedToggle.empty()) {
      notObservedToggle = d3
        .select("body")
        .append("button")
        .attr("id", "not-observed-toggle");
    }
    // Icona: cerchio tratteggiato (il nodo "vuoto", senza osservazioni).
    // Il nome resta nell'aria-label e nel tooltip.
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

    let tourClickExampleNode = null; // nodo aperto dallo step "click-species"
    // ---- I 7 step del tour ----
    const GUIDE_STEPS = [
      {
        key: "cover",
        modifier: "cover",
        title: "Come leggere la rete",
        onEnter() {
          // Risolti qui, una volta sola all'apertura del tour, così lo
          // spostarsi avanti e indietro tra gli step non li ricalcola
          // ogni volta.
          resolveDirectionalExample();
          resolveNeutralExample();
          tourClearSpotlight();
          tourFocusOnWholeGraph();
        },
        body: () =>
          `<p class="guide-step-body">Ogni nodo è una specie.<br>Ogni collegamento è un'interazione.<br> Ogni interazione ha un verso.</p>`,
      },
      {
        // Apre lo Scoiattolo come un click vero (selectNode, nessuna
        // enfasi/opacità aggiunta dal tour: identico alla rete normale) e
        // ci zooma sopra, così aggancia lo step successivo, dove lo
        // Scoiattolo compare insieme al Biacco. L'utente può comunque
        // cliccare qualsiasi altra specie: il grafo resta interattivo.
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
          // Lo switch lo fa il tour stesso, nessun click richiesto:
          // chiude Biacco e apre Scoiattolo, sullo stesso identico
          // collegamento già in evidenza dallo step precedente.
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
            // Qui non interessa l'elenco di tutte le interazioni del
            // nodo: interessa IL collegamento. Si apre anche l'inspector
            // dell'edge (lo stesso che si apre cliccandolo per davvero),
            // che mostra le due specie fianco a fianco con il pallino —
            // più chiaro, per un'interazione senza soggetto/oggetto, che
            // l'elenco di un singolo nodo.
            openEdgeInfo(tourNeutralPair.edge);
            // Zoom più stretto apposta per questo step: i due pallini
            // sono piccoli, devono essere ben leggibili.
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

    // Quali nodi si possono cliccare in ciascuno step. Tutto il resto
    // (hover/click sugli edge, click sullo sfondo, ricerca, filtro "solo
    // non osservate", trascinamento nodi) è bloccato per tutta la guida:
    // restano liberi solo pan e zoom.
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

    // Swipe orizzontale per chi è su touch, coerente con l'idea di
    // "carosello" anche sul pannello (non solo freccette/puntini).
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

    // Bottone "?" sempre visibile (in basso a sinistra) per riaprire il tour
    // in qualsiasi momento, anche a prima visita già passata.
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

    // Ascolta i click SUI NODI VERI in aggiunta al listener già presente
    // (namespace separato, ".tour": d3 li tiene entrambi attivi) solo per
    // sapere, durante lo step "direzionale", quale dei due nodi
    // dell'esempio l'utente ha effettivamente aperto — il resto
    // (evidenziazione reale, inspector) lo fa già selectNode() come
    // sempre, senza bisogno che il tour intervenga.
    // Negli step "direzionale" lo switch lo fa il tour stesso (vedi
    // "directional-switch" sopra): qui resta solo il caso facoltativo
    // dello step reciproco, dove si invita a cliccare l'altro nodo "per
    // provare" — se lo si fa, ri-evidenzia lo stesso collegamento sul
    // nuovo nodo aperto (altrimenti il click vero lo lascerebbe di
    // nuovo indistinguibile tra tutti gli altri).
    node.on("click.tour", (event, d) => {
      if (!guideIsOpen || !tourAllowsNodeClick(d)) return;
      const key = GUIDE_STEPS[guideStepIndex].key;
      if (
        (key === "directional-intro" || key === "directional-switch") &&
        tourPairIds
      ) {
        // Il click vero (selectNode) ha appena aperto il nodo: rimette in
        // evidenza lo stesso collegamento dell'esempio, altrimenti si
        // perderebbe di nuovo tra tutti gli altri.
        tourApplyEdgeEmphasis(tourPairIds.edge, d.scientific_name);
        return;
      }
      if (key !== "neutral" || !tourNeutralPair) return;
      tourApplyEdgeEmphasis(tourNeutralPair.edge, d.scientific_name);
      // Il click vero (selectNode) ha appena rimesso l'inspector sul
      // nodo: lo si riporta sull'edge, coerente con quello che mostra
      // questo step.
      openEdgeInfo(tourNeutralPair.edge);
    });

    // Prima visita: il tour si apre da solo una volta, poi resta solo su
    // richiesta (bottone "?"). Il flag si fissa subito, non alla chiusura,
    // così anche chi lo chiude senza finirlo non se lo ritrova ad ogni
    // ricarica — può comunque riaprirlo quando vuole.
    // "?guide" nell'URL la riapre sempre (comodo per riprovarla senza
    // svuotare il localStorage).
    let guideShouldOpen = new URLSearchParams(location.search).has("guide");
    try {
      if (!localStorage.getItem("autopoiesi-guide-seen")) {
        guideShouldOpen = true;
        localStorage.setItem("autopoiesi-guide-seen", "1");
      }
    } catch (e) {
      // localStorage non disponibile (storage bloccato, navigazione
      // privata): non si può sapere se è la prima visita, quindi la
      // guida si apre comunque — meglio vederla due volte che mai.
      guideShouldOpen = true;
    }
    if (guideShouldOpen) openGuide();
  }
);

function scaleAndCenter(nodes) {
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

  svg.transition().duration(1000).ease(d3.easeCubicOut).call(zoom.transform, t); // stessa istanza di zoom usata da svg.call(zoom) sopra,
  // così l'evento "zoom" viene ricevuto dall'handler che
  // aggiorna container.attr("transform", ...) ad ogni frame
  // della transizione, invece di scattare di colpo alla fine
}

function drag(simulation) {
  return (
    d3
      .drag()
      // Stesso filtro di default di d3.drag, più il blocco della guida:
      // con la guida aperta i nodi non si spostano (il pan dello sfondo
      // resta libero, l'evento passa all'svg).
      .filter((event) => !tourLockPolicy && !event.ctrlKey && !event.button)
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
  );
}
