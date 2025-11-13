import { Hono } from "hono";
import { registerFilesPublicRoutes } from "./files/public.js";
import { registerFilesProtectedRoutes } from "./files/protected.js";

const app = new Hono();

registerFilesPublicRoutes(app);
registerFilesProtectedRoutes(app);

export default app;
