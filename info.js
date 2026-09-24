// Gestisce il cambio di contenuto dentro .media-frame: passando (o
// toccando, su mobile) una parola .trigger nel testo, il layer
// corrispondente diventa visibile al posto del video di default.
//
// Due input diversi, un solo meccanismo:
//  - mouse: hover per mostrare, uscita per tornare al video (nessun
//    "aggancio", puramente momentaneo — comportamento da desktop);
//  - touch: l'hover non esiste, quindi il tap "fissa" (pin) il layer
//    finché non si tocca di nuovo lo stesso trigger o si tocca fuori.
(function () {
  const frame = document.getElementById("mediaFrame");
  if (!frame) return;

  const layers = frame.querySelectorAll(".media-layer");
  const triggers = document.querySelectorAll(".trigger");
  let pinned = null; // elemento .trigger attualmente "fissato" da un tap

  function showLayer(name) {
    layers.forEach((el) => {
      el.classList.toggle("is-active", el.dataset.layer === name);
    });
  }

  function clearPin() {
    if (pinned) pinned.classList.remove("is-pinned");
    pinned = null;
    showLayer("default");
  }

  triggers.forEach((trigger) => {
    const name = trigger.dataset.layer;

    // Desktop: hover puro, nessuno stato persistente.
    trigger.addEventListener("mouseenter", () => {
      if (!pinned) showLayer(name);
    });
    trigger.addEventListener("mouseleave", () => {
      if (!pinned) showLayer("default");
    });

    // Touch (e anche click da mouse, che non crea conflitti: il tap
    // "conferma" semplicemente quello che l'hover aveva già mostrato).
    trigger.addEventListener("click", (event) => {
      event.stopPropagation(); // non far scattare subito il "tap fuori" qui sotto
      if (pinned === trigger) {
        clearPin();
        return;
      }
      if (pinned) pinned.classList.remove("is-pinned");
      pinned = trigger;
      trigger.classList.add("is-pinned");
      showLayer(name);
    });
  });

  // Tap/click ovunque fuori da un trigger: sgancia il layer fissato e
  // torna al video di default.
  document.addEventListener("click", () => {
    if (pinned) clearPin();
  });
})();
