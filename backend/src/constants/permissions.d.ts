export const Permission: Record<string, number>;

export class PermissionChecker {
  static hasPermission(userPermissions: number, requiredPermission: number): boolean;
  static hasAnyPermission(userPermissions: number, requiredPermissions: number[]): boolean;
  static hasAllPermissions(userPermissions: number, requiredPermissions: number[]): boolean;
  static addPermission(currentPermissions: number, newPermission: number): number;
  static removePermission(currentPermissions: number, permissionToRemove: number): number;
  static getPermissionDescriptions(permissions: number): string[];
}
