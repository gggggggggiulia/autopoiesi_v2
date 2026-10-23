// Lingua del sito: italiano (predefinito) o inglese.
//
// La lingua si sceglie con ?lang=en / ?lang=it nell'indirizzo (in mostra si
// può fissare insieme a ?mostra=1) oppure con la sigla "en" / "it" in basso a destra,
// e viene ricordata nel browser per le pagine successive.
//
// Va caricato nel <head> di ogni pagina, prima di tutto il resto: imposta
// subito <html data-lang="…"> così il testo dell'altra lingua non compare
// neanche per un istante.
//
// Pagine (home, info, dati): i testi lunghi sono scritti nell'HTML in entrambe
// le lingue, ciascuno dentro un elemento con data-lang="it" o data-lang="en";
// si vede solo quello della lingua attiva.
// Rete (script.js): i testi dell'interfaccia sono in TESTI qui sotto e si
// leggono con t("chiave"); tipi e descrizioni delle interazioni in inglese
// sono in INTERAZIONI_EN; i nomi comuni inglesi delle specie in nomi_en.csv.

const LINGUE = ["it", "en"];

const LANG = (() => {
  const daUrl = new URLSearchParams(location.search).get("lang");
  if (LINGUE.includes(daUrl)) {
    try {
      localStorage.setItem("lang", daUrl);
    } catch (e) {}
    return daUrl;
  }
  try {
    const salvata = localStorage.getItem("lang");
    if (LINGUE.includes(salvata)) return salvata;
  } catch (e) {}
  return "it";
})();

document.documentElement.lang = LANG;
document.documentElement.dataset.lang = LANG;
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>
    html:not([data-lang="en"]) [data-lang="en"],
    html[data-lang="en"] [data-lang="it"] { display: none !important; }
    .lang-corner {
      position: fixed; right: 32px; bottom: 28px; z-index: 1000;
      font-family: "Inconsolata", monospace; font-size: 14px;
      color: var(--text, #f4f4f4); text-decoration: none;
    }
    .lang-corner:hover { text-decoration: underline; }
    .mostra .lang-corner { display: none; }
  </style>`
);

// Sigla per cambiare lingua, fissa in basso a destra: mostra solo la lingua
// in cui si può passare ("en" / "it"). Cambiando lingua si resta sulla stessa
// pagina e si conservano gli altri parametri. In mostra è nascosta, come il
// menu: lì la lingua si fissa con ?lang=en.
document.addEventListener("DOMContentLoaded", () => {
  const altra = LANG === "en" ? "it" : "en";
  const params = new URLSearchParams(location.search);
  params.set("lang", altra);
  const titolo = altra === "en" ? "English" : "Italiano";
  document.body.insertAdjacentHTML(
    "beforeend",
    `<a class="lang-corner" href="?${params}" hreflang="${altra}" lang="${altra}" title="${titolo}">${altra}</a>`
  );
});

// ---- Testi dell'interfaccia della rete ----
const TESTI = {
  it: {
    numeri: "it-IT",
    "contatore.totale": "Contatore totale",
    "contatore.specie": "specie",
    "contatore.interazioni": "interazioni",
    "contatore.piu-connessa": "Specie più connessa",
    "contatore.apri-piu-connessa": "Apri {nome}, la specie più connessa",
    "nodo.apri": "Apri {nome}",
    "nodo.osservazioni": "Osservazioni iNaturalist",
    "nodo.specie-interagisce": "Specie con cui interagisce",
    "nodo.interazioni": "Interazioni",
    "nodo.nessuna": "Nessuna",
    "nodo.unita-specie": "specie",
    "crediti.riservati": "tutti i diritti riservati",
    "rotella.suggerimento": "punta il dito verso un collegamento",
    "ricerca.placeholder": "Cerca una specie…",
    "ricerca.cancella": "Cancella la ricerca",
    "non-osservate.etichetta": "Solo specie non osservate",
    "non-osservate.off": "Evidenzia le specie senza osservazioni su iNaturalist",
    "non-osservate.on": "Torna alla vista completa",
    "vista.etichetta": "Vista per osservazioni",
    "vista.off": "Disponi le specie per numero di osservazioni",
    "vista.on": "Torna alla rete",
    "vista.anello-3": "3+ osservazioni",
    "vista.anello-2": "2 osservazioni",
    "vista.anello-1": "1 osservazione",
    "vista.anello-0": "nessuna osservazione",
    "mappa.oasi": "Oasi Cave di Noale",
    "tour.titolo": "Come leggere la rete",
    "tour.apri": "Apri il tour",
    "tour.chiudi": "Chiudi il tour",
    "tour.precedente": "Step precedente",
    "tour.successivo": "Step successivo",
    "tour.cover":
      "Ogni nodo è una specie.<br>Ogni collegamento è un'interazione.<br> Ogni interazione ha un verso.",
    "tour.specie.titolo": "Le specie",
    "tour.specie":
      "Clicca una specie per visualizzare le sue interazioni, scopri i dettagli nell'inspector sulla destra.",
    "tour.verso.titolo": "Il verso dell'interazione",
    "tour.verso":
      "Ogni interazione ha un verso, segnalato da una freccia che può essere:",
    "tour.verso.uscente": "uscente",
    "tour.verso.attiva": "(attiva)",
    "tour.verso.entrante": "entrante",
    "tour.verso.passiva": "(passiva)",
    "tour.verso.pallino": "pallino",
    "tour.verso.neutra": "(neutra)",
    "tour.verso.non-disponibile":
      "Esempio non disponibile con i dati caricati in questo momento.",
    "tour.verso.esempio":
      "A seconda del nodo cliccato, la stessa interazione si modifica. {a}, la stessa relazione può essere letta anche come {b}.",
    "tour.verso.passivo": "è ",
    "tour.neutre.titolo": "Interazioni neutre",
    "tour.neutre":
      "In alcuni casi le interazioni non hanno verso, sono reciproche. In queste relazioni non esistono attori attivi o passivi.",
    "tour.non-osservate.titolo": "Specie non ancora osservate",
    "tour.non-osservate":
      "Tutti possono contribuire ad ampliare o completare la rete, scopri quali specie non sono ancora state osservate nelle Cave di Noale, esplora l'oasi e prova a trovarle tu.",
    "tour.non-osservate.link": "Scopri iNaturalist",
    "tour.chiusura.titolo": "Esplora la rete",
    "tour.chiusura":
      "Avvicinati, allontanati, spostati nello spazio, trascina i nodi per districare la rete e farti spazio tra le interazioni non-umane che tengono viva l'oasi.",
  },
  en: {
    numeri: "en-GB",
    "contatore.totale": "Total count",
    "contatore.specie": "species",
    "contatore.interazioni": "interactions",
    "contatore.piu-connessa": "Most connected species",
    "contatore.apri-piu-connessa": "Open {nome}, the most connected species",
    "nodo.apri": "Open {nome}",
    "nodo.osservazioni": "iNaturalist observations",
    "nodo.specie-interagisce": "Species it interacts with",
    "nodo.interazioni": "Interactions",
    "nodo.nessuna": "None",
    "nodo.unita-specie": "species",
    "crediti.riservati": "all rights reserved",
    "rotella.suggerimento": "point your finger at a connection",
    "ricerca.placeholder": "Search for a species…",
    "ricerca.cancella": "Clear search",
    "non-osservate.etichetta": "Only species not yet observed",
    "non-osservate.off": "Highlight species with no observations on iNaturalist",
    "non-osservate.on": "Back to the full view",
    "vista.etichetta": "View by observations",
    "vista.off": "Arrange species by number of observations",
    "vista.on": "Back to the network",
    "vista.anello-3": "3+ observations",
    "vista.anello-2": "2 observations",
    "vista.anello-1": "1 observation",
    "vista.anello-0": "no observations",
    "mappa.oasi": "Cave di Noale Oasis",
    "tour.titolo": "How to read the network",
    "tour.apri": "Open the tour",
    "tour.chiudi": "Close the tour",
    "tour.precedente": "Previous step",
    "tour.successivo": "Next step",
    "tour.cover":
      "Each node is a species.<br>Each connection is an interaction.<br> Each interaction has a direction.",
    "tour.specie.titolo": "The species",
    "tour.specie":
      "Click a species to see its interactions, and find the details in the inspector on the right.",
    "tour.verso.titolo": "The direction of an interaction",
    "tour.verso": "Each interaction has a direction, shown by an arrow that can be:",
    "tour.verso.uscente": "outgoing",
    "tour.verso.attiva": "(active)",
    "tour.verso.entrante": "incoming",
    "tour.verso.passiva": "(passive)",
    "tour.verso.pallino": "dot",
    "tour.verso.neutra": "(neutral)",
    "tour.verso.non-disponibile":
      "No example available with the data loaded right now.",
    "tour.verso.esempio":
      "The same interaction changes depending on the node that is clicked. {a}; the same relationship can also be read as {b}.",
    "tour.verso.passivo": "is ",
    "tour.neutre.titolo": "Neutral interactions",
    "tour.neutre":
      "Some interactions have no direction: they are mutual. In these relationships there are no active or passive actors.",
    "tour.non-osservate.titolo": "Species not yet observed",
    "tour.non-osservate":
      "Anyone can help extend or complete the network: find out which species have not yet been observed at Cave di Noale, explore the oasis and try to find them yourself.",
    "tour.non-osservate.link": "Discover iNaturalist",
    "tour.chiusura.titolo": "Explore the network",
    "tour.chiusura":
      "Zoom in, zoom out, move through the space, drag the nodes to untangle the network and make your way among the non-human interactions that keep the oasis alive.",
  },
};

// t("chiave", { nome: "…" }): testo nella lingua attiva, con i segnaposto
// {nome} sostituiti. Se manca in inglese si usa l'italiano.
function t(chiave, valori) {
  const testo = TESTI[LANG][chiave] ?? TESTI.it[chiave] ?? chiave;
  return valori
    ? testo.replace(/\{(\w+)\}/g, (m, k) => (k in valori ? valori[k] : m))
    : testo;
}

// ---- Interazioni in inglese ----
// Chiave = nome italiano del tipo (come in edges.csv e INTERACTION_TAXONOMY in
// script.js). Valore = [etichetta, descrizione, nota facoltativa].
// Etichette: i termini GloBI (colonna type_EN di edges.csv) dove esistono.
// Descrizioni: stesse regole dell'italiano, una frase che sottintende come
// soggetto la specie a sinistra ("Feeds on the other species…"); i tipi
// simmetrici iniziano con "The two species".
const INTERAZIONI_EN = {
  mangia: [
    "eats",
    "Feeds on the other species, eating it whole or in part.",
    "This can include young or unborn individuals, such as eggs.",
  ],
  "mangiato da": [
    "eaten by",
    "Is eaten by the other species, whole or in part.",
    "This can include its young or its eggs.",
  ],
  preda: [
    "preys on",
    "Catches and kills the other species to feed on it.",
    'Unlike "eats", this implies hunting.',
  ],
  "predato da": [
    "preyed upon by",
    "Is caught and killed by the other species, which feeds on it.",
    'Unlike "eaten by", this implies hunting.',
  ],
  impollina: [
    "pollinates",
    "Carries the other species' pollen from flower to flower, allowing it to reproduce.",
  ],
  "impollinato da": [
    "pollinated by",
    "Its flowers are pollinated by the other species, which carries their pollen.",
  ],
  impollinato: [
    "pollinated by",
    "Its flowers are pollinated by the other species, which carries their pollen.",
  ],
  "visita i fiori di": [
    "visits flowers of",
    "Visits the other species' flowers, for example looking for nectar or pollen.",
    "It does not necessarily pollinate them.",
  ],
  "visita il fiore di": [
    "visits flowers of",
    "Visits the other species' flowers, for example looking for nectar or pollen.",
    "It does not necessarily pollinate them.",
  ],
  "fiori visitati da": [
    "flowers visited by",
    "Its flowers are visited by the other species, for example looking for nectar or pollen.",
    "They are not necessarily pollinated.",
  ],
  "fiore visitato da": [
    "flowers visited by",
    "Its flowers are visited by the other species, for example looking for nectar or pollen.",
    "They are not necessarily pollinated.",
  ],
  visita: [
    "visits",
    "Frequents the other species, without necessarily harming or consuming it.",
  ],
  "visitato da": [
    "visited by",
    "Is frequented by the other species, without necessarily being harmed or consumed.",
  ],
  "ospite di": [
    "host of",
    "Hosts the other species, which lives on it or inside it.",
  ],
  "ha come ospite": [
    "has host",
    "Lives on or inside the other species, using it as a host.",
  ],
  "ha ospite": [
    "has host",
    "Lives on or inside the other species, using it as a host.",
  ],
  "parassita di": [
    "parasite of",
    "Lives at the expense of the other species, feeding on it and harming it.",
  ],
  "ha come parassita": [
    "has parasite",
    "Hosts the other species, which lives at its expense and harms it.",
  ],
  "simbionte di": [
    "symbiont of",
    "The two species live in a close, long-lasting association.",
  ],
  "vettore di dispersione di": [
    "dispersal vector of",
    "Carries the other species' seeds or fruits far away, helping it spread.",
  ],
  "ha come vettore di dispersione": [
    "has dispersal vector",
    "Its seeds or fruits are carried far away by the other species, which helps it spread.",
  ],
  "interagisce con": [
    "interacts with",
    "The two species are linked by a documented interaction whose type the source does not specify.",
  ],
  "adiacente a": [
    "adjacent to",
    "The two species live very close to each other, with no documented direct link.",
  ],
  "si nutre di": [
    "eats",
    "Feeds on the other species, eating it whole or in part.",
    "This can include young or unborn individuals, such as eggs.",
  ],
  "consumato da": [
    "eaten by",
    "Is eaten by the other species, whole or in part.",
    "This can include its young or its eggs.",
  ],
  "acquisisce nutrienti da": [
    "acquires nutrients from",
    "Obtains nourishment from the other species, without necessarily eating it.",
  ],
  "fornisce nutrienti a": [
    "provides nutrients for",
    "Provides nourishment to the other species, without necessarily being eaten.",
  ],
  uccide: [
    "kills",
    "Causes the death of the other species, without feeding on it.",
    'Unlike "preys on", there is no feeding.',
  ],
  "ucciso da": [
    "killed by",
    "Is killed by the other species, which does not feed on it.",
    'Unlike "preyed upon by", there is no feeding.',
  ],
  "causa la morte di": [
    "kills",
    "Causes the death of the other species, without feeding on it.",
    'Unlike "preys on", there is no feeding.',
  ],
  "parassitoide di": [
    "parasitoid of",
    "Lives as a larva inside or on the other species, eventually killing it.",
    "Typical of some wasps and flies.",
  ],
  "ha come parassitoide": [
    "has parasitoid",
    "Hosts the other species' larvae, which eventually kill it.",
  ],
  "ectoparassita di": [
    "ectoparasite of",
    "Lives on the surface of the other species, feeding at its expense.",
    "For example ticks and lice.",
  ],
  "ha come ectoparassita": [
    "has ectoparasite",
    "Hosts the other species on its surface, which feeds at its expense.",
  ],
  "endoparassita di": [
    "endoparasite of",
    "Lives inside the other species' body, feeding at its expense.",
    "For example intestinal worms.",
  ],
  "ha come endoparassita": [
    "has endoparasite",
    "Hosts the other species inside its body, which feeds at its expense.",
  ],
  "emiparassita di": [
    "hemiparasite of",
    "Is a plant that takes water and minerals from the other species, while also photosynthesising.",
    "For example mistletoe.",
  ],
  "parassita radicale di": [
    "root parasite of",
    "Attaches to the other species' roots to take water and nutrients from it.",
  ],
  "patogeno di": [
    "pathogen of",
    "Causes a disease in the other species.",
  ],
  "ha come patogeno": [
    "has pathogen",
    "Is made ill by the other species.",
  ],
  "vettore di": [
    "vector of",
    "Transmits disease agents to the other species, carrying them from one individual to another.",
  ],
  "è vettore di": [
    "vector of",
    "Transmits disease agents to the other species, carrying them from one individual to another.",
  ],
  "ha come vettore": [
    "has vector",
    "Receives disease agents through the other species, which carries them from one individual to another.",
  ],
  "ha vettore": [
    "has vector",
    "Receives disease agents through the other species, which carries them from one individual to another.",
  ],
  "epifita di": [
    "epiphyte of",
    "Grows resting on the surface of the other species, without rooting in the soil and without harming it.",
    "For example mosses and lichens on tree trunks.",
  ],
  "ha come epifita": [
    "has epiphyte",
    "Supports the other species, which grows on it without harming it.",
  ],
  "crea habitat per": [
    "creates habitat for",
    "Creates, with its own body or structures, an environment where the other species lives.",
  ],
  "ha come habitat": [
    "has habitat",
    "Lives in the environment created by the other species.",
  ],
  "fornisce habitat a": [
    "provides habitat for",
    "Offers the other species an environment to live in.",
  ],
  "occupa l'habitat di": [
    "lives in habitat of",
    "Lives in the environment offered by the other species.",
  ],
  "ospite di micorrize arbuscolari per": [
    "has arbuscular mycorrhizal host",
    "Hosts the other species in its roots: a fungus that enters them and exchanges water and nutrients with it.",
    "This is called arbuscular mycorrhiza.",
  ],
  "ha come ospite una specie micorrizata arbuscolarmente": [
    "arbuscular mycorrhizal host of",
    "Is a fungus that enters the other species' roots, exchanging water and nutrients with it.",
    "This is called arbuscular mycorrhiza.",
  ],
  "ospite di ectomicorrize di": [
    "has ectomycorrhizal host",
    "Hosts the other species on its roots: a fungus that wraps around them without entering and exchanges nutrients with it.",
    "This is called ectomycorrhiza, typical of trees such as oaks and pines.",
  ],
  "ha come ospite ectomicorrizico": [
    "ectomycorrhizal host of",
    "Is a fungus that wraps around the other species' roots without entering them, exchanging nutrients with it.",
    "This is called ectomycorrhiza.",
  ],
  "specie allelopatica nei confronti di": [
    "allelopath of",
    "Releases chemicals that affect the growth or survival of the other species.",
  ],
  "ha come specie allelopatica": [
    "has allelopath",
    "Is affected by chemicals released by the other species, which influence its growth or survival.",
  ],
  "commensale di": [
    "commensalist of",
    "The two species live together: one benefits, while the other is neither harmed nor helped.",
  ],
  "mutualista di": [
    "mutualist of",
    "The two species cooperate and both benefit.",
  ],
  "coesiste con": [
    "co-occurs with",
    "The two species often live in the same place at the same time.",
  ],
  "si trova in associazione con": [
    "co-occurs with",
    "The two species often live in the same place at the same time.",
  ],
  "si verifica con": [
    "co-occurs with",
    "The two species have been observed together, with no documented direct link.",
  ],
  "condivide il sito di rifugio con": [
    "co-roosts with",
    "The two species use the same perch or shelter to rest.",
    "Usually birds or bats.",
  ],
  "ecologicamente correlato a": [
    "ecologically related to",
    "The two species are linked indirectly, through the environment they share.",
  ],
  "interagisce troficamente con": [
    "trophically interacts with",
    "The two species are linked by a feeding relationship, but the source does not say who eats whom.",
  ],
  danneggia: [
    "damages",
    "Damages the other species, without necessarily killing or eating it.",
  ],
  "danneggiato da": [
    "damaged by",
    "Is damaged by the other species, without necessarily being killed or eaten.",
  ],
  aggredisce: [
    "attacks",
    "Attacks the other species, for example to defend territory or resources.",
  ],
  "aggredito da": [
    "attacked by",
    "Is attacked by the other species, for example over territory or resources.",
  ],
  alleva: [
    "farms",
    "Farms or cultivates the other species in order to feed on it.",
    "For example ants with aphids.",
  ],
  "allevato da": [
    "farmed by",
    "Is farmed or cultivated by the other species, which feeds on it.",
  ],
  "cleptoparassita di": [
    "kleptoparasite of",
    "Steals the food or resources the other species has gathered.",
    "For example some bees that lay their eggs in other bees' nests.",
  ],
  "ha come cleptoparassita": [
    "has kleptoparasite",
    "Is robbed by the other species of the food or resources it has gathered.",
  ],
  "iperparassita di": [
    "hyperparasite of",
    "Lives at the expense of the other species, which is itself a parasite.",
  ],
  "ha come iperparassita": [
    "has hyperparasite",
    "Is a parasite that is in turn parasitised by the other species.",
  ],
  "endoparassitoide di": [
    "endoparasitoid of",
    "Lives as a larva inside the other species, eventually killing it.",
  ],
  "ha come endoparassitoide": [
    "has endoparasitoid",
    "Hosts the other species' larvae inside its body, which eventually kill it.",
  ],
  "ectoparassitoide di": [
    "ectoparasitoid of",
    "Lives as a larva on the other species, eventually killing it.",
  ],
  "ha come ectoparassitoide": [
    "has ectoparasitoid",
    "Carries the other species' larvae on its body, which eventually kill it.",
  ],
  "ospite serbatoio di": [
    "reservoir host of",
    "Hosts the other species, a disease agent, without falling ill, helping keep it in the environment.",
  ],
  "ha come ospite serbatoio": [
    "has reservoir host",
    "Is a disease agent that persists in the environment thanks to the other species, which hosts it without falling ill.",
  ],
  "depone le uova su": [
    "lays eggs on",
    "Lays its eggs on the surface of the other species.",
  ],
  "riceve le uova di": [
    "has eggs laid on by",
    "Receives the other species' eggs on its surface.",
  ],
  "depone le uova in": [
    "lays eggs in",
    "Lays its eggs inside the other species.",
  ],
  "accoglie le uova di": [
    "has eggs laid in by",
    "Receives the other species' eggs inside its body.",
  ],
  abita: [
    "inhabits",
    "Lives in or near the other species, using it as a home.",
  ],
  "abitato da": [
    "inhabited by",
    "Is a home to the other species, which lives in or near it.",
  ],
  "vive su": [
    "lives on",
    "Lives on the surface of the other species.",
  ],
  "ospita sulla superficie": [
    "has living on it",
    "Carries the other species on its surface, where it lives.",
  ],
  "vive dentro": [
    "lives inside of",
    "Lives inside the other species.",
  ],
  "ospita all'interno": [
    "has living inside",
    "Hosts the other species inside its body, where it lives.",
  ],
  "vive sotto": [
    "lives under",
    "Lives under the other species, for example under bark or leaves.",
  ],
  "ripara sotto di sé": [
    "has living under",
    "Offers shelter beneath itself to the other species, which lives there.",
  ],
  "vive vicino a": [
    "lives near",
    "Lives near the other species.",
  ],
  "ha vicino": [
    "has living near",
    "Has the other species living close to it.",
  ],
  "vive con": [
    "lives with",
    "The two species live together, in close contact.",
  ],
  "ospite nella dimora di": [
    "guest of",
    "Lives in the other species' burrow or nest, not in its body.",
  ],
  "accoglie nella dimora": [
    "has guest",
    "Takes the other species into its own burrow or nest.",
  ],
  "si posa su": [
    "perches on",
    "Perches on the other species, for example on a branch.",
  ],
  "fa da posatoio a": [
    "perched on by",
    "Is used by the other species as a perch.",
  ],
  "riposa su": [
    "rests on",
    "Uses the other species as a shelter to rest.",
  ],
  "fa da rifugio a": [
    "shelters",
    "Offers shelter to the other species, which rests there.",
  ],
};

// Etichetta, descrizione e nota di un tipo di interazione nella lingua attiva.
// "tipo" è sempre il nome italiano, usato come chiave in tutto script.js.
function etichettaInterazione(tipo) {
  return (LANG === "en" && INTERAZIONI_EN[tipo]?.[0]) || tipo;
}
