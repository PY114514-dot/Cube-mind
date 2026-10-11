/** 实体 54 位局面与页面当前数学局面的最小校验接口。 */
export function isPhysicalStateInSync(expectedFacelets: string, physicalFacelets: string | null): boolean | null {
  if (physicalFacelets === null) return null;
  return physicalFacelets === expectedFacelets;
}
