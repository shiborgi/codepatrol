export const METHODS = ["spec", "plan", "review", "build", "verify", "ship"] as const;
export type MethodId = (typeof METHODS)[number];
