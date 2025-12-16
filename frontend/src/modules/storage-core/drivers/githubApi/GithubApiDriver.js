import { LocalDriver } from "../local/LocalDriver.js";

/**
 * GITHUB_API 存储驱动（前端）
 *
 * - GitHub API 存储的上传/删除/改名等动作全部由后端驱动实现
 * - 前端仅需要复用“后端中转上传”能力（流式/表单）即可
 * - 因此直接继承 LocalDriver 的 uploader 适配逻辑，避免重复实现
 */
export class GithubApiDriver extends LocalDriver {
  constructor(config = {}) {
    super(config);
  }
}

