// 通用存储配置 Repository（当前复用 S3ConfigRepository 实现）
import { S3ConfigRepository } from "./S3ConfigRepository.js";

export class StorageConfigRepository extends S3ConfigRepository {}

