const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("svg")
  .attr("width", width)
  .attr("height", height);

let container = svg.select("#container");
if (container.empty()) {
  container = svg.append("g").attr("id", "container");
}

let infoBox = d3.select("body").select("#info-box");
if (infoBox.empty()) {
  infoBox = d3.select("body").append("div").attr("id", "info-box");
}

let simulation, node, curvedLinks, edgeLabels;

const interactionDescriptions = {
  "è vettore di": "A è un vettore per B se trasporta e trasmette un patogeno infettivo in un altro organismo vivente.",
  "ha come vettore di dispersione": "A ha come vettore di dispersione B se B trasporta e trasmette un patogeno infettivo in un altro organismo vivente.",
  "interagisce con": "Questa relazione e tutte le sotto-relazioni possono essere applicate a (1) coppie di entità che interagiscono in qualsiasi momento del tempo (2) popolazioni o specie di entità i cui membri hanno la tendenza ad interagire (3) classi i cui membri hanno la tendenza ad interagire.",
  "mangia": "Notare che questa interazione può riferirsi anche a individui cuccioli della specie, o a individui che devono ancora nascere, come ad esempio nel caso delle uova.",
  "preda": "Interazione che coinvolge un processo di predazione, in cui il soggetto uccide il bersaglio per mangiarlo o per nutrire fratelli, figli o membri del gruppo.",
  "predato da": "Il soggetto subisce un processo di predazione, in cui viene ucciso per essere mangiato o per nutrire fratelli, figli o membri del gruppo del predatore.",
  "fiore visitato da": "Un animale o un insetto interagisce con il fiore, in genere allo scopo di ottenere cibo o risorse come nettare e polline.",
  "ospite di": "Si riferisce all'organismo più grande o dominante in una relazione simbiotica. Questo organismo fornisce l'habitat o l'ambiente per un altro organismo, spesso indicato come il simbionte o parassita."
};

Promise.all([
  d3.csv("nodes.csv"),
  d3.csv("edges.csv")
]).then(([nodes, links]) => {
  const adjacency = {};
  links.forEach(({ source, target }) => {
    if (!adjacency[source]) adjacency[source] = new Set();
    if (!adjacency[target]) adjacency[target] = new Set();
    adjacency[source].add(target);
    adjacency[target].add(source);
  });

  nodes.forEach(d => {
    d.observations = d.observations === "Nessuna" ? 0 : +d.observations;
    d.opacity = d.observations === 0 ? 0.7 : 1;
    d.color = "#000000";
    d.degree = adjacency[d.scientific_name]?.size || 0;
  });

  // Trova la specie con il maggior numero di connessioni
const maxDegreeNode = nodes.reduce((max, node) => node.degree > max.degree ? node : max, nodes[0]);

// Aggiungi un contatore in alto a destra
d3.select("body").append("div")
  .attr("id", "top-species-counter")
  .style("position", "absolute")
  .style("width", "300px")
  .style("top", "20px")
  .style("right", "0px")
  .style("padding", "15px 0px")
  .style("background", "rgba(0, 0, 0, 0.75)")
  .style("color", "white")
  .style("font-family", "Inconsolata, monospace")
  .style("font-size", "14px")
  .style("border-radius", "6px")
  .style("box-shadow", "0 2px 6px rgba(0, 0, 0, 0)")
  .html(`<b>Specie che interagisce con il maggor numero di altre specie:</b><br>${maxDegreeNode.name} <br><i>(${maxDegreeNode.scientific_name})</i>`);


  const sizeScale = d3.scaleLinear()
    .domain(d3.extent(nodes, d => d.degree))
    .range([15, 45]);

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.scientific_name).distance(90))
    .force("charge", d3.forceManyBody().strength(-500))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(d => sizeScale(d.degree) + 5));

  const linkGroup = container.append("g").attr("class", "links");

  curvedLinks = linkGroup.selectAll("path")
    .data(links)
    .enter()
    .append("path")
    .attr("class", "link-path")
    .attr("stroke", "#646466")
    .attr("stroke-width", 0.4)
    .attr("fill", "none")
    .attr("id", (d, i) => `link-path-${i}`)
    .style("pointer-events", "stroke");  // così la hitbox è sullo stroke, non solo sul riempimento

    curvedLinks.on("click", (event, d) => {
  event.stopPropagation();

  // Reset opacità nodi ed edges
  node.style("opacity", 1);
  container.selectAll("circle.bg").style("opacity", 1);
  curvedLinks.style("opacity", 1);
  edgeLabels.selectAll("*").remove();

  const sourceNode = typeof d.source === "object" ? d.source : nodes.find(n => n.scientific_name === d.source);
  const targetNode = typeof d.target === "object" ? d.target : nodes.find(n => n.scientific_name === d.target);

  const interaction = d.type;
  const description = interactionDescriptions[interaction] || "";

  infoBox.html(`
    <h3><i>${sourceNode.name}</i> → <em>${interaction}</em> → <i>${targetNode.name}</i></h3>
    <div style="display: flex; gap: 10px; margin-top: 10px;">
      <img src="${sourceNode.image}" alt="${sourceNode.name}" style="width: 80px; height: auto" />
      <img src="${targetNode.image}" alt="${targetNode.name}" style="width: 80px; height: auto" />
    </div>
    ${description ? `<p style="margin-top: 10px;">${description}</p>` : ""}
  `).style("opacity", 1);
  /* ; border-radius: 400px; */
});


  edgeLabels = container.append("g").attr("class", "edge-labels");

  const defs = svg.select("defs").empty() ? svg.append("defs") : svg.select("defs");

  defs.selectAll("pattern")
    .data(nodes)
    .enter()
    .append("pattern")
    .attr("id", d => `img-${d.scientific_name.replace(/\s+/g, "_")}`)
    .attr("patternUnits", "objectBoundingBox")
    .attr("width", 1)
    .attr("height", 1)
    .append("image")
    .attr("href", d => d.image)
    .attr("preserveAspectRatio", "xMidYMid slice")
    .attr("width", d => sizeScale(d.degree) * 2)
    .attr("height", d => sizeScale(d.degree) * 2)
    .attr("opacity", d => d.opacity);

  container.selectAll("circle.bg")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("class", "bg")
    .attr("r", d => sizeScale(d.degree))
    .attr("fill", d => d.color)
    .attr("fill-opacity", 1);

  node = container.selectAll("circle.node")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("r", d => sizeScale(d.degree))
    .attr("stroke", "#646466")
    .attr("stroke-width", 0.4) // <-- stroke nodo
    .attr("fill", d => `url(#img-${d.scientific_name.replace(/\s+/g, "_")})`)
    .attr("fill-opacity", d => d.opacity)
    .call(drag(simulation));

  let boundary = container.selectAll("circle.boundary").data([null]);
  boundary = boundary.enter()
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
  defsPath.selectAll(`#${textPathId}`).data([null]).join("path")
    .attr("id", textPathId)
    .attr("fill", "none");

  let textElement = container.selectAll("text.circle-text").data([null]).join("text")
    .attr("class", "circle-text")
    .attr("fill", "#646466")
    .attr("font-size", 44)
    .attr("font-family", "Arial, sans-serif");

  textElement.selectAll("textPath").data([null]).join("textPath")
    .attr("xlink:href", `#${textPathId}`)
    .attr("startOffset", "65%")
    .attr("text-anchor", "middle")
    .text("Oasi Cave di Noale");

  function getLinkArcOffset(d, i, links) {
    const sameLinks = links.filter(l =>
      l.source === d.source && l.target === d.target
    );
    const index = sameLinks.indexOf(d);
    const separation = 10;
    return (index - (sameLinks.length - 1) / 2) * separation;
  }

  simulation.on("tick", () => {
    curvedLinks.attr("d", function (d, i) {
      const x1 = d.source.x;
      const y1 = d.source.y;
      const x2 = d.target.x;
      const y2 = d.target.y;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dr = Math.sqrt(dx * dx + dy * dy);
      const offset = getLinkArcOffset(d, i, links);
      return `M${x1},${y1} A${dr},${dr} 0 0,1 ${x2 + offset},${y2 + offset}`;
    });

    container.selectAll("circle.node")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    container.selectAll("circle.bg")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    updateBoundary();
  });

  d3.select("#reset").on("click", () => {
    simulation.alpha(1).restart();
    resetHighlightAndLabels();
    infoBox.style("opacity", 0);
  });

  d3.select("body").on("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault(); // Impedisce lo scroll della pagina
    d3.select("#reset").dispatch("click");
  }
  });

  node.on("click", (event, d) => {
    event.stopPropagation();
    const clickedId = d.scientific_name;
    const connected = adjacency[clickedId] || new Set();

    node.style("opacity", nd =>
      nd.scientific_name === clickedId || connected.has(nd.scientific_name) ? 1 : 0.1
    );
    curvedLinks.style("opacity", lk =>
      lk.source.scientific_name === clickedId || lk.target.scientific_name === clickedId ? 1 : 0.1
    );
    container.selectAll("circle.bg")
      .style("opacity", bgd =>
        bgd.scientific_name === clickedId || connected.has(bgd.scientific_name) ? 1 : 0.1
      );

    edgeLabels.selectAll("*").remove();

    const edgesToShow = links.filter(lk => {
      const src = typeof lk.source === "object" ? lk.source.scientific_name : lk.source;
      const tgt = typeof lk.target === "object" ? lk.target.scientific_name : lk.target;
      return src === clickedId || tgt === clickedId;
    });

    edgeLabels.selectAll("text")
      .data(edgesToShow)
      .enter()
      .append("text")
      .attr("class", "edge-label")
      .attr("font-size", 8)
      .attr("fill", "white")
      .attr("pointer-events", "none")
      .append("textPath")
      .attr("xlink:href", (d, i) => `#link-path-${links.indexOf(d)}`)
      .attr("startOffset", "50%")
      .attr("text-anchor", "middle")
      .text(d => d.type);

    const interactionCounts = {};
    edgesToShow.forEach(edge => {
      if (!interactionCounts[edge.type]) interactionCounts[edge.type] = 0;
      interactionCounts[edge.type]++;
    });

    const interactionText = Object.entries(interactionCounts)
      .map(([type, count]) => `${type} ${count} specie`)
      .join("<br>");

    infoBox.html(`
      <h3>${d.name}</h3>
      <h4><i>${d.scientific_name}</i></h4>
      <img src="${d.image}" alt="${d.name}" style="width: 100%; height: auto; margin-top: 10px;"/>
      <p>Specie collegata con <b>${adjacency[clickedId]?.size || 0}</b> specie</p>
      <p style="margin-top: 10px;"><u>Osservazioni</u>: ${d.observations}</p>
      <p style="margin-top: 10px;"><u>Interazioni</u>:<br>${interactionText || "Nessuna"}</p>
    `).style("opacity", 1);
  });

  svg.on("click", () => {
    resetHighlightAndLabels();
    infoBox.style("opacity", 0);
  });

  function resetHighlightAndLabels() {
    node.style("opacity", 1);
    curvedLinks.style("opacity", 1);
    container.selectAll("circle.bg").style("opacity", 1);
    edgeLabels.selectAll("*").remove();
  }

  const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on("zoom", (event) => {
      container.attr("transform", event.transform);
    });

  svg.call(zoom);

  simulation.on("end", () => {
    scaleAndCenter(nodes);
  });

  setTimeout(() => {
    scaleAndCenter(nodes);
  }, 2000);

  function updateBoundary() {
    const padding = 100;
    const xs = simulation.nodes().map(d => d.x);
    const ys = simulation.nodes().map(d => d.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2 + padding;

    boundary
      .attr("cx", centerX)
      .attr("cy", centerY)
      .attr("r", radius);

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
});

function scaleAndCenter(nodes) {
  const padding = 40;
  const nodesX = nodes.map(d => d.x);
  const nodesY = nodes.map(d => d.y);
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

  svg.transition()
    .duration(1000)
    .call(d3.zoom().transform, t)
    .ease(d3.easeCubicOut);
}

function drag(simulation) {
  return d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
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
    });
}
