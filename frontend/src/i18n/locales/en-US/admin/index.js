import common from "./common.js";
import dashboard from "./dashboard.js";
import mount from "./mount.js";
import key from "./key.js";
import settings from "./settings.js";
import backup from "./backup.js";
import fsMeta from "./fsMeta.js";
import tasks from "./tasks.js";
import storage from "./storage.js";

export default {
  ...common,
  ...dashboard,
  ...mount,
  ...key,
  ...settings,
  ...backup,
  ...fsMeta,
  ...tasks,
  ...storage,
};
