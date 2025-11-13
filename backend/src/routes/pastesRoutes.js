import { Hono } from "hono";
import { registerPastesPublicRoutes } from "./pastes/public.js";
import { registerPastesProtectedRoutes } from "./pastes/protected.js";

const app = new Hono();

registerPastesPublicRoutes(app);
registerPastesProtectedRoutes(app);

export default app;
