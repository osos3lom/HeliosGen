import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import "@fontsource/geist/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource/doto/latin-900.css";
import "./globals.css";
import RootLayout from "./RootLayout";
import { registerMediaWorker } from "@/lib/browser/registerMediaWorker";
import { resumePendingJobs } from "@/lib/api/jobs";
import GalleryPage from "./routes/GalleryPage";
import AssetsPage from "./routes/AssetsPage";
import ChatPage from "./routes/ChatPage";
import WorkflowListPage from "./routes/WorkflowListPage";
import WorkflowPage from "./routes/WorkflowPage";

// Hash routing: GitHub Pages has no SPA fallback, so deep links live after "#".
const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/gallery?tab=images" replace /> },
      { path: "gallery", element: <GalleryPage /> },
      { path: "assets", element: <AssetsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "workflow", element: <WorkflowListPage /> },
      { path: "workflow/:id", element: <WorkflowPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

void registerMediaWorker();
// Generation jobs are polled from the page; pick up any a reload interrupted.
void resumePendingJobs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
