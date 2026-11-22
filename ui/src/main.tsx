import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./App.tsx";
import { boot } from "./Ki.ts";
import "./app.css";

const app = document.getElementById("app");
if (app === null) {
  throw new Error("the page has no #app");
}
createRoot(app).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
void boot((url) => router.history.push(url));
