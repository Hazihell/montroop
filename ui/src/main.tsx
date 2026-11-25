import { TOP } from "./Based.ts";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./App.tsx";
import { boot } from "./Montroop.ts";
import "./app.css";

const app = document.getElementById("app");
if (app === null) {
  throw new Error("the page has no #app");
}
createRoot(app).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
// a notification's chat takes the place of the chat open, so back still
// lands on the list
void boot((url) => (TOP.test(location.pathname) || TOP.test(new URL(url, location.origin).pathname) ? router.history.push(url) : router.history.replace(url)));
