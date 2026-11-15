import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/fragment-mono/400.css";
// Faces of the other looks and the font overrides; a face downloads only once something uses it.
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/albert-sans";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/atkinson-hyperlegible-mono";

import "./styles/global.css";
import "./styles/looks/systemowy.css";
import "./styles/looks/plakat.css";
import "./styles/looks/konsola.css";
import "./styles/looks/kalkulator.css";
// After the looks: an override must outrank the look it sits on.
import "./styles/custom.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
