import { jobTypeCatalog, buildBuiltinJobTypeDefinitions } from "./JobTypeCatalog.js";
import { taskRegistry } from "./TaskRegistry.js";

export function registerJobTypes(): void {
  console.log("[JobTypeCatalog] 开始注册任务类型定义...");
  const defs = buildBuiltinJobTypeDefinitions();
  for (const def of defs) {
    jobTypeCatalog.register(def);
  }
  console.log(
    `[JobTypeCatalog] 注册完成! 共注册 ${defs.length} 个任务类型定义: ${defs
      .map((d) => d.taskType)
      .join(", ")}`
  );
}

export function validateJobTypesConsistency(): void {
  const supported = taskRegistry.getSupportedTypes();
  const handlers = supported.map((t) => taskRegistry.getHandler(t));
  jobTypeCatalog.validateAgainstHandlers(handlers);
  console.log("[JobTypeCatalog] 一致性校验通过（definitions <-> handlers）");
}

